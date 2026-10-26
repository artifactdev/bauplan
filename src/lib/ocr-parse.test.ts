import { describe, expect, it } from "vitest";
import { extractFromText, findTotal, findDates } from "./ocr-parse";

const BON = `HORNBACH Baumarkt
Musterstr. 1, 12345 Stadt
Bon-Nr 4711   12.03.2026
Fliesenkleber 25kg   18,99
Silikon weiß          6,49
Zwischensumme        25,48
MwSt 19%              4,07
SUMME EUR            25,48
Gegeben Bar          30,00
Rückgeld              4,52`;

describe("ocr-parse", () => {
  it("reads total from a receipt, ignoring change and tax", () => {
    expect(findTotal(BON)).toBe(25.48);
  });
  it("detects receipt, vendor, date and category", () => {
    const r = extractFromText(BON, ["Fliesen"]);
    expect(r.doc_type).toBe("kassenzettel");
    expect(r.vendor).toBe("Hornbach");
    expect(r.date).toBe("2026-03-12");
    expect(r.expense_category).toBe("Baumarkt");
  });
  it("parses German thousands and due date on invoices", () => {
    const inv = `Malerbetrieb Huber GmbH\nRechnung Nr. 2026-15\nRechnungsdatum: 02.04.2026\nNetto 3.361,34\nMwSt 638,66\nRechnungsbetrag 4.000,00 €\nZahlbar bis 16.04.2026`;
    const r = extractFromText(inv);
    expect(r.doc_type).toBe("rechnung");
    expect(r.amount).toBe(4000);
    expect(r.date).toBe("2026-04-02");
    expect(r.due_date).toBe("2026-04-16");
    expect(r.vendor).toBe("Malerbetrieb Huber GmbH");
  });
  it("parses written month dates", () => {
    expect(findDates("Datum: 5. März 2026")).toEqual(["2026-03-05"]);
  });
});
