import { describe, expect, it } from "vitest";
import {
  findIbans,
  findTaxNumbers,
  findVatIds,
  isValidIban,
  parseEInvoiceXml,
  parseEpcQr,
  parseTseQr,
  parseTseText,
} from "./ocr-structured";

const CII = `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"
  xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100"
  xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocument>
    <ram:ID>R-2026-044</ram:ID>
    <ram:TypeCode>380</ram:TypeCode>
    <ram:IssueDateTime><udt:DateTimeString format="102">20260610</udt:DateTimeString></ram:IssueDateTime>
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
    <ram:ApplicableHeaderTradeAgreement>
      <ram:SellerTradeParty>
        <ram:Name>Elektro Schulz &amp; Söhne GmbH</ram:Name>
        <ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">DE123456789</ram:ID></ram:SpecifiedTaxRegistration>
      </ram:SellerTradeParty>
      <ram:BuyerTradeParty><ram:Name>Familie Beispiel</ram:Name></ram:BuyerTradeParty>
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeSettlement>
      <ram:SpecifiedTradeSettlementPaymentMeans>
        <ram:PayeePartyCreditorFinancialAccount><ram:IBANID>DE89 3704 0044 0532 0130 00</ram:IBANID></ram:PayeePartyCreditorFinancialAccount>
      </ram:SpecifiedTradeSettlementPaymentMeans>
      <ram:SpecifiedTradePaymentTerms>
        <ram:DueDateDateTime><udt:DateTimeString format="102">20260624</udt:DateTimeString></ram:DueDateDateTime>
      </ram:SpecifiedTradePaymentTerms>
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:TaxBasisTotalAmount>1400.00</ram:TaxBasisTotalAmount>
        <ram:GrandTotalAmount>1666.00</ram:GrandTotalAmount>
        <ram:TotalPrepaidAmount>500.00</ram:TotalPrepaidAmount>
        <ram:DuePayableAmount>1166.00</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`;

const UBL = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>2026-77</cbc:ID>
  <cbc:IssueDate>2026-02-03</cbc:IssueDate>
  <cbc:DueDate>2026-03-03</cbc:DueDate>
  <cac:AccountingSupplierParty><cac:Party>
    <cac:PartyName><cbc:Name>Weber</cbc:Name></cac:PartyName>
    <cac:PartyTaxScheme><cbc:CompanyID>DE123456789</cbc:CompanyID></cac:PartyTaxScheme>
    <cac:PartyLegalEntity><cbc:RegistrationName>Malermeister Weber</cbc:RegistrationName></cac:PartyLegalEntity>
  </cac:Party></cac:AccountingSupplierParty>
  <cac:PaymentMeans><cac:PayeeFinancialAccount><cbc:ID>DE89370400440532013000</cbc:ID></cac:PayeeFinancialAccount></cac:PaymentMeans>
  <cac:LegalMonetaryTotal>
    <cbc:TaxExclusiveAmount currencyID="EUR">2000.00</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="EUR">2380.00</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="EUR">2380.00</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
</Invoice>`;

describe("TSE receipt data", () => {
  it("sums the gross amounts per VAT rate and converts the end time to German local date", () => {
    const qr =
      "V0;955002-00;Kassenbeleg-V1;Beleg^75.33_7.99_0.00_0.00_0.00^10.00:Bar_73.32:Unbar;18;112;2026-10-09T22:20:04.000Z;2026-10-09T22:30:04.000Z;ecdsa-plain-SHA256;unixTime;MEUCIQ==;BHhWOeis=";
    expect(parseTseQr(qr)).toEqual({ gross: 83.32, date: "2026-10-10" });
  });
  it("ignores other QR codes", () => {
    expect(parseTseQr("https://example.com")).toBeNull();
  });
  it("reads the printed TSE start time", () => {
    expect(
      parseTseText(
        "Technische Sicherheitseinrichtung\nStart: 2026-03-12T13:22:05.000Z\nSignatur: abc",
      ),
    ).toBe("2026-03-12");
    expect(parseTseText("Start: 2026-03-12T13:22")).toBeNull();
  });
});

describe("GiroCode", () => {
  it("reads name, IBAN, amount and reference", () => {
    const epc =
      "BCD\n002\n1\nSCT\nCOBADEFFXXX\nElektro Schulz GmbH\nDE89 3704 0044 0532 0130 00\nEUR1666.00\n\nR-2026-044\n";
    expect(parseEpcQr(epc)).toEqual({
      name: "Elektro Schulz GmbH",
      iban: "DE89370400440532013000",
      amount: 1666,
      reference: "R-2026-044",
    });
  });
  it("rejects payloads that are not EPC codes", () => {
    expect(parseEpcQr("V0;1;Kassenbeleg-V1")).toBeNull();
  });
});

describe("IDs in free text", () => {
  it("validates IBAN checksums", () => {
    expect(isValidIban("DE89 3704 0044 0532 0130 00")).toBe(true);
    expect(isValidIban("DE88 3704 0044 0532 0130 00")).toBe(false);
    expect(
      findIbans("IBAN: DE89 3704 0044 0532 0130 00   BIC COBADEFFXXX\nKonto DE00 1234"),
    ).toEqual(["DE89370400440532013000"]);
  });
  it("finds VAT IDs and tax numbers", () => {
    expect(findVatIds("USt-IdNr. DE 123 456 789")).toEqual(["DE123456789"]);
    expect(findTaxNumbers("St.Nr. 209/230/11995")).toEqual(["209/230/11995"]);
  });
});

describe("e-invoice XML", () => {
  it("reads ZUGFeRD/Factur-X (CII) and prefers the amount still due", () => {
    expect(parseEInvoiceXml(CII)).toEqual({
      seller: "Elektro Schulz & Söhne GmbH",
      sellerVatId: "DE123456789",
      iban: "DE89370400440532013000",
      total: 1166,
      issueDate: "2026-06-10",
      dueDate: "2026-06-24",
      creditNote: false,
    });
  });
  it("reads XRechnung (UBL)", () => {
    expect(parseEInvoiceXml(UBL)).toEqual({
      seller: "Malermeister Weber",
      sellerVatId: "DE123456789",
      iban: "DE89370400440532013000",
      total: 2380,
      issueDate: "2026-02-03",
      dueDate: "2026-03-03",
      creditNote: false,
    });
  });
  it("returns null for other XML", () => {
    expect(parseEInvoiceXml("<note><to>x</to></note>")).toBeNull();
  });
});
