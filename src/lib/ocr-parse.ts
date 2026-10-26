/** Rule-based extraction of receipt/invoice fields from raw OCR text (no AI). */
export const DOC_TYPES = ["angebot", "rechnung", "kassenzettel", "vertrag", "plan", "datenblatt", "foto", "sonstiges"] as const;
export type DocType = (typeof DOC_TYPES)[number];

export type Extraction = {
  doc_type: DocType;
  vendor: string | null;
  title: string | null;
  amount: number | null;
  date: string | null;
  due_date: string | null;
  trade: string | null;
  expense_category: string | null;
  summary: string | null;
  tags: string[];
};

const AMOUNT_RE = /(-?\d{1,3}(?:[.\s]\d{3})*,\d{2}|-?\d+,\d{2}|-?\d+\.\d{2})(?!\d)/g;

export function parseAmount(s: string): number | null {
  const m = s.match(/-?\d{1,3}(?:[.\s]\d{3})*,\d{2}|-?\d+,\d{2}|-?\d+\.\d{2}/);
  if (!m) return null;
  let v = m[0].replace(/\s/g, "");
  v = v.includes(",") ? v.replace(/\./g, "").replace(",", ".") : v;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function amountsIn(line: string): number[] {
  return [...line.matchAll(AMOUNT_RE)].map((m) => parseAmount(m[0])).filter((n): n is number => n !== null);
}

const PRIORITY = [/gesamtbetrag|rechnungsbetrag|endbetrag|zu zahlen|zahlbetrag|bruttobetrag|summe brutto|gesamt brutto|angebotssumme|gesamtsumme/i, /summe|gesamt|total/i, /\bbar\b|ec[- ]?karte|girocard|betrag/i];
const NOT_TOTAL = /(netto|mwst|ust|steuer|zwischensumme|rückgeld|rueckgeld|gegeben|nachlass|rabatt)/i;

export function findTotal(text: string): number | null {
  const lines = text.split(/\r?\n/);
  for (const re of PRIORITY) {
    const hits: number[] = [];
    lines.forEach((l, i) => {
      if (!re.test(l) || NOT_TOTAL.test(l)) return;
      const a = amountsIn(l);
      const next = lines[i + 1];
      if (a.length) hits.push(...a.slice(-1));
      else if (next) hits.push(...amountsIn(next).slice(-1));
    });
    const pos = hits.filter((n) => n > 0);
    if (pos.length) return Math.max(...pos);
  }
  const all = lines.filter((l) => !NOT_TOTAL.test(l)).flatMap(amountsIn).filter((n) => n > 0);
  return all.length ? Math.max(...all) : null;
}

const MONTHS: Record<string, number> = { januar: 1, jan: 1, februar: 2, feb: 2, märz: 3, maerz: 3, mär: 3, mrz: 3, april: 4, apr: 4, mai: 5, juni: 6, jun: 6, juli: 7, jul: 7, august: 8, aug: 8, september: 9, sep: 9, sept: 9, oktober: 10, okt: 10, november: 11, nov: 11, dezember: 12, dez: 12 };

function iso(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function findDates(text: string): string[] {
  const out: string[] = [];
  const re = /(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{4}|\d{2})(?!\d)|(\d{4})-(\d{2})-(\d{2})|(\d{1,2})\.\s*([A-Za-zäÄ]{3,9})\.?\s+(\d{4})/g;
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

export function findDueDate(text: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    if (/(zahlbar bis|fällig|faellig|zahlungsziel|spätestens)/i.test(line)) {
      const d = findDates(line);
      if (d[0]) return d[0];
    }
  }
  return null;
}

export function detectType(text: string): DocType {
  const t = text.toLowerCase();
  if (/(angebot|kostenvoranschlag|angebotsnummer|gültig bis|bindefrist)/.test(t)) return "angebot";
  if (/(kassenbon|kassenbeleg|bon[- ]?nr|kasse\s*\d|\bbar\b|rückgeld|girocard|ec[- ]?karte|kartenzahlung|vielen dank für ihren einkauf)/.test(t)) return "kassenzettel";
  if (/(rechnung|rechnungsnummer|rechnungs-nr|invoice)/.test(t)) return "rechnung";
  if (/(vertrag|vereinbarung|auftragsbestätigung)/.test(t)) return "vertrag";
  if (/(datenblatt|technische daten|produktdatenblatt)/.test(t)) return "datenblatt";
  if (/(grundriss|maßstab|massstab|schnitt [a-z]-[a-z])/.test(t)) return "plan";
  return "sonstiges";
}

const CATEGORIES: [string, RegExp][] = [
  ["Baumarkt", /(hornbach|obi\b|bauhaus|toom|hagebau|globus baumarkt|baumarkt|bauking|raiffeisen)/i],
  ["Werkzeug", /(werkzeug|bohrer|akku|säge|saege|schrauber|bit[- ]?set|zange|hammer)/i],
  ["Entsorgung", /(entsorgung|container|wertstoff|recyclinghof|deponie|sperrmüll)/i],
  ["Gebühren", /(gebühr|gebuehr|genehmigung|bauamt|landratsamt|stadtkasse)/i],
  ["Transport", /(tankstelle|aral|shell|esso|total ?energies|jet\b|diesel|benzin|transporter|miete.*anhänger|sixt|europcar)/i],
  ["Verpflegung", /(bäckerei|baeckerei|restaurant|imbiss|pizza|kaffee|metzgerei|mcdonald|burger)/i],
  ["Material", /(fliese|farbe|holz|gips|zement|mörtel|kleber|dämm|kabel|rohr|silikon|laminat|parkett|platte)/i],
];

export function detectCategory(text: string): string {
  for (const [c, re] of CATEGORIES) if (re.test(text)) return c;
  return "Sonstiges";
}

const VENDOR_SKIP = /^(rechnung|angebot|kassenbon|beleg|quittung|datum|seite|tel|fax|www|http|ust|steuer|kunde|nr\b|\d)/i;

export function findVendor(text: string): string | null {
  const k = text.match(/(hornbach|obi|bauhaus|toom|hagebau|bauking|globus)/i)?.[1];
  if (k) return k.charAt(0).toUpperCase() + k.slice(1).toLowerCase();
  const company = text.match(/^.*\b(GmbH|AG|KG|e\.K\.|UG|OHG|GbR)\b.*$/m);
  if (company) return company[0].trim().slice(0, 80);
  for (const raw of text.split(/\r?\n/).slice(0, 8)) {
    const l = raw.trim();
    if (l.length >= 3 && /[a-zäöü]{2}/i.test(l) && !VENDOR_SKIP.test(l) && !AMOUNT_RE.test(l)) return l.slice(0, 80);
    AMOUNT_RE.lastIndex = 0;
  }
  return null;
}

export function findTrade(text: string, trades: string[]): string | null {
  const t = text.toLowerCase();
  return trades.find((name) => name.length > 2 && t.includes(name.toLowerCase())) ?? null;
}

const LABEL: Record<DocType, string> = { angebot: "Angebot", rechnung: "Rechnung", kassenzettel: "Kassenzettel", vertrag: "Vertrag", plan: "Plan", datenblatt: "Datenblatt", foto: "Foto", sonstiges: "Dokument" };

export function extractFromText(text: string, trades: string[] = []): Extraction {
  const doc_type = detectType(text);
  const vendor = findVendor(text);
  const money = doc_type === "angebot" || doc_type === "rechnung" || doc_type === "kassenzettel";
  const due = findDueDate(text);
  const date = findDates(text).find((d) => d !== due) ?? null;
  const category = detectCategory(text);
  const title = vendor ? `${LABEL[doc_type]} ${vendor}` : LABEL[doc_type];
  return {
    doc_type,
    vendor,
    title,
    amount: money ? findTotal(text) : null,
    date,
    due_date: due,
    trade: findTrade(text, trades),
    expense_category: doc_type === "kassenzettel" || doc_type === "rechnung" ? category : null,
    summary: null,
    tags: category !== "Sonstiges" ? [category] : [],
  };
}
