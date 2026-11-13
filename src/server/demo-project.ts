import { cleanRow, TABLE_NAMES, type TableName } from "@/lib/schema";
import { buildDemoSeed } from "@/lib/seed";
import { documentFolder } from "@/lib/storage-paths";
import type { Repo } from "./repo";

type DemoRow = Record<string, unknown> & { id: string };

const INSERT_ORDER: TableName[] = [
  "trades",
  "cost_items",
  "contacts",
  "documents",
  "budget_pots",
  "offers",
  "expenses",
  "tasks",
  "events",
  "ideas",
  "idea_images",
  "funding_entries",
  "credit_terms",
  "credit_repayments",
];

export async function createDemoProjectData(repo: Repo, actorId: string) {
  const existing = (await repo.getProjects()).find(
    (project) => project.name.trim().toLocaleLowerCase() === "demo",
  );
  if (existing) return { projectId: existing.id, created: false };

  const seed = buildDemoSeed();
  const project = seed.projects[0]!;
  const demoFiles: { name: string; category: string; text: string[]; trade_id: string }[] = [
    {
      name: "Musterangebot Sanitär.pdf",
      category: "Angebot",
      trade_id: String(seed.trades[0]!["id"]),
      text: [
        "Musterbetrieb Haustechnik",
        "Beispielangebot für Sanitärarbeiten",
        "Fiktiver Beispieldatensatz ohne Vertragswirkung.",
        "Leistungsumfang: Leitungen, Armaturen und bodengleiche Dusche.",
        "Gesamtbetrag: 10.200,00 EUR",
      ],
    },
    {
      name: "Beispielplan Elektro.pdf",
      category: "Plan",
      trade_id: String(seed.trades[1]!["id"]),
      text: [
        "Demo-Projekt: Elektroarbeiten",
        "Beispielhafter Planungsstand",
        "Fiktiver Beispieldatensatz ohne Ausführungsfreigabe.",
        "Bereiche: Erdgeschoss, Obergeschoss und Küche.",
        "Alle Angaben sind nur zur Demonstration gedacht.",
      ],
    },
  ];
  const storedFiles: string[] = [];
  const inserted: { table: TableName; id: string }[] = [];

  try {
    for (const [index, file] of demoFiles.entries()) {
      const bytes = await createDemoPdf(file.name, file.text);
      const path = await repo.putFile(
        file.name,
        "application/pdf",
        bytes,
        documentFolder(file.category),
      );
      storedFiles.push(path);
      const document: DemoRow = {
        id: crypto.randomUUID(),
        name: file.name,
        category: file.category,
        tags: "Demo",
        description: "Fiktives Beispieldokument",
        storage_path: path,
        mime_type: "application/pdf",
        size: bytes.length,
        trade_id: file.trade_id,
        task_id: null,
        cost_item_id: null,
      };
      seed.documents.push(document);
      if (index === 0) seed.offers[0]!["document_id"] = document.id;
      else seed.tasks[0]!["document_id"] = document.id;
    }

    const projectRow = {
      ...cleanRow("projects", project),
      id: project.id,
    };
    await repo.insert("projects", projectRow, actorId);
    inserted.push({ table: "projects", id: project.id });

    for (const table of INSERT_ORDER) {
      for (const row of seed[table]) {
        const insertedRow = await repo.insert(
          table,
          {
            ...cleanRow(table, { ...row, project_id: project.id }),
            id: row.id,
            project_id: project.id,
          },
          actorId,
          project.id,
        );
        inserted.push({ table, id: String(insertedRow["id"]) });
      }
    }

    return { projectId: project.id, created: true };
  } catch (error) {
    const cleanupErrors: unknown[] = [];
    for (const row of inserted.reverse()) {
      try {
        await repo.remove(row.table, row.id, row.table === "projects" ? undefined : project.id);
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
    }
    for (const path of storedFiles) {
      try {
        await repo.deleteFile(path);
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
    }
    if (cleanupErrors.length)
      throw new Error("Demo-Projekt konnte nicht vollständig zurückgerollt werden.", {
        cause: new AggregateError([error, ...cleanupErrors]),
      });
    throw error;
  }
}

async function createDemoPdf(title: string, lines: string[]) {
  const { PDFDocument, StandardFonts } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  pdf.setTitle(title);
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText(title, { x: 48, y: 780, size: 18, font });
  lines.forEach((line, index) =>
    page.drawText(line, { x: 48, y: 735 - index * 28, size: 11, font }),
  );
  return new Uint8Array(await pdf.save());
}
