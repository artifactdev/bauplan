#!/usr/bin/env node
// Creates (or refreshes) the local demo instance used for the website screenshots.
//
//   npm run demo:seed
//
// Everything is written to DATA_DIR / UPLOADS_DIR (default: .demo/data and .demo/uploads).
// The data is fictional and based on src/lib/seed.ts. Running the script twice is safe.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { createServer } from "vite";
import { addTimelineDemo } from "./timeline-demo.mjs";

const root = process.cwd();
process.env.DATA_DIR ??= path.join(root, ".demo", "data");
process.env.UPLOADS_DIR ??= path.join(root, ".demo", "uploads");
mkdirSync(process.env.DATA_DIR, { recursive: true });
mkdirSync(process.env.UPLOADS_DIR, { recursive: true });

const DEMO_EMAIL = process.env.DEMO_EMAIL ?? "demo@bauplan.example";
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "bauplan-demo-2026";
const DEMO_PROJECT = "Sanierung Doppelhaushälfte";
const DEMO_ADDRESS = "Lindenweg 12, 79098 Freiburg";

function iso(offsetDays) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

// The server modules use Vite-only features (import.meta.glob, path aliases), so they are
// loaded through a Vite SSR server instead of plain Node.
const vite = await createServer({
  configFile: false,
  root,
  logLevel: "error",
  appType: "custom",
  server: { middlewareMode: true },
  resolve: { alias: { "@": path.join(root, "src") } },
});
const load = (id) => vite.ssrLoadModule(id);

const { sqliteRepo } = await load("/src/server/repo.ts");
const { countUsers, createUser, listUsers } = await load("/src/server/local-auth.ts");
const { createDemoProjectData } = await load("/src/server/demo-project.ts");
const { documentFolder, collectionFolder } = await load("/src/lib/storage-paths.ts");

const repo = sqliteRepo();

async function ensureUser() {
  if ((await countUsers()) > 0) {
    const exists = (await listUsers()).find((user) => user.email === DEMO_EMAIL);
    if (exists) return exists.id;
  }
  return createUser({ email: DEMO_EMAIL, name: "Demo", password: DEMO_PASSWORD, role: "admin" });
}

/** Minimal multi-line PDF used for the demo document library. */
async function createPdf(title, lines) {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  pdf.setTitle(title);
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  page.drawText("Bauplan · Beispieldokument", {
    x: 48,
    y: 795,
    size: 9,
    font,
    color: rgb(0.35, 0.38, 0.46),
  });
  page.drawText(title, { x: 48, y: 755, size: 19, font: bold, color: rgb(0.08, 0.39, 0.46) });
  page.drawLine({
    start: { x: 48, y: 738 },
    end: { x: 547, y: 738 },
    thickness: 1,
    color: rgb(0.89, 0.9, 0.93),
  });
  lines.forEach((line, index) =>
    page.drawText(line, {
      x: 48,
      y: 705 - index * 26,
      size: 11,
      font,
      color: rgb(0.13, 0.14, 0.19),
    }),
  );
  page.drawText("Fiktiver Beispieldatensatz ohne Vertragswirkung.", {
    x: 48,
    y: 60,
    size: 9,
    font,
    color: rgb(0.45, 0.48, 0.55),
  });
  return new Uint8Array(await pdf.save());
}

async function addDocument(projectId, { name, category, tradeId, text, offerId, taskId }) {
  const bytes = await createPdf(name.replace(/\.pdf$/, ""), text);
  const storage_path = await repo.putFile(name, "application/pdf", bytes, documentFolder(category));
  const row = await repo.insert(
    "documents",
    {
      name,
      category,
      tags: "Demo",
      description: "Fiktives Beispieldokument",
      storage_path,
      mime_type: "application/pdf",
      size: bytes.byteLength,
      trade_id: tradeId ?? null,
      task_id: taskId ?? null,
      cost_item_id: null,
    },
    undefined,
    projectId,
  );
  if (offerId) {
    await repo.update("offers", offerId, { document_id: row["id"] }, undefined, projectId);
  }
  if (taskId) {
    await repo.update("tasks", taskId, { document_id: row["id"] }, undefined, projectId);
  }
  return row["id"];
}

/** Material samples for the collections page; simple vector drawings, no external assets. */
function materialImage(kind) {
  const width = 1200;
  const height = 800;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (kind === "tiles") {
    ctx.fillStyle = "#e7e5e0";
    ctx.fillRect(0, 0, width, height);
    for (let x = 0; x < width; x += 200) {
      for (let y = 0; y < height; y += 200) {
        ctx.fillStyle = (x / 200 + y / 200) % 2 ? "#dedcd6" : "#eceae5";
        ctx.fillRect(x + 3, y + 3, 194, 194);
      }
    }
    ctx.fillStyle = "rgba(14,99,117,0.12)";
    ctx.fillRect(0, height - 120, width, 120);
  } else if (kind === "wood") {
    ctx.fillStyle = "#b98a5a";
    ctx.fillRect(0, 0, width, height);
    for (let y = 0; y < height; y += 100) {
      ctx.fillStyle = ["#c4966a", "#ad7f50", "#bd8d5e", "#b28455"][(y / 100) % 4];
      ctx.fillRect(0, y + 2, width, 96);
      ctx.strokeStyle = "rgba(88,58,32,0.22)";
      ctx.lineWidth = 1;
      for (let i = 0; i < 9; i += 1) {
        ctx.beginPath();
        const offset = y + 12 + i * 9;
        ctx.moveTo(0, offset);
        ctx.bezierCurveTo(width * 0.3, offset + 5, width * 0.7, offset - 6, width, offset + 2);
        ctx.stroke();
      }
    }
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fillRect(0, 0, width, 70);
  } else {
    ctx.fillStyle = "#51665a";
    ctx.fillRect(0, 0, width, height);
    for (let x = 0; x < width; x += 150) {
      ctx.fillStyle = x % 300 === 0 ? "#4c6155" : "#566c5f";
      ctx.fillRect(x + 4, 0, 142, height);
    }
    ctx.fillStyle = "rgba(240,238,230,0.1)";
    ctx.fillRect(0, 0, width, 90);
  }
  return canvas.toBuffer("image/png");
}

async function addIdeaImage(projectId, idea, file) {
  const bytes = materialImage(file.kind);
  const storage_path = await repo.putFile(
    file.name,
    "image/png",
    bytes,
    collectionFolder(idea.collection),
  );
  await repo.insert(
    "idea_images",
    {
      project_id: projectId,
      idea_id: idea.id,
      name: file.name,
      storage_path,
      mime_type: "image/png",
      size: bytes.byteLength,
      source: "upload",
    },
    undefined,
    projectId,
  );
}

const { createCanvas } = await import("@napi-rs/canvas");

const actorId = await ensureUser();
const projectsBefore = await repo.getProjects();
const existingProject =
  projectsBefore.find((entry) => entry.name === DEMO_PROJECT) ??
  projectsBefore.find((entry) => entry.name.trim().toLowerCase() === "demo");
let projectId;
let created = false;
if (existingProject) {
  projectId = existingProject.id;
} else {
  ({ projectId, created } = await createDemoProjectData(repo, actorId));
}

await repo.update("projects", projectId, {
  name: DEMO_PROJECT,
  address: DEMO_ADDRESS,
  link_previews_enabled: false,
});

const ws = await repo.getAll(projectId);
const tradeId = (index) => ws.trades[index]?.id ?? null;
const byTitle = (rows, title) => rows.find((row) => row.title === title);
const documentNames = new Set(ws.documents.map((document) => document.name));

const extraDocuments = [
  {
    name: "Rechnung Abschlag Sanitär.pdf",
    category: "Rechnung",
    tradeId: tradeId(0),
    text: [
      "Musterbetrieb Haustechnik",
      "Abschlagsrechnung 1 – Sanitärinstallation",
      "Leistungsstand: Rohinstallation abgeschlossen.",
      "Rechnungsbetrag: 5.000,00 EUR",
      "Zahlungsziel: 14 Tage netto",
    ],
    offerId: byTitle(ws.offers, "Sanitärinstallation komplett")?.id,
  },
  {
    name: "Angebot Parkett Eiche.pdf",
    category: "Angebot",
    tradeId: tradeId(2),
    text: [
      "Musterbetrieb Boden",
      "Angebot Eichenparkett, 68 m²",
      "Sortierung: Natur, geölt, Landhausdiele",
      "Gesamtbetrag: 8.700,00 EUR",
      "Gültig bis: 30 Tage nach Angebotsdatum",
    ],
    offerId: byTitle(ws.offers, "Eiche geölt, 68 m²")?.id,
  },
  {
    name: "Bautagebuch Rohinstallation.pdf",
    category: "Sonstiges",
    tradeId: tradeId(1),
    text: [
      "Bautagebuch – Rohinstallation",
      "Leitungen EG und OG verlegt und dokumentiert.",
      "Fotos der Leitungsverläufe vor dem Verputzen abgelegt.",
      "Abnahme durch die Bauleitung steht aus.",
    ],
    taskId: byTitle(ws.tasks, "Fotos Leitungsverlauf vor dem Verputzen")?.id,
  },
];

const documentIds = new Map(ws.documents.map((document) => [document.name, document.id]));
for (const document of extraDocuments) {
  if (documentNames.has(document.name)) continue;
  documentIds.set(document.name, await addDocument(projectId, document));
}

// A linked receipt and a payment date in the past make the expenses page tell a story.
const invoiceDocument = documentIds.get("Rechnung Abschlag Sanitär.pdf");
const advanceExpense = ws.expenses.find((expense) => expense.title === "Abschlagsrechnung Sanitär");
if (advanceExpense) {
  const patch = {};
  if (invoiceDocument && advanceExpense.document_id !== invoiceDocument) {
    patch.document_id = invoiceDocument;
  }
  if (advanceExpense.due_date !== iso(-2)) patch.due_date = iso(-2);
  if (Object.keys(patch).length) {
    await repo.update("expenses", advanceExpense.id, patch, undefined, projectId);
  }
}

const paymentSources = ws.budget_pots.map((pot) => pot.id);
if (paymentSources.length) {
  for (const [index, expense] of ws.expenses.entries()) {
    if (expense.budget_pot_id) continue;
    await repo.update(
      "expenses",
      expense.id,
      { budget_pot_id: paymentSources[index % paymentSources.length] },
      undefined,
      projectId,
    );
  }
}

const ideaFiles = [
  { kind: "tiles", name: "fliesen-mood.png", title: "Helle Fliesen und bodengleiche Dusche" },
  { kind: "wood", name: "parkett-mood.png", title: "Eichenparkett im Wohnbereich" },
  { kind: "kitchen", name: "kuechenfront-mood.png", title: "Küchenfront in gedecktem Grün" },
];
for (const file of ideaFiles) {
  const idea = ws.ideas.find((entry) => entry.title === file.title);
  if (!idea) continue;
  if (ws.idea_images.some((image) => image.idea_id === idea.id)) continue;
  await addIdeaImage(projectId, idea, file);
}

// The startup migration adds empty default cost items; they only add noise to the demo project.
for (const title of ["Anschaffung", "Rückbau"]) {
  const item = ws.cost_items.find((entry) => entry.title === title && Number(entry.planned) === 0);
  if (!item || item.trade_id) continue;
  const used =
    ws.offers.some((offer) => offer.cost_item_id === item.id) ||
    ws.expenses.some((expense) => expense.cost_item_id === item.id);
  if (!used) await repo.remove("cost_items", item.id, projectId);
}

const parkettTask = ws.tasks.find(
  (task) => task.title === "Parkettangebote vergleichen und beauftragen",
);
if (parkettTask && !parkettTask.checklist) {
  await repo.update(
    "tasks",
    parkettTask.id,
    {
      checklist: JSON.stringify([
        { id: crypto.randomUUID(), title: "Angebote Huber und Bodenwelt vergleichen", done: true },
        { id: crypto.randomUUID(), title: "Musterdiele anfordern", done: true },
        { id: crypto.randomUUID(), title: "Aufmaßtermin vereinbaren", done: false },
      ]),
    },
    undefined,
    projectId,
  );
}

const installationTask = ws.tasks.find((task) => task.title === "Abnahme Sanitärinstallation");
if (installationTask && !installationTask.checklist) {
  await repo.update(
    "tasks",
    installationTask.id,
    {
      checklist: JSON.stringify([
        { id: crypto.randomUUID(), title: "Druckprüfung protokollieren", done: false },
        { id: crypto.randomUUID(), title: "Fotos der Anschlüsse ablegen", done: false },
      ]),
    },
    undefined,
    projectId,
  );
}

const demoEvents = [
  {
    title: "Fliesenarbeiten Bad",
    event_date: iso(4),
    end_date: iso(9),
    kind: "arbeit",
    trade_id: tradeId(0),
  },
  {
    title: "Parkett verlegen",
    event_date: iso(21),
    end_date: iso(25),
    kind: "arbeit",
    trade_id: tradeId(2),
  },
  {
    title: "Lieferung Fliesen",
    event_date: iso(4),
    start_time: "08:00",
    end_time: "09:00",
    kind: "termin",
    trade_id: tradeId(0),
  },
  {
    title: "Aufmaß Küche",
    event_date: iso(3),
    start_time: "10:00",
    end_time: "11:30",
    kind: "termin",
    trade_id: tradeId(3),
  },
  {
    title: "Bauleitergespräch",
    event_date: iso(6),
    start_time: "14:00",
    end_time: "15:00",
    kind: "termin",
    trade_id: null,
  },
];
for (const event of demoEvents) {
  if (ws.events.some((entry) => entry.title === event.title)) continue;
  await repo.insert(
    "events",
    {
      ...event,
      start_time: event.start_time ?? null,
      end_date: event.end_date ?? null,
      end_time: event.end_time ?? null,
      notes: null,
    },
    undefined,
    projectId,
  );
}

const planningWs = await repo.getAll(projectId);
async function planningTrade(name, color) {
  const existing = planningWs.trades.find((trade) => trade.name === name);
  if (existing) return existing.id;
  return (await repo.insert("trades", { name, color, budget: 0 }, undefined, projectId))["id"];
}
const electricalTrade = await planningTrade("Elektro", "#215caa");
const drywallTrade = await planningTrade("Trockenbau", "#7046b8");
const paintingTrade = await planningTrade("Maler", "#166747");
async function planningRow(table, values) {
  const existing = planningWs[table].find((row) => row.title === values.title);
  if (existing) {
    await repo.update(table, existing.id, values, undefined, projectId);
    return existing.id;
  }
  return (await repo.insert(table, values, undefined, projectId))["id"];
}
const electricalWork = await planningRow("events", {
  title: "Elektro: Leitungen verlegen",
  kind: "arbeit",
  trade_id: electricalTrade,
  event_date: iso(0),
  end_date: iso(3),
  start_time: null,
  end_time: null,
  work_completed: false,
  notes: "Vor dem Schließen der Wände gemeinsam prüfen.",
});
await planningRow("events", {
  title: "Elektro: Baustrom prüfen",
  kind: "arbeit",
  trade_id: electricalTrade,
  event_date: iso(-2),
  end_date: iso(-1),
  start_time: null,
  end_time: null,
  work_completed: true,
  notes: "Vorarbeit abgeschlossen.",
});
const closingTask = await planningRow("tasks", {
  title: "Wände schließen",
  trade_id: drywallTrade,
  phase: "Rohinstallation",
  priority: "hoch",
  status: "offen",
  start_date: iso(2),
  due_date: iso(6),
  dependencies: JSON.stringify([{ source: "event", id: electricalWork, lag_days: 0 }]),
  notes: "Absichtlich zu früh geplant: Elektroarbeiten erst fertigstellen.",
});
await planningRow("tasks", {
  title: "Wände streichen",
  trade_id: paintingTrade,
  phase: "Innenausbau",
  priority: "mittel",
  status: "offen",
  start_date: iso(10),
  due_date: iso(14),
  dependencies: JSON.stringify([{ source: "task", id: closingTask, lag_days: 3 }]),
  notes: "Drei Kalendertage geplante Trocknung nach dem Schließen der Wände.",
});

await addTimelineDemo(repo, projectId);

const projects = await repo.getProjects();
const project = projects.find((entry) => entry.id === projectId);
console.log(`Demo ${created ? "created" : "already present"}: ${project?.name ?? DEMO_PROJECT}`);
console.log(`  data:      ${process.env.DATA_DIR}`);
console.log(`  uploads:   ${process.env.UPLOADS_DIR}`);
console.log(`  sign-in:   ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);

await vite.close();
