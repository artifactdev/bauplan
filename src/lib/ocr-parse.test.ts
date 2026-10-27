import { describe, expect, it } from "vitest";
import { extractFromText, findTotal, findDates, matchContact, needsSecondPass, type ContactRef } from "./ocr-parse";

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

describe("structured data and contacts", () => {
  const contact = (over: Partial<ContactRef>): ContactRef => ({
    id: "c", name: "", company: null, email: null, website: null, phone: null, notes: null, trade: null, ...over,
  });
  const offer = `Lehmann\nDachdeckerei\nTel. 03573/123456\ninfo@lehmann-dach.example\n01968 Senftenberg\nFam. Beispiel\nAngebot Nr. 5\nDatum: 26.08.2026\nSumme 1.190,00`;

  it("matches a contact by e-mail domain, ignoring public mail providers", () => {
    const contacts = [
      contact({ id: "a", name: "Paul Lehmann", email: "paul@lehmann-dach.example", trade: "Dachdecker" }),
      contact({ id: "b", name: "Other", email: "lehmann@gmail.com" }),
    ];
    const r = extractFromText(offer, { contacts });
    expect(r.contact_id).toBe("a");
    expect(r.vendor).toBe("Paul Lehmann");
    expect(r.trade).toBe("Dachdecker");
  });
  it("matches by phone number and IBAN", () => {
    expect(matchContact(offer, [contact({ id: "p", name: "X", phone: "03573 123456" })])?.id).toBe("p");
    const withIban = `${offer}\nIBAN DE89 3704 0044 0532 0130 00`;
    expect(matchContact(withIban, [contact({ id: "i", name: "Y", notes: "IBAN DE89370400440532013000" })])?.id).toBe("i");
  });
  it("does not match the recipient or ambiguous contacts", () => {
    expect(matchContact(offer, [contact({ id: "r", name: "Beispiel" })])).toBeNull();
    expect(matchContact(offer, [contact({ id: "1", name: "Lehmann" }), contact({ id: "2", name: "Lehmann" })])).toBeNull();
  });
  it("prefers e-invoice XML and QR codes over OCR text", () => {
    const xml = `<Invoice><IssueDate>2026-02-03</IssueDate><AccountingSupplierParty><PartyName><Name>Weber</Name></PartyName></AccountingSupplierParty><LegalMonetaryTotal><PayableAmount>2380.00</PayableAmount></LegalMonetaryTotal></Invoice>`;
    expect(extractFromText("Rechnung\nSumme 99,00", { xml: [xml] })).toMatchObject({ doc_type: "rechnung", vendor: "Weber", amount: 2380, date: "2026-02-03" });
    const tse = "V0;1;Kassenbeleg-V1;Beleg^10.00_2.00_0.00_0.00_0.00^12.00:Bar;1;2;2026-05-01T08:00:00.000Z;2026-05-01T08:01:00.000Z;x;y;z;w";
    expect(extractFromText("OBI\nSumme 21,00", { codes: [tse] })).toMatchObject({ doc_type: "kassenzettel", vendor: "OBI", amount: 12, date: "2026-05-01" });
    const epc = "BCD\n002\n1\nSCT\n\nMalermeister Weber\nDE89370400440532013000\nEUR2380.00\n\n\n";
    expect(extractFromText("Rechnung Nr. 4\nBetrag 2.380,00", { codes: [epc] })).toMatchObject({ amount: 2380, vendor: "Malermeister Weber" });
  });
  it("asks for a second OCR pass only when the total is not corroborated", () => {
    expect(needsSecondPass("Summe 12,00\nKartenzahlung 12,00")).toBe(false);
    expect(needsSecondPass("Summe 12,00")).toBe(true);
    expect(needsSecondPass("Kein Betrag")).toBe(false);
  });
});
