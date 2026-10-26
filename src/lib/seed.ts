import { TABLE_NAMES, type TableName } from "./schema";

type Row = Record<string, unknown> & { id: string };

function iso(offsetDays: number) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

/** Realistic demo renovation of a 1960s semi-detached house. */
export function buildSeed(): Record<TableName, Row[]> {
  const id = () => crypto.randomUUID();
  const out = Object.fromEntries(TABLE_NAMES.map((t) => [t, [] as Row[]])) as Record<TableName, Row[]>;

  out.projects.push({ id: id(), name: "Sanierung Doppelhaushälfte", address: "Lindenweg 12, 79098 Freiburg", total_budget: 85000, start_date: iso(-60), end_date: iso(120) });

  const tr = (name: string, budget: number, color: string) => {
    const r = { id: id(), name, budget, color };
    out.trades.push(r);
    return r.id;
  };
  const bad = tr("Bad & Sanitär", 24000, "chart-1");
  const elek = tr("Elektrik", 14000, "chart-3");
  const boden = tr("Bodenbeläge", 12000, "chart-2");
  const kueche = tr("Küche", 18000, "chart-4");
  const maler = tr("Malerarbeiten", 7000, "chart-5");

  const ci = (trade_id: string, title: string, planned: number, description: string | null = null) => {
    const r = { id: id(), trade_id, title, planned, description };
    out.cost_items.push(r);
    return r.id;
  };
  const badRueck = ci(bad, "Rückbau altes Bad", 2500);
  const badInst = ci(bad, "Sanitärinstallation", 9500, "Neue Leitungen, bodengleiche Dusche");
  const badFliesen = ci(bad, "Fliesenarbeiten", 7000);
  const elekVert = ci(elek, "Neuer Zählerschrank", 3800);
  const elekLeit = ci(elek, "Leitungen EG/OG", 8500);
  const parkett = ci(boden, "Eichenparkett Wohnbereich", 9000);
  const kuecheMoebel = ci(kueche, "Küchenmöbel & Geräte", 15000);
  const waende = ci(maler, "Wände & Decken streichen", 5500);

  const off = (trade_id: string, cost_item_id: string | null, contractor: string, title: string, amount: number, status: string, offer_date: number) =>
    out.offers.push({ id: id(), trade_id, cost_item_id, document_id: null, contact_id: null, requested_date: null, contractor, title, amount, status, offer_date: iso(offer_date), notes: null });
  off(bad, badInst, "Haustechnik Kern GmbH", "Sanitärinstallation komplett", 10200, "accepted", -45);
  off(bad, badInst, "Wasser & Wärme Albrecht", "Sanitärinstallation", 11650, "rejected", -44);
  off(bad, badFliesen, "Fliesen Bauer", "Wand- und Bodenfliesen Bad", 6400, "accepted", -30);
  off(bad, badFliesen, "Keramik Studio Ott", "Fliesenarbeiten Bad", 7300, "received", -28);
  off(elek, elekLeit, "Elektro Schneider", "Elektroinstallation EG/OG", 9100, "accepted", -50);
  off(elek, elekVert, "Elektro Schneider", "Zählerschrank inkl. Anmeldung", 4100, "accepted", -50);
  off(boden, parkett, "Parkett Meisterbetrieb Huber", "Eiche geölt, 68 m²", 8700, "received", -10);
  off(boden, parkett, "Bodenwelt Freiburg", "Eiche Landhausdiele, 68 m²", 9450, "received", -8);

  const inv = (trade_id: string, cost_item_id: string, contractor: string, title: string, amount: number, paid: boolean, d: number) =>
    out.invoices.push({ id: id(), trade_id, cost_item_id, document_id: null, contact_id: null, contractor, title, amount, paid, invoice_date: iso(d), due_date: iso(d + 14) });
  inv(bad, badRueck, "Abbruch Wiesner", "Rückbau Bad, Entsorgung", 2850, true, -40);
  inv(bad, badInst, "Haustechnik Kern GmbH", "Abschlag 1 Sanitär", 5000, true, -20);
  inv(elek, elekVert, "Elektro Schneider", "Zählerschrank", 4100, false, -5);

  const task = (title: string, trade_id: string | null, phase: string, priority: string, status: string, due: number | null, notes: string | null = null) =>
    out.tasks.push({ id: id(), title, trade_id, phase, priority, status, due_date: due === null ? null : iso(due), notes, cost_item_id: null, document_id: null });
  task("Fliesen für Bad auswählen", bad, "Planung", "hoch", "erledigt", -25);
  task("Termin Wasser abstellen mit Installateur", bad, "Rohinstallation", "hoch", "erledigt", -18);
  task("Parkettangebote vergleichen und beauftragen", boden, "Planung", "hoch", "offen", -2, "Huber vs. Bodenwelt");
  task("Steckdosenplan Küche finalisieren", elek, "Planung", "mittel", "in_arbeit", 3);
  task("Küchenplanung mit Studio abstimmen", kueche, "Planung", "mittel", "offen", 10);
  task("Rechnung Zählerschrank bezahlen", elek, "Rohinstallation", "hoch", "offen", 9);
  task("Farbtöne für Wohnzimmer festlegen", maler, "Innenausbau", "niedrig", "offen", 30);
  task("Abnahme Sanitärinstallation", bad, "Rohinstallation", "hoch", "offen", 6);
  task("Fotos Leitungsverlauf vor dem Verputzen", elek, "Rohinstallation", "mittel", "offen", -1);

  const ev = (title: string, d: number, kind: string, trade_id: string | null) =>
    out.events.push({ id: id(), title, event_date: iso(d), start_time: null, end_date: null, end_time: null, kind, trade_id, notes: null });
  ev("Fliesenleger Start", 4, "arbeit", bad);
  ev("Netzbetreiber: Zählertausch", 7, "termin", elek);
  ev("Küchenstudio Beratung", 12, "termin", kueche);
  ev("Frist Angebot Parkett", 2, "frist", boden);
  ev("Maler Start Obergeschoss", 35, "arbeit", maler);

  const ex = (title: string, vendor: string, amount: number, d: number, category: string, trade_id: string | null, status: string) =>
    out.expenses.push({ id: id(), title, vendor, amount, expense_date: iso(d), category, trade_id, cost_item_id: null, document_id: null, status, notes: null });
  ex("Schutzfolie, Abdeckband, Kreppband", "Hornbach", 64.9, -35, "Baumarkt", maler, "bezahlt");
  ex("Container 7 m³ Bauschutt", "Entsorgung Südbaden", 420, -38, "Entsorgung", bad, "eingereicht");
  ex("Akku-Bohrhammer", "Bauhaus", 189, -30, "Werkzeug", null, "erstattet");
  ex("Silikon, Fugenmasse", "OBI", 37.45, -6, "Material", bad, "offen");

  return out;
}
