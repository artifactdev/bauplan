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
  const out = Object.fromEntries(TABLE_NAMES.map((t) => [t, [] as Row[]])) as Record<
    TableName,
    Row[]
  >;

  out.projects.push({
    id: id(),
    name: "Sanierung Doppelhaushälfte",
    address: "Lindenweg 12, 79098 Freiburg",
    total_budget: 85000,
    start_date: iso(-60),
    end_date: iso(120),
  });

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

  const ci = (
    trade_id: string,
    title: string,
    planned: number,
    description: string | null = null,
  ) => {
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

  const off = (
    trade_id: string,
    cost_item_id: string | null,
    contractor: string,
    title: string,
    amount: number,
    status: string,
    offer_date: number,
  ) =>
    out.offers.push({
      id: id(),
      trade_id,
      cost_item_id,
      document_id: null,
      contact_id: null,
      requested_date: null,
      contractor,
      title,
      amount,
      status,
      offer_date: iso(offer_date),
      notes: null,
    });
  off(
    bad,
    badInst,
    "Haustechnik Kern GmbH",
    "Sanitärinstallation komplett",
    10200,
    "accepted",
    -45,
  );
  off(bad, badInst, "Wasser & Wärme Albrecht", "Sanitärinstallation", 11650, "rejected", -44);
  off(bad, badFliesen, "Fliesen Bauer", "Wand- und Bodenfliesen Bad", 6400, "accepted", -30);
  off(bad, badFliesen, "Keramik Studio Ott", "Fliesenarbeiten Bad", 7300, "received", -28);
  off(elek, elekLeit, "Elektro Schneider", "Elektroinstallation EG/OG", 9100, "accepted", -50);
  off(elek, elekVert, "Elektro Schneider", "Zählerschrank inkl. Anmeldung", 4100, "accepted", -50);
  off(boden, parkett, "Parkett Meisterbetrieb Huber", "Eiche geölt, 68 m²", 8700, "received", -10);
  off(boden, parkett, "Bodenwelt Freiburg", "Eiche Landhausdiele, 68 m²", 9450, "received", -8);

  const inv = (
    trade_id: string,
    cost_item_id: string,
    contractor: string,
    title: string,
    amount: number,
    paid: boolean,
    d: number,
  ) =>
    out.expenses.push({
      id: id(),
      trade_id,
      cost_item_id,
      document_id: null,
      contact_id: null,
      offer_id: null,
      vendor: contractor,
      title,
      amount,
      status: paid ? "bezahlt" : "offen",
      expense_date: iso(d),
      due_date: iso(d + 14),
      category: "Handwerker",
      notes: null,
    });
  inv(bad, badRueck, "Abbruch Wiesner", "Rückbau Bad, Entsorgung", 2850, true, -40);
  inv(bad, badInst, "Haustechnik Kern GmbH", "Abschlag 1 Sanitär", 5000, true, -20);
  inv(elek, elekVert, "Elektro Schneider", "Zählerschrank", 4100, false, -5);

  const task = (
    title: string,
    trade_id: string | null,
    phase: string,
    priority: string,
    status: string,
    due: number | null,
    notes: string | null = null,
  ) =>
    out.tasks.push({
      id: id(),
      title,
      trade_id,
      phase,
      priority,
      status,
      due_date: due === null ? null : iso(due),
      notes,
      cost_item_id: null,
      document_id: null,
    });
  task("Fliesen für Bad auswählen", bad, "Planung", "hoch", "erledigt", -25);
  task("Termin Wasser abstellen mit Installateur", bad, "Rohinstallation", "hoch", "erledigt", -18);
  task(
    "Parkettangebote vergleichen und beauftragen",
    boden,
    "Planung",
    "hoch",
    "offen",
    -2,
    "Huber vs. Bodenwelt",
  );
  task("Steckdosenplan Küche finalisieren", elek, "Planung", "mittel", "in_arbeit", 3);
  task("Küchenplanung mit Studio abstimmen", kueche, "Planung", "mittel", "offen", 10);
  task("Rechnung Zählerschrank bezahlen", elek, "Rohinstallation", "hoch", "offen", 9);
  task("Farbtöne für Wohnzimmer festlegen", maler, "Innenausbau", "niedrig", "offen", 30);
  task("Abnahme Sanitärinstallation", bad, "Rohinstallation", "hoch", "offen", 6);
  task("Fotos Leitungsverlauf vor dem Verputzen", elek, "Rohinstallation", "mittel", "offen", -1);

  const ev = (title: string, d: number, kind: string, trade_id: string | null) =>
    out.events.push({
      id: id(),
      title,
      event_date: iso(d),
      start_time: null,
      end_date: null,
      end_time: null,
      kind,
      trade_id,
      notes: null,
    });
  ev("Fliesenleger Start", 4, "arbeit", bad);
  ev("Netzbetreiber: Zählertausch", 7, "termin", elek);
  ev("Küchenstudio Beratung", 12, "termin", kueche);
  ev("Frist Angebot Parkett", 2, "frist", boden);
  ev("Maler Start Obergeschoss", 35, "arbeit", maler);

  const ex = (
    title: string,
    vendor: string,
    amount: number,
    d: number,
    category: string,
    trade_id: string | null,
    status: string,
  ) =>
    out.expenses.push({
      id: id(),
      title,
      vendor,
      amount,
      expense_date: iso(d),
      category,
      trade_id,
      cost_item_id: null,
      document_id: null,
      status,
      notes: null,
    });
  ex("Schutzfolie, Abdeckband, Kreppband", "Hornbach", 64.9, -35, "Baumarkt", maler, "bezahlt");
  ex("Container 7 m³ Bauschutt", "Entsorgung Südbaden", 420, -38, "Entsorgung", bad, "eingereicht");
  ex("Akku-Bohrhammer", "Bauhaus", 189, -30, "Werkzeug", null, "erstattet");
  ex("Silikon, Fugenmasse", "OBI", 37.45, -6, "Material", bad, "offen");

  return out;
}

/** Generic, fully populated workspace used only for the explicit Demo project action. */
export function buildDemoSeed(): Record<TableName, Row[]> {
  const seed = buildSeed();
  const id = () => crypto.randomUUID();
  const companies = [
    "Musterbetrieb Haustechnik",
    "Beispiel-Fliesenbau",
    "Demo Elektrotechnik",
    "Musterbetrieb Boden",
  ];

  Object.assign(seed.projects[0]!, {
    name: "Demo",
    address: null,
    link_previews_enabled: false,
  });
  seed.offers.forEach((offer, index) => {
    offer["contractor"] = companies[index % companies.length]!;
  });
  seed.expenses.forEach((expense, index) => {
    expense["vendor"] = ["Muster-Baumarkt", "Beispiel-Entsorgung", "Demo-Fachhandel"][index % 3]!;
  });
  const parkettTask = seed.tasks.find(
    (task) => task["title"] === "Parkettangebote vergleichen und beauftragen",
  );
  if (parkettTask) parkettTask["notes"] = "Beispielbetrieb A vs. Beispielbetrieb B";

  const contacts = companies.map((company, index) => ({
    id: id(),
    name: `Kontakt ${index + 1}`,
    company,
    trade_id: [null, seed.trades[0]?.["id"], seed.trades[1]?.["id"], seed.trades[2]?.["id"]][index],
    phone: "0123 456789",
    email: `kontakt${index + 1}@example.com`,
    address: "Musterstraße 1, 12345 Musterstadt",
    website: "https://example.com",
    notes: "Fiktiver Beispieldatensatz",
  }));
  seed.contacts.push(...contacts);
  seed.offers.forEach((offer, index) => {
    offer["contact_id"] = contacts[index % contacts.length]!.id;
  });

  seed.expenses.push({
    id: id(),
    title: "Abschlagsrechnung Sanitär",
    vendor: companies[0]!,
    contact_id: contacts[0]!.id,
    offer_id: null,
    amount: 3200,
    expense_date: iso(-12),
    due_date: iso(2),
    payment_date: null,
    category: "Handwerker",
    trade_id: seed.trades[0]?.["id"] ?? null,
    cost_item_id: seed.cost_items[1]?.["id"] ?? null,
    document_id: null,
    status: "offen",
    notes: "Fiktiver Beispieldatensatz",
    budget_pot_id: null,
  });

  seed.ideas.push(
    {
      id: id(),
      collection: "Bad",
      title: "Helle Fliesen und bodengleiche Dusche",
      url: "https://example.com/bad",
      document_id: null,
      notes: "Neutrale Gestaltung mit pflegeleichten Oberflächen.",
      tags: "Bad, Fliesen, Dusche",
      trade_id: seed.trades[0]?.["id"] ?? null,
      room: "Badezimmer",
      price: 6400,
      favorite: true,
    },
    {
      id: id(),
      collection: "Wohnbereich",
      title: "Eichenparkett im Wohnbereich",
      url: "https://example.com/parkett",
      document_id: null,
      notes: "Musteridee für einen warmen, strapazierfähigen Boden.",
      tags: "Boden, Holz",
      trade_id: seed.trades[2]?.["id"] ?? null,
      room: "Wohnzimmer",
      price: 8700,
      favorite: false,
    },
    {
      id: id(),
      collection: "Küche",
      title: "Küchenfront in gedecktem Grün",
      url: "https://example.com/kueche",
      document_id: null,
      notes: "Beispiel für eine ruhige, zeitlose Farbwahl.",
      tags: "Küche, Farbe",
      trade_id: seed.trades[3]?.["id"] ?? null,
      room: "Küche",
      price: 15000,
      favorite: false,
    },
  );

  const ownFunds = id();
  const loan = id();
  const grant = id();
  seed.budget_pots.push(
    { id: ownFunds, name: "Eigenmittel", deducts_from_budget: true, notes: "Beispiel" },
    { id: loan, name: "Bankdarlehen", deducts_from_budget: true, notes: "Beispiel" },
    { id: grant, name: "Fördermittel", deducts_from_budget: true, notes: "Beispiel" },
  );
  seed.funding_entries.push(
    {
      id: id(),
      budget_pot_id: ownFunds,
      amount: 25000,
      received_date: iso(-45),
      notes: "Fiktiver Beispieldatensatz",
    },
    {
      id: id(),
      budget_pot_id: grant,
      amount: 5000,
      received_date: iso(-10),
      notes: "Fiktiver Beispieldatensatz",
    },
  );
  seed.credit_terms.push({
    id: id(),
    budget_pot_id: loan,
    total_credit: 30000,
    annual_rate: 3.5,
    interest_free_start: null,
    interest_free_end: null,
    repayment_start: iso(30),
    commitment_rate: 0,
    commitment_free_end: null,
    repayment_months: 120,
    day_basis: 30,
    effective_rate: 3.5,
    fixed_rate_end: iso(3650),
    payout_rate: 100,
    net_credit: 30000,
    repayment_rate: 2,
    monthly_installment: 297,
    repayment_count: 120,
    first_installment_date: iso(30),
    commitment_start: iso(-30),
    assumed_full_draw_date: iso(0),
  });
  seed.credit_repayments.push({
    id: id(),
    amount: 300,
    repayment_date: iso(-5),
    notes: "Fiktiver Beispieldatensatz",
  });

  return seed;
}
