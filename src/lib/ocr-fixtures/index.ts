/**
 * OCR text corpus for the rule-based field extraction. The first two entries are real
 * Tesseract output (names, numbers and IDs anonymised), including the original OCR errors;
 * the rest are synthetic variants of common German receipt and invoice layouts.
 */
export type Fixture = {
  name: string;
  text: string;
  /** Second OCR pass (single-block layout), when the case depends on it. */
  alternates?: string[];
  expected: {
    doc_type: string;
    vendor: string;
    amount: number;
    date: string | null;
    due_date?: string | null;
  };
};

const fuelReceipt = `star Tankstelle

Max Mustermann
Musterstraße 89-91
01127 Dresden
Tel.: 0351-1234567

* 24,54 Liter SÄULENNUMMER 3 *
¥Diesel A 55,19 EUR*
2,249 EUR/Liter

a a er EG © A A — A A a a + 8 A nr a + kt

+KUNDEN B 3 L EG +

Termina nummer 74000001
Datu 09.10.2026
Uhrzeit 19:37:03
Beleg-Nr. 3160
Transaktions-Nr . 224850
3 Kartenzahlung
MASTERCARD
Betrag PA 55,19 EUR
Karte HERE RBERBARHES306
Kar tentoloenunmer
agsnummer
EMV-ATD

ac (it
ontact less

———— ey —— >>. N
——— SE — it —— mt eA Cd BE —

MASTERCARD 55,19 EUR

TOTAL 29,19 EUR

KUNDENBELEG
QUITTUNG
MWST 19,00% A 8,81 EUR
NETTO 46,38 EUR BRUTTO 95,19 EUR

An den star Tankstellen erhalten Sie
ausschließlich Qualitätskraftstoffe, die
den deutschen und europäischen Normen
entsprechen, Der Verkauf von Kraft- und
Schmierstoffen sowie Wäschen erfolgte im
Namen und auf Rechnung der Orlen

Deutschland GmbH.
Technische Sicherheitseinrichtung

# 1070 09.10.26 19:37 Bediener 12 K.000]
St.Nr. Tankstellenpartner: 209/230/00000
Vielen Dank und gute Fahrt!`;

const roofOffer = `Lehmann 
D a c h d e c k e r e i / B a u k l e m p n e r e i 
Tel. 03573/000000
e-Mail: info@lehmann-dach.example
01968 Senftenberg
Musterweg 21 
Seit 01.01.1986
Position   Menge   Beschreibung   Einheitspreis
in EUR in EUR
Gesamtpreis 
1,000   561,20   561,20 1   Stk.   Baustelleneinrichtung sowie Demontage der
49,8   21,20   1.055,76 2   m   Traufverkleidung bestehend aus
Übertrag:   6.049,13 
Sparkasse Musterstadt   IBAN: DE89 3704 0044 0532 0130 00   BIC COBADEFFXXX
HRB 00000   Amtsgericht Dresden   GF : Paul Lehmann Steuer-ID-Nr DE123456789 
Fam. Beispiel
An der Sporthalle 8
01968 Senftenberg 
ANGEBOT Nr.: 20260114   Kunde :   D00001
Tel.:   01700000000
Datum :   26.08.2026
Sehr geehrte Damen und Herren
wir danken für Ihre Anfrage. Wir halten Ihnen unser Angebot bis 07.10.2026 offen. 
Seite 2 Angebot   - Nummer :   20260114   BEISPIEL 
Übertrag:   6.049,13 
8,000   20,00   160,00 14   St   An- und Abfahrt 
Nettosumme:   26.060,47
25.539,26 
abzüglich   521,21 auf   26.060,47   € 2,00 % 
Summe:
30.391,72 
zuzüglich   Mehrwertsteuer   4.852,46 auf   25.539,26   € 19,00   % 
Brutto Gesamt: 
Sparkasse Musterstadt   IBAN: DE89 3704 0044 0532 0130 00   BIC COBADEFFXXX`;

export const FIXTURES: Fixture[] = [
  {
    name: "fuel receipt photo with misread TOTAL and footer GmbH",
    text: fuelReceipt,
    expected: {
      doc_type: "kassenzettel",
      vendor: "star Tankstelle",
      amount: 55.19,
      date: "2026-10-09",
    },
  },
  {
    name: "craftsman offer PDF with letter-spaced trade and recipient block",
    text: roofOffer,
    expected: {
      doc_type: "angebot",
      vendor: "Dachdeckerei Lehmann",
      amount: 30391.72,
      date: "2026-08-26",
    },
  },
  {
    name: "supermarket receipt with given and change",
    text: `REWE Markt GmbH
Hauptstraße 5
10115 Berlin
Milch 1,19 A
Brot 2,49 A
Spülmittel 1,95 B
SUMME EUR 5,63
Geg. BAR EUR 10,00
Rückgeld EUR 4,37
Steuer % Netto Steuer Brutto
A= 7,0% 3,44 0,24 3,68
B= 19,0% 1,64 0,31 1,95
Datum: 14.05.2026 Uhrzeit: 10:12`,
    expected: { doc_type: "kassenzettel", vendor: "Rewe", amount: 5.63, date: "2026-05-14" },
  },
  {
    name: "DIY store receipt with OCR digit confusion in the total",
    text: `HORNBACH Baumarkt AG
Filiale 123
Schrauben 4x40 3,99
Silikon weiß 7,49
Zu zahlen 11,4S
EC-Cash 11,48
MwSt 19% 1,83
Netto 9,65
12.03.2026 14:22`,
    expected: { doc_type: "kassenzettel", vendor: "Hornbach", amount: 11.48, date: "2026-03-12" },
  },
  {
    name: "craftsman invoice with relative payment term",
    text: `Elektro Schulz GmbH · Lindenallee 3 · 04109 Leipzig
Familie Beispiel
Am Markt 1
04109 Leipzig
Rechnung Nr. R-2026-044
Rechnungsdatum: 10.06.2026
Leistungszeitraum 01.06.2026 - 05.06.2026
Pos. Menge Bezeichnung Einzelpreis Gesamt
1 12 Steckdosen setzen 35,00 420,00
2 1 Unterverteilung 980,00 980,00
Nettobetrag 1.400,00
zzgl. 19% MwSt 266,00
Rechnungsbetrag 1.666,00 €
Zahlbar innerhalb 14 Tagen ohne Abzug.
IBAN DE89 3704 0044 0532 0130 00`,
    expected: {
      doc_type: "rechnung",
      vendor: "Elektro Schulz GmbH",
      amount: 1666,
      date: "2026-06-10",
      due_date: "2026-06-24",
    },
  },
  {
    name: "invoice with Skonto and a column header totals row",
    text: `Malermeister Weber
Farbweg 2
80331 München
Rechnung 2026-77
Datum 03.02.2026
Netto MwSt Brutto
2.000,00 380,00 2.380,00
Bei Zahlung bis 13.02.2026 abzüglich 2% Skonto 47,60
Zahlbar bis 03.03.2026`,
    expected: {
      doc_type: "rechnung",
      vendor: "Malermeister Weber",
      amount: 2380,
      date: "2026-02-03",
      due_date: "2026-03-03",
    },
  },
  {
    name: "receipt where only the second OCR pass reads the total",
    text: `Bauhaus
Fliesenkleber 25kg 18,99
Fugenmasse 9,99
Summe 2B,9B
Datum 21.07.2026`,
    alternates: [
      `Bauhaus
Fliesenkleber 25kg 18,99
Fugenmasse 9,99
Summe 28,98
Kartenzahlung 28,98
Datum 21.07.2026`,
    ],
    expected: { doc_type: "kassenzettel", vendor: "Bauhaus", amount: 28.98, date: "2026-07-21" },
  },
];
