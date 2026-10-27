/** Rule-based extraction of receipt/invoice fields from OCR text and machine-readable codes (no AI). */
import {
  findIbans,
  findTaxNumbers,
  findVatIds,
  parseEInvoiceXml,
  parseEpcQr,
  parseTseQr,
  parseTseText,
} from "./ocr-structured";

export const DOC_TYPES = [
  "angebot",
  "rechnung",
  "kassenzettel",
  "vertrag",
  "plan",
  "datenblatt",
  "foto",
  "sonstiges",
] as const;
export type DocType = (typeof DOC_TYPES)[number];

export type Extraction = {
  doc_type: DocType;
  vendor: string | null;
  contact_id: string | null;
  title: string | null;
  amount: number | null;
  date: string | null;
  due_date: string | null;
  trade: string | null;
  expense_category: string | null;
  summary: string | null;
  tags: string[];
};

/** Contact data used to recognize known vendors (USt-IdNr/IBAN/domain/phone/name). */
export type ContactRef = {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  website: string | null;
  phone: string | null;
  notes: string | null;
  trade: string | null;
};

export type ExtractContext = {
  trades?: string[];
  contacts?: ContactRef[];
  /** Decoded QR code payloads (TSE receipt code, GiroCode). */
  codes?: string[];
  /** Embedded or uploaded e-invoice XML (ZUGFeRD/Factur-X/XRechnung). */
  xml?: string[];
  /** Texts from additional OCR passes of the same document; they vote on the total. */
  alternates?: string[];
};

const AMOUNT_RE = /(-?\d{1,3}(?:[.\s]\d{3})*,\d{2}|-?\d+,\d{2}|-?\d+\.\d{2})(?!\d)/g;
// Separate non-global copy: `test()` on a global regex leaves `lastIndex` set, which `matchAll` inherits.
const HAS_AMOUNT = new RegExp(AMOUNT_RE.source);

export function parseAmount(s: string): number | null {
  const m = s.match(/-?\d{1,3}(?:[.\s]\d{3})*,\d{2}|-?\d+,\d{2}|-?\d+\.\d{2}/);
  if (!m) return null;
  let v = m[0].replace(/\s/g, "");
  v = v.includes(",") ? v.replace(/\./g, "").replace(",", ".") : v;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const DIGIT_LIKE: Record<string, string> = {
  O: "0",
  o: "0",
  D: "0",
  I: "1",
  l: "1",
  "|": "1",
  S: "5",
  B: "8",
};

/** Repairs typical OCR confusions inside amounts ("1O,5O" → "10,50", "12, 99" → "12,99"). */
export function normalizeAmounts(text: string): string {
  return text.replace(
    /(?<![\p{L}\d])([\dODIlSB|]+(?:\.[\dODIlSB|]{3})*)\s?([,.])\s?([\dODIlSB|]{2})(?![\p{L}\d])/gu,
    (all, int: string, sep: string, dec: string) => {
      const digits = (int + dec).replace(/\D/g, "").length;
      if (digits < 2) return all;
      const fix = (s: string) => s.replace(/[ODIlSB|]/g, (c) => DIGIT_LIKE[c] ?? c);
      return `${fix(int)}${sep}${fix(dec)}`;
    },
  );
}

type Kind =
  | "change"
  | "given"
  | "subtotal"
  | "discount"
  | "net"
  | "base"
  | "vat"
  | "strong"
  | "brutto"
  | "total"
  | "payment";

const KINDS: [Kind, RegExp][] = [
  ["change", /r[üu]e?ckgeld|wechselgeld|zur[üu]ck\b/gi],
  ["given", /gegeben|\bgeg\./gi],
  ["subtotal", /zwischensumme|zw\.?\s?-?summe|[üu]e?bertrag/gi],
  ["discount", /nachlass|rabatt|skonto|abz[üu]glich|abzgl|gutschein/gi],
  ["net", /(?:gesamt|summe)?\s?netto[\wäöü]*/gi],
  ["base", /\bauf\b/gi],
  ["vat", /mwst|mehrwertsteuer|umsatzsteuer|\bust\b|\bsteuer\b|\bvat\b/gi],
  [
    "strong",
    /gesamtbetrag|rechnungsbetrag|endbetrag|zu\s*zahlen|zahlbetrag|bruttobetrag|summe\s*brutto|gesamt\s*brutto|brutto\s*gesamt|bruttosumme|angebotssumme|gesamtsumme|endsumme|rechnungssumme/gi,
  ],
  ["brutto", /brutto/gi],
  ["total", /summe|gesamt|total/gi],
  [
    "payment",
    /\bbar\b|ec[-\s]?karte|ec[-\s]?cash|girocard|kartenzahlung|betrag|mastercard|\bvisa\b|maestro|v\s?pay|amex|kreditkarte|paypal|\bkarte\b/gi,
  ],
];
const KIND_ORDER = KINDS.map(([k]) => k);
/** Phrases that look like labels but never mark the total ("inkl. MwSt", column headers, fuel price). */
const IGNORE =
  /inkl\.?\s*(?:mwst|ust|steuer|mehrwertsteuer)|einzelpreis|einheitspreis|gesamtpreis|st[üu]ckpreis|eur\s*\/\s*l(?:iter)?/gi;
const WEIGHT: Partial<Record<Kind, number>> = { strong: 6, brutto: 5, total: 4, payment: 3 };

function labelsIn(segment: string): { kind: Kind; index: number }[] {
  const s = segment.replace(IGNORE, (m) => " ".repeat(m.length));
  const found: { kind: Kind; index: number; end: number }[] = [];
  for (const [kind, re] of KINDS)
    for (const m of s.matchAll(re))
      found.push({ kind, index: m.index, end: m.index + m[0].length });
  found.sort((a, b) => a.index - b.index || b.end - a.end);
  const out: typeof found = [];
  for (const f of found) if (!out.some((o) => f.index < o.end && o.index < f.end)) out.push(f);
  return out.sort((a, b) => a.index - b.index);
}

function strongest(labels: { kind: Kind }[]): Kind | null {
  let best: Kind | null = null;
  for (const l of labels)
    if (best === null || KIND_ORDER.indexOf(l.kind) < KIND_ORDER.indexOf(best)) best = l.kind;
  return best;
}

type Amount = { value: number; kind: Kind | null; line: number };

/** Amounts of a text with the label that applies to each of them. */
function labelledAmounts(text: string): Amount[] {
  const lines = normalizeAmounts(text).split(/\r?\n/);
  const out: (Amount & { table?: number | undefined })[] = [];
  let carry: Kind[] = [];
  // A multi-column header ("Netto MwSt Brutto") keeps labelling rows of the same width (VAT tables).
  let table: { labels: Kind[]; width: number; id: number } | null = null;
  lines.forEach((line, i) => {
    const hits = [...line.matchAll(AMOUNT_RE)].filter(
      (m) => !/^\s*%/.test(line.slice(m.index + m[0].length)),
    );
    if (!hits.length) {
      // A short label-only line ("Summe:" or "Netto MwSt Brutto") labels the amounts on the next line.
      const labels = line.trim().length <= 40 ? labelsIn(line) : [];
      if (line.trim()) {
        carry = labels.map((l) => l.kind);
        table = null;
      }
      return;
    }
    if (
      !carry.length &&
      table &&
      hits.length === table.width &&
      !labelsIn(line.slice(0, hits[0]!.index)).length
    )
      carry = table.labels;
    else if (carry.length < 2 || hits.length < 2) table = null;
    if (carry.length >= 2 && hits.length >= 2 && !table)
      table = { labels: carry, width: hits.length, id: i };
    let prev = 0;
    hits.forEach((m, j) => {
      const value = parseAmount(m[0]);
      const own = strongest(labelsIn(line.slice(prev, m.index)));
      prev = m.index + m[0].length;
      let kind = own;
      if (!kind && carry.length) {
        const offset = hits.length - carry.length;
        kind =
          carry.length === 1
            ? j === hits.length - 1
              ? carry[0]!
              : null
            : j >= offset
              ? carry[j - offset]!
              : null;
      }
      if (value !== null)
        out.push({
          value,
          kind,
          line: i,
          table: carry.length >= 2 && table ? table.id : undefined,
        });
    });
    carry = [];
  });
  // With several VAT-rate rows, each row's gross is only a part; their sum is the total.
  const rows = new Map<number, Set<number>>();
  for (const a of out)
    if (a.table !== undefined) rows.set(a.table, (rows.get(a.table) ?? new Set()).add(a.line));
  for (const [id, lineSet] of rows) {
    if (lineSet.size < 2) continue;
    const gross = out.filter((a) => a.table === id && a.kind === "brutto");
    gross.forEach((a) => (a.kind = "subtotal"));
    if (gross.length)
      out.push({
        value: Math.round(gross.reduce((t, a) => t + a.value, 0) * 100) / 100,
        kind: "brutto",
        line: id,
      });
  }
  return out;
}

const near = (a: number, b: number, tolerance = 0.02) => Math.abs(a - b) <= tolerance + 1e-9;
const cents = (n: number) => Math.round(n * 100);

type Scored = { amount: number; score: number; corroborated: boolean };

function scoreText(text: string): Map<number, Scored> {
  const amounts = labelledAmounts(text);
  const of = (...kinds: Kind[]) =>
    amounts.filter((a) => a.kind && kinds.includes(a.kind) && a.value > 0).map((a) => a.value);
  const net = of("net", "base");
  const vat = of("vat");
  const given = of("given");
  const change = of("change");
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

  const candidates = new Map<number, { amount: number; weight: number; lines: Set<number> }>();
  const add = (value: number, weight: number, line: number) => {
    if (value <= 0 || value > 10_000_000) return;
    const c = candidates.get(cents(value)) ?? {
      amount: value,
      weight: 0,
      lines: new Set<number>(),
    };
    c.weight = Math.max(c.weight, weight);
    if (line >= 0) c.lines.add(line);
    candidates.set(cents(value), c);
  };
  for (const a of amounts) if (a.kind && WEIGHT[a.kind]) add(a.value, WEIGHT[a.kind]!, a.line);
  // Net + VAT pairs with a plausible German VAT rate imply a gross total even if it was misread.
  for (const n of net)
    for (const v of vat)
      if (near(v, n * 0.19, 0.03) || near(v, n * 0.07, 0.03))
        add(Math.round((n + v) * 100) / 100, 0, -1);

  const out = new Map<number, Scored>();
  for (const [key, c] of candidates) {
    let bonus = 0;
    if (c.lines.size > 1) bonus += Math.min(4, 2 * (c.lines.size - 1));
    const netVat =
      net.some((n) => vat.some((v) => near(n + v, c.amount))) ||
      (net.length > 1 && vat.length > 1 && near(sum(net) + sum(vat), c.amount));
    if (netVat) bonus += 5;
    const tolerance = Math.max(0.03, c.amount * 0.001);
    if (
      vat.some(
        (v) =>
          near((v * 119) / 19, c.amount, tolerance) || near((v * 107) / 7, c.amount, tolerance),
      )
    )
      bonus += 3;
    if (given.some((g) => change.some((r) => near(g - r, c.amount, 0.01)))) bonus += 4;
    out.set(key, { amount: c.amount, score: c.weight + bonus, corroborated: bonus > 0 });
  }
  return out;
}

/**
 * Picks the total from labelled candidates, cross-checked by repeated payment lines,
 * net + VAT = gross, VAT-rate math and given − change, across all OCR passes.
 */
export function analyzeTotal(texts: string[]): { amount: number | null; confident: boolean } {
  const merged = new Map<number, Scored & { texts: number }>();
  for (const text of texts.filter(Boolean)) {
    for (const [key, s] of scoreText(text)) {
      const prev = merged.get(key);
      merged.set(
        key,
        prev
          ? {
              amount: s.amount,
              score: Math.max(prev.score, s.score),
              corroborated: prev.corroborated || s.corroborated,
              texts: prev.texts + 1,
            }
          : { ...s, texts: 1 },
      );
    }
  }
  const ranked = [...merged.values()]
    .map((s) => ({
      ...s,
      score: s.score + 2 * (s.texts - 1),
      corroborated: s.corroborated || s.texts > 1,
    }))
    .sort((a, b) => b.score - a.score || b.amount - a.amount);
  const best = ranked[0];
  if (best) return { amount: best.amount, confident: best.corroborated };
  const loose = labelledAmounts(texts[0] ?? "")
    .filter((a) => !a.kind && a.value > 0)
    .map((a) => a.value);
  return { amount: loose.length ? Math.max(...loose) : null, confident: false };
}

export function findTotal(text: string): number | null {
  return analyzeTotal([text]).amount;
}

/** True if OCR found amounts but no corroborated total, so another OCR pass may help. */
export function needsSecondPass(text: string): boolean {
  return HAS_AMOUNT.test(normalizeAmounts(text)) && !analyzeTotal([text]).confident;
}

const MONTHS: Record<string, number> = {
  januar: 1,
  jan: 1,
  februar: 2,
  feb: 2,
  märz: 3,
  maerz: 3,
  mär: 3,
  mrz: 3,
  april: 4,
  apr: 4,
  mai: 5,
  juni: 6,
  jun: 6,
  juli: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  oktober: 10,
  okt: 10,
  november: 11,
  nov: 11,
  dezember: 12,
  dez: 12,
};

function iso(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function findDates(text: string): string[] {
  const out: string[] = [];
  const re =
    /(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{4}|\d{2})(?!\d)|(\d{4})-(\d{2})-(\d{2})|(\d{1,2})\.\s*([A-Za-zäÄ]{3,9})\.?\s+(\d{4})/g;
  for (const m of text.matchAll(re)) {
    let v: string | null = null;
    if (m[1]) v = iso(Number(m[3]), Number(m[2]), Number(m[1]));
    else if (m[4]) v = iso(Number(m[4]), Number(m[5]), Number(m[6]));
    else if (m[7]) {
      const mon = MONTHS[(m[8] ?? "").toLowerCase()];
      if (mon) v = iso(Number(m[9]), mon, Number(m[7]));
    }
    if (v) out.push(v);
  }
  return out;
}

const DATE_LABEL = /(rechnungs|beleg|angebots|bestell|kauf)?datum\b|\bdate\b/i;
const NOT_DOC_DATE =
  /(liefer|leistung|geburt|f[äa]llig|zahlbar|g[üu]ltig|\bbis\b|offen|valuta|seit\b|auftrag erteilt)/i;

/** Document date: a labelled date ("Rechnungsdatum", "Datum") first, else the first unrelated date. */
export function findDocDate(text: string, due: string | null = null): string | null {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!DATE_LABEL.test(line) || NOT_DOC_DATE.test(line)) continue;
    const next = lines[i + 1] ?? "";
    const d = findDates(line)[0] ?? (NOT_DOC_DATE.test(next) ? undefined : findDates(next)[0]);
    if (d) return d;
  }
  const plain = lines
    .filter((l) => !NOT_DOC_DATE.test(l))
    .flatMap(findDates)
    .find((d) => d !== due);
  return plain ?? findDates(text).find((d) => d !== due) ?? null;
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Due date: explicit ("zahlbar bis 16.04.") or relative to the document date ("zahlbar innerhalb 14 Tagen"). */
export function findDueDate(text: string, docDate: string | null = null): string | null {
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (/(zahlbar bis|f[äa]llig|zahlungsziel|sp[äa]testens)/i.test(line)) {
      const d = findDates(line);
      if (d[0]) return d[0];
    }
  }
  if (!docDate) return null;
  for (const line of lines) {
    if (/skonto|%/i.test(line)) continue;
    const m =
      line.match(/(?:zahlbar|zahlungsziel|f[äa]llig|zahlung)\D{0,40}?(\d{1,3})\s*tag/i) ??
      line.match(/\b(\d{1,3})\s*tage\s*netto/i);
    if (m && Number(m[1]) > 0 && Number(m[1]) <= 180) return addDays(docDate, Number(m[1]));
    if (/zahlbar\s+(sofort|ohne abzug)|sofort\s+zahlbar|f[äa]llig\s+sofort/i.test(line))
      return docDate;
  }
  return null;
}

export function detectType(text: string): DocType {
  const t = text.toLowerCase();
  if (
    /(kassenbon|kassenbeleg|bon[- ]?nr|kasse\s*\d|r[üu]ckgeld|sicherheitseinrichtung|tse[- ]?(signatur|seriennummer|transaktion)|vielen dank f[üu]r ihren einkauf)/.test(
      t,
    )
  )
    return "kassenzettel";
  if (
    /(rechnungsnummer|rechnungs-?nr|rechnung\s*nr|rechnungsdatum|rechnungsbetrag|invoice (no|number))/.test(
      t,
    )
  )
    return "rechnung";
  if (/(angebot|kostenvoranschlag|angebotsnummer|g[üu]ltig bis|bindefrist)/.test(t))
    return "angebot";
  if (/(\bbar\b|girocard|ec[- ]?(karte|cash)|kartenzahlung|kundenbeleg|quittung|zu zahlen)/.test(t))
    return "kassenzettel";
  if (/(rechnung|invoice)/.test(t)) return "rechnung";
  if (/(vertrag|vereinbarung|auftragsbest[äa]tigung)/.test(t)) return "vertrag";
  if (/(datenblatt|technische daten|produktdatenblatt)/.test(t)) return "datenblatt";
  if (/(grundriss|maßstab|massstab|schnitt [a-z]-[a-z])/.test(t)) return "plan";
  return "sonstiges";
}

const CATEGORIES: [string, RegExp][] = [
  [
    "Baumarkt",
    /(hornbach|obi\b|bauhaus|toom|hagebau|globus baumarkt|baumarkt|bauking|hellweg|raiffeisen)/i,
  ],
  ["Werkzeug", /(werkzeug|bohrer|akku|säge|saege|schrauber|bit[- ]?set|zange|hammer)/i],
  ["Entsorgung", /(entsorgung|container|wertstoff|recyclinghof|deponie|sperrmüll)/i],
  ["Gebühren", /(gebühr|gebuehr|genehmigung|bauamt|landratsamt|stadtkasse)/i],
  [
    "Transport",
    /(tankstelle|aral|shell|esso|total ?energies|jet\b|avia\b|agip|diesel|benzin|super e10|transporter|miete.*anhänger|sixt|europcar)/i,
  ],
  ["Verpflegung", /(bäckerei|baeckerei|restaurant|imbiss|pizza|kaffee|metzgerei|mcdonald|burger)/i],
  [
    "Material",
    /(fliese|farbe|holz|gips|zement|mörtel|kleber|dämm|kabel|rohr|silikon|laminat|parkett|platte)/i,
  ],
];

export function detectCategory(text: string): string {
  for (const [c, re] of CATEGORIES) if (re.test(text)) return c;
  return "Sonstiges";
}

/** Store chains: [display name, pattern]. `anywhere` chains are distinctive enough to match outside the header. */
const CHAINS: { name: string; re: RegExp; anywhere: boolean }[] = [
  ["Hornbach", /hornbach/i, true],
  ["OBI", /\bobi\b/i, true],
  ["Bauhaus", /\bbauhaus\b/i, true],
  ["toom", /\btoom\b/i, true],
  ["Hagebau", /hagebau/i, true],
  ["Globus", /\bglobus\b/i, true],
  ["BAUKING", /bauking/i, true],
  ["Hellweg", /\bhellweg\b/i, true],
  ["Sonderpreis Baumarkt", /sonderpreis\s*baumarkt/i, true],
  ["Würth", /\bw[üu]e?rth\b/i, true],
  ["IKEA", /\bikea\b/i, true],
  ["Aldi", /\baldi\b/i, true],
  ["Lidl", /\blidl\b/i, true],
  ["Rewe", /\brewe\b/i, true],
  ["Edeka", /\bedeka\b/i, true],
  ["Penny", /\bp\s?e\s?n\s?n\s?y\b/i, true],
  ["Kaufland", /kaufland/i, true],
  ["Rossmann", /rossmann/i, true],
  ["Netto", /netto[\s-]*(marken|online)/i, true],
  ["dm", /dm[\s-]*drogerie/i, true],
  ["Aral", /\baral\b/i, true],
  ["Shell", /\bshell\b/i, false],
  ["Esso", /\besso\b/i, true],
  ["JET", /^\s*jet\b/im, false],
  ["TotalEnergies", /total\s?energies/i, true],
  ["Metro", /\bmetro\b/i, false],
  ["Raiffeisen", /raiffeisen\s*markt/i, false],
].map(([name, re, anywhere]) => ({
  name: name as string,
  re: re as RegExp,
  anywhere: anywhere as boolean,
}));

function levenshtein(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length]!;
}

const GENERIC_CHAIN = /^(netto|globus|metro|penny)$/;

function chainIn(lines: string[], anywhereOnly: boolean): string | null {
  const text = lines.join("\n");
  for (const c of CHAINS) if ((!anywhereOnly || c.anywhere) && c.re.test(text)) return c.name;
  if (anywhereOnly) return null;
  // OCR-tolerant match of longer chain names in the header ("H0RNBACH", "Kauf1and").
  const words = text
    .toLowerCase()
    .split(/[^\p{L}\d]+/u)
    .filter((w) => w.length >= 5);
  for (const c of CHAINS) {
    const name = c.name.toLowerCase();
    // "Netto"/"Globus" are also ordinary words on receipts; only their exact patterns count.
    if (name.length < 5 || name.includes(" ") || GENERIC_CHAIN.test(name)) continue;
    if (words.some((w) => levenshtein(w, name) <= (name.length >= 8 ? 2 : 1))) return c.name;
  }
  return null;
}

/** Joins letter-spaced headings ("D a c h d e c k e r e i" → "Dachdeckerei") and trims. */
function cleanLine(raw: string): string {
  return raw
    .split(/\s{2,}|\s+\/\s+/)
    .map((part) => (/^(\S\s){2,}\S$/.test(part.trim()) ? part.replace(/\s/g, "") : part.trim()))
    .filter(Boolean)
    .join(raw.includes(" / ") ? " / " : " ")
    .trim();
}

const LEGAL_FORM = /\b(GmbH|AG|KG|e\.\s?K\.|UG|OHG|GbR|mbH|Inh\.)/;
const PLZ_CITY = /\b\d{5}\s+[A-ZÄÖÜ][a-zäöüß]/;
const STREET = /(stra(ß|ss)e|str\.|weg|allee|platz|ring|gasse|damm|chaussee)\s*\d/i;
const CONTACT_LINE = /^(tel|fon|fax|telefon|mobil|e-?mail|www\.|http|ust|steuer|st\.?\s?nr)/i;
const RECIPIENT =
  /^(fam\.?|familie|herrn?\b|frau\b|an\b|kunde\b|rechnungsempf|lieferanschrift|empf[äa]nger)/i;
const VENDOR_SKIP =
  /^(rechnung|angebot|kassenbon|beleg|quittung|kundenbeleg|datum|seite|tel|fax|www|http|ust|steuer|kunde|nr\b|position|menge|sehr geehrte|\d)/i;
const TRADE_WORD =
  /(erei|bau|betrieb|service|technik|handwerk|meister|tankstelle|markt|werkstatt|installation|elektro|sanit[äa]r|heizung|maler|tischler|schreiner)$/i;

function plausibleName(line: string): boolean {
  const letters = (line.match(/\p{L}/gu) ?? []).length;
  const words = line.split(/\s+/).filter(Boolean);
  const avgWord = words.reduce((a, w) => a + w.length, 0) / Math.max(1, words.length);
  return (
    letters >= 3 &&
    letters / line.replace(/\s/g, "").length >= 0.6 &&
    avgWord >= 2.5 &&
    line.length <= 60 &&
    !VENDOR_SKIP.test(line) &&
    !HAS_AMOUNT.test(line) &&
    findDates(line).length === 0
  );
}

/** Line indices of the recipient address block (customer), which must never become the vendor. */
function recipientLines(lines: string[]): Set<number> {
  const out = new Set<number>();
  lines.forEach((l, i) => {
    if (!RECIPIENT.test(l)) return;
    for (let j = i; j < Math.min(lines.length, i + 5) && lines[j]!.trim(); j++) out.add(j);
  });
  return out;
}

export function findVendor(text: string): string | null {
  // "Firma GmbH · Straße 1 · 12345 Ort" → the part before the first separator names the sender.
  const raw = text.split(/\r?\n/).map(cleanLine);
  const lines = raw.map((l) => l.split(/\s+[·•|]\s+/)[0]!);
  const recipient = recipientLines(lines);
  const firstContent = lines.findIndex((l) => l.trim());
  const anchor = lines.findIndex(
    (l, i) =>
      i > firstContent &&
      (PLZ_CITY.test(l) || STREET.test(l) || CONTACT_LINE.test(l) || /\d+[.,]\d{2}\b/.test(l)),
  );
  const headerEnd = anchor > 0 && anchor <= firstContent + 8 ? anchor : firstContent + 4;
  const header = lines
    .map((l, i) => ({ l, i }))
    .filter(({ l, i }) => i < headerEnd && l && !recipient.has(i));

  const chain =
    chainIn(
      header.map((h) => h.l),
      false,
    ) ?? chainIn(lines, true);
  if (chain) return chain;

  const legal = header.find(({ l }) => LEGAL_FORM.test(l) && plausibleName(l));
  if (legal) return legal.l.slice(0, 80);
  const named = header.find(({ l }) => plausibleName(l));
  if (named) {
    const name = named.l.split(" / ")[0]!;
    // "Krause" + "Dachdeckerei / Bauklempnerei" → "Dachdeckerei Krause".
    if (!/\s/.test(name)) {
      const trade = header.find(
        ({ l, i }) =>
          Math.abs(i - named.i) <= 2 &&
          i !== named.i &&
          TRADE_WORD.test(l.split(" / ")[0]!) &&
          !/\s/.test(l.split(" / ")[0]!),
      );
      if (trade) return `${trade.l.split(" / ")[0]} ${name}`.slice(0, 80);
    }
    return name.slice(0, 80);
  }
  // Sender line in the address window: "Firma GmbH · Straße 1 · 12345 Ort".
  const sender = raw.find((l, i) => !recipient.has(i) && /[·•|]/.test(l) && PLZ_CITY.test(l));
  if (sender) {
    const first = sender.split(/\s*[·•|]\s*/)[0]!;
    if (plausibleName(first)) return first.slice(0, 80);
  }
  const company = lines.find(
    (l, i) => i < firstContent + 10 && !recipient.has(i) && LEGAL_FORM.test(l) && plausibleName(l),
  );
  return company ? company.slice(0, 80) : null;
}

const MAIL_PROVIDERS =
  /^(gmail|googlemail|gmx|web|t-online|outlook|hotmail|live|yahoo|icloud|me|posteo|freenet|aol|mail|online|arcor|vodafone|1und1|ionos)\./i;

function domains(s: string): string[] {
  const out = new Set<string>();
  for (const m of s
    .toLowerCase()
    .matchAll(/(?:@|www\.|https?:\/\/)([a-z0-9][a-z0-9.-]*\.[a-z]{2,})/g)) {
    const d = m[1]!.replace(/^www\./, "");
    if (!MAIL_PROVIDERS.test(d)) out.add(d);
  }
  return [...out];
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\d]+/gu, " ")
    .trim();
const phoneDigits = (s: string) => s.replace(/^\+49/, "0").replace(/\D/g, "");

/** Finds the known contact a document comes from via tax IDs, IBAN, domain, phone or name. */
export function matchContact(
  text: string,
  contacts: ContactRef[],
  extra: { ibans?: string[]; vatIds?: string[] } = {},
): ContactRef | null {
  if (!contacts.length) return null;
  const lines = text.split(/\r?\n/);
  const recipient = recipientLines(lines.map(cleanLine));
  const senderText = lines.filter((_, i) => !recipient.has(i)).join("\n");
  const ids = new Set([
    ...findVatIds(text),
    ...findTaxNumbers(text),
    ...findIbans(text),
    ...(extra.ibans ?? []),
    ...(extra.vatIds ?? []),
  ]);
  const docDomains = new Set(domains(text));
  const docDigits = lines.map(phoneDigits).filter((d) => d.length >= 6);
  const docNorm = ` ${norm(senderText)} `;

  let best: { c: ContactRef; score: number } | null = null;
  let tie = false;
  for (const c of contacts) {
    const fields = [c.email, c.website, c.notes, c.phone].filter(Boolean).join("\n");
    let score = 0;
    const cIds = [...findVatIds(fields), ...findTaxNumbers(fields), ...findIbans(fields)];
    if (cIds.some((id) => ids.has(id))) score = Math.max(score, 10);
    if (domains(fields).some((d) => docDomains.has(d))) score = Math.max(score, 6);
    const phone = c.phone ? phoneDigits(c.phone) : "";
    if (phone.length >= 7 && docDigits.some((d) => d.includes(phone))) score = Math.max(score, 5);
    const company = c.company ? norm(c.company) : "";
    if (company.length >= 4 && docNorm.includes(` ${company} `)) score = Math.max(score, 4);
    const name = norm(c.name);
    if (name.length >= 4 && docNorm.includes(` ${name} `)) score = Math.max(score, 3);
    if (score === 0) continue;
    if (!best || score > best.score) {
      best = { c, score };
      tie = false;
    } else if (score === best.score) tie = true;
  }
  return best && !tie ? best.c : null;
}

export function findTrade(text: string, trades: string[]): string | null {
  const t = text.toLowerCase();
  return trades.find((name) => name.length > 2 && t.includes(name.toLowerCase())) ?? null;
}

const LABEL: Record<DocType, string> = {
  angebot: "Angebot",
  rechnung: "Rechnung",
  kassenzettel: "Kassenzettel",
  vertrag: "Vertrag",
  plan: "Plan",
  datenblatt: "Datenblatt",
  foto: "Foto",
  sonstiges: "Dokument",
};

/**
 * Extraction order: e-invoice XML and QR codes (exact) → known contacts → OCR heuristics
 * with cross-checked totals.
 */
export function extractFromText(text: string, context: ExtractContext | string[] = {}): Extraction {
  const ctx: ExtractContext = Array.isArray(context) ? { trades: context } : context;
  const codes = ctx.codes ?? [];
  const invoice = (ctx.xml ?? []).map(parseEInvoiceXml).find((x) => x !== null) ?? null;
  const tse = codes.map(parseTseQr).find((x) => x !== null) ?? null;
  const epc = codes.map(parseEpcQr).find((x) => x !== null) ?? null;

  const allText = [text, ...(ctx.alternates ?? [])].join("\n");
  let doc_type: DocType = invoice ? "rechnung" : tse ? "kassenzettel" : detectType(allText);
  const contact = matchContact(text, ctx.contacts ?? [], {
    ibans: [invoice?.iban, epc?.iban].filter((x): x is string => !!x),
    vatIds: invoice?.sellerVatId ? [invoice.sellerVatId] : [],
  });
  const vendor =
    (contact ? contact.company || contact.name : null) ??
    invoice?.seller ??
    epc?.name ??
    findVendor(text);
  // Retail chains only issue receipts to private customers.
  if (doc_type === "sonstiges" && CHAINS.some((c) => c.name === vendor)) doc_type = "kassenzettel";
  const money = doc_type === "angebot" || doc_type === "rechnung" || doc_type === "kassenzettel";
  const structuredAmount = invoice?.total ?? tse?.gross ?? epc?.amount ?? null;
  const amount =
    structuredAmount ?? (money ? analyzeTotal([text, ...(ctx.alternates ?? [])]).amount : null);
  const explicitDue = invoice?.dueDate ?? null;
  const date =
    invoice?.issueDate ??
    tse?.date ??
    (doc_type === "kassenzettel" ? parseTseText(text) : null) ??
    findDocDate(text, findDueDate(text));
  const due = explicitDue ?? findDueDate(text, date);
  const category = detectCategory(`${vendor ?? ""}\n${text}`);
  const title = vendor ? `${LABEL[doc_type]} ${vendor}` : LABEL[doc_type];
  return {
    doc_type,
    vendor,
    contact_id: contact?.id ?? null,
    title,
    amount,
    date,
    due_date: due,
    trade: findTrade(text, ctx.trades ?? []) ?? contact?.trade ?? null,
    expense_category: doc_type === "kassenzettel" || doc_type === "rechnung" ? category : null,
    summary: null,
    tags: category !== "Sonstiges" ? [category] : [],
  };
}
