/**
 * Parsers for machine-readable data found on receipts and invoices:
 * German TSE receipt QR codes (KassenSichV), EPC/GiroCode payment QR codes and
 * EN 16931 e-invoice XML (ZUGFeRD/Factur-X CII, XRechnung UBL). All local, no AI.
 */

export type TseReceipt = { gross: number | null; date: string | null };
export type EpcPayment = {
  name: string | null;
  iban: string | null;
  amount: number | null;
  reference: string | null;
};
export type EInvoice = {
  seller: string | null;
  sellerVatId: string | null;
  iban: string | null;
  total: number | null;
  issueDate: string | null;
  dueDate: string | null;
  creditNote: boolean;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Calendar date of a UTC instant in Germany (TSE timestamps are UTC). */
export function berlinDate(instant: Date): string | null {
  if (Number.isNaN(instant.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * TSE receipt QR (DSFinV-K): `V0;serial;Kassenbeleg-V1;Beleg^19%_7%_10.7%_5.5%_0%^amount:Bar_…;txn;sig-counter;start;end;…`.
 * The gross total is the sum of the five gross amounts per VAT rate.
 */
export function parseTseQr(payload: string): TseReceipt | null {
  const f = payload.trim().split(";");
  if (f[0] !== "V0" || f.length < 8 || !/^Kassenbeleg/i.test(f[2] ?? "")) return null;
  const [, perRate] = (f[3] ?? "").split("^");
  const values = (perRate ?? "").split("_").map(Number);
  const valid = values.length > 0 && values.every(Number.isFinite);
  const gross = valid ? round2(values.reduce((a, b) => a + b, 0)) : null;
  const stamp = f[7] || f[6];
  return {
    gross: gross !== null && gross > 0 ? gross : null,
    date: stamp ? berlinDate(new Date(stamp)) : null,
  };
}

/**
 * Printed TSE block ("Technische Sicherheitseinrichtung … Start: 2026-10-09T17:37:05.000Z").
 * OCR often garbles the "T"/"Z", so only the date and time digits are trusted.
 */
export function parseTseText(text: string): string | null {
  if (!/(tse|sicherheitseinrichtung|signatur|transaktion)/i.test(text)) return null;
  const m = text.match(
    /\b(?:start|stop|ende|beginn)\s*[:.]?\s*(20\d\d)-(\d\d)-(\d\d)\S?\s?(\d\d):(\d\d)/i,
  );
  if (!m) return null;
  return berlinDate(new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!)));
}

/** EPC069-12 "GiroCode": BCD / version / charset / SCT / BIC / name / IBAN / EUR12.34 / purpose / ref / text. */
export function parseEpcQr(payload: string): EpcPayment | null {
  const lines = payload.split(/\r?\n/).map((l) => l.trim());
  if (lines[0] !== "BCD" || !/^(SCT|INST)$/.test(lines[3] ?? "")) return null;
  const amount = (lines[7] ?? "").match(/^EUR\s?(\d+(?:\.\d{1,2})?)$/);
  const iban = (lines[6] ?? "").replace(/\s/g, "").toUpperCase();
  return {
    name: lines[5] || null,
    iban: isValidIban(iban) ? iban : null,
    amount: amount ? Number(amount[1]) : null,
    reference: lines[9] || lines[10] || null,
  };
}

/** ISO 13616 mod-97 check. */
export function isValidIban(raw: string): boolean {
  const iban = raw.replace(/\s/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  if (iban.startsWith("DE") && iban.length !== 22) return false;
  const digits = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, (c) =>
    String(c.charCodeAt(0) - 55),
  );
  let rest = 0;
  for (const d of digits) rest = (rest * 10 + Number(d)) % 97;
  return rest === 1;
}

/** Valid IBANs in free text (spaces allowed between groups). */
export function findIbans(text: string): string[] {
  const out = new Set<string>();
  for (const m of text
    .toUpperCase()
    .matchAll(/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}(?:\s?[A-Z0-9]{1,3})?\b/g)) {
    const iban = m[0].replace(/\s/g, "");
    if (isValidIban(iban)) out.add(iban);
  }
  return [...out];
}

/** German VAT IDs (USt-IdNr, DE + 9 digits) in free text. */
export function findVatIds(text: string): string[] {
  return [
    ...new Set(
      [...text.matchAll(/\bDE\s?(\d{3})\s?(\d{3})\s?(\d{3})\b/g)].map(
        (m) => `DE${m[1]}${m[2]}${m[3]}`,
      ),
    ),
  ];
}

/** German tax numbers (Steuernummer) like 209/230/11995. */
export function findTaxNumbers(text: string): string[] {
  return [...new Set([...text.matchAll(/\b\d{2,3}\/\d{3}\/\d{4,5}\b/g)].map((m) => m[0]))];
}

function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

/** Inner XML of the first element with this local name, searched within `xml`. */
function element(xml: string | null, name: string): string | null {
  if (!xml) return null;
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  return m ? m[1]! : null;
}

/** Follows a path of nested local element names. */
function path(xml: string | null, ...names: string[]): string | null {
  let cur = xml;
  for (const name of names) cur = element(cur, name);
  return cur === null ? null : decodeXml(cur) || null;
}

function xmlDate(raw: string | null): string | null {
  const v = raw?.trim();
  if (!v) return null;
  const m = v.match(/^(\d{4})-?(\d{2})-?(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function xmlAmount(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number(raw.trim());
  return Number.isFinite(n) ? round2(n) : null;
}

/** Reads the main fields of a CII (ZUGFeRD/Factur-X) or UBL (XRechnung) invoice. */
export function parseEInvoiceXml(raw: string): EInvoice | null {
  // Namespace prefixes are irrelevant here; matching on local names keeps the reader tiny.
  const xml = raw.replace(/<(\/?)[A-Za-z_][\w.-]*:/g, "<$1");
  if (/<(CrossIndustryInvoice|CrossIndustryDocument)[\s>]/.test(xml)) {
    const seller = element(xml, "SellerTradeParty");
    const header = element(xml, "ExchangedDocument") ?? element(xml, "HeaderExchangedDocument");
    return {
      seller: path(seller, "Name"),
      sellerVatId:
        (seller?.match(/<ID[^>]*schemeID="VA"[^>]*>([^<]+)<\/ID>/)?.[1] ?? null)?.trim() ?? null,
      iban: path(xml, "PayeePartyCreditorFinancialAccount", "IBANID")?.replace(/\s/g, "") ?? null,
      total: xmlAmount(path(xml, "DuePayableAmount")) ?? xmlAmount(path(xml, "GrandTotalAmount")),
      issueDate: xmlDate(path(header, "IssueDateTime", "DateTimeString")),
      dueDate: xmlDate(path(xml, "DueDateDateTime", "DateTimeString")),
      creditNote: path(header, "TypeCode") === "381",
    };
  }
  const root = xml.match(/<(Invoice|CreditNote)[\s>]/)?.[1];
  if (!root) return null;
  const supplier = element(xml, "AccountingSupplierParty");
  const totals = element(xml, "LegalMonetaryTotal");
  return {
    seller:
      path(supplier, "PartyLegalEntity", "RegistrationName") ?? path(supplier, "PartyName", "Name"),
    sellerVatId: path(supplier, "PartyTaxScheme", "CompanyID"),
    iban: path(xml, "PayeeFinancialAccount", "ID")?.replace(/\s/g, "") ?? null,
    total:
      xmlAmount(path(totals, "PayableAmount")) ?? xmlAmount(path(totals, "TaxInclusiveAmount")),
    // The document's own IssueDate comes before any referenced documents.
    issueDate: xmlDate(path(xml, "IssueDate")),
    dueDate: xmlDate(path(xml, "DueDate")) ?? xmlDate(path(xml, "PaymentDueDate")),
    creditNote: root === "CreditNote",
  };
}
