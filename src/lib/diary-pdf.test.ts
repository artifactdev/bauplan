// @vitest-environment node
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it, vi } from "vitest";
import { createDiaryPdf } from "./diary-pdf";
import type { DiaryEntry, Project, Workspace } from "./schema";

vi.mock("./data.functions", () => ({ getFileUrl: vi.fn() }));
const directory = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
const fonts = {
  regular: readFileSync(join(directory, "standard_fonts/LiberationSans-Regular.ttf")),
  bold: readFileSync(join(directory, "standard_fonts/LiberationSans-Bold.ttf")),
};

function fixture() {
  const project: Project = {
    id: "p",
    name: "Sanierung Müller",
    address: "Lindenweg 12",
    total_budget: 0,
    start_date: null,
    end_date: null,
  };
  const workspace: Workspace = {
    projects: [project],
    tasks: [],
    trades: [],
    events: [],
    diary_media: [],
    diary_entries: [],
    contacts: [],
    cost_items: [],
    offers: [],
    invoices: [],
    documents: [],
    expenses: [],
    ideas: [],
    idea_images: [],
    budget_pots: [],
    funding_entries: [],
    credit_terms: [],
    credit_repayments: [],
  };
  const entry: DiaryEntry = {
    id: "one",
    title: "Älterer Bericht – Küche",
    entry_date: "2026-10-12",
    work_done: "Leitungen für Küche und Fußboden geprüft.",
    progress: null,
    issues: null,
    weather_snapshot: null,
    task_ids: null,
    event_ids: null,
    trade_ids: null,
  };
  return { project, workspace, entry };
}

async function extract(bytes: Uint8Array) {
  const loading = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
  const document = await loading.promise;
  const texts: string[] = [];
  try {
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      texts.push(
        (await page.getTextContent()).items
          .map((item) => ("str" in item ? item.str : ""))
          .join(" "),
      );
    }
    return texts;
  } finally {
    await loading.destroy();
  }
}

describe("diary PDF reports", () => {
  it("prints selected subtasks with their parent context even when the parent is not linked", async () => {
    const { project, workspace, entry } = fixture();
    workspace.tasks = [
      {
        id: "parent",
        title: "Open installation",
        status: "offen",
        priority: "mittel",
        assignee_id: null,
        trade_id: null,
        phase: null,
        due_date: null,
        notes: null,
        cost_item_id: null,
        document_id: null,
        checklist: JSON.stringify([
          { id: "selected", title: "Measured cable routes", done: true },
          { id: "other", title: "Unselected work", done: false },
        ]),
      },
    ];
    const { bytes } = await createDiaryPdf({
      project,
      workspace,
      entries: [
        {
          ...entry,
          subtask_links: JSON.stringify([{ task_id: "parent", subtask_id: "selected" }]),
        },
      ],
      language: "en",
      fonts,
      photo: vi.fn(),
    });
    const text = (await extract(bytes)).join(" ");
    expect(text).toContain("Subtasks");
    expect(text).toContain("Open installation: Measured cable routes");
    expect(text).not.toContain("Unselected work");
  });
  it("includes selected offers and payments with their business dates, suppliers and amounts", async () => {
    const { project, workspace, entry } = fixture();
    workspace.offers = [
      {
        id: "quote",
        title: "Electrical quote",
        contractor: "Keller Elektro",
        amount: 2430,
        offer_date: "2026-10-12",
        requested_date: null,
        trade_id: null,
        cost_item_id: null,
        document_id: null,
        contact_id: null,
        status: "received",
        notes: null,
      },
    ];
    workspace.expenses = [
      {
        id: "payment",
        title: "Paid materials",
        vendor: "Building supply workshop",
        amount: 340.5,
        expense_date: "2026-10-10",
        payment_date: "2026-10-12",
        category: null,
        trade_id: null,
        cost_item_id: null,
        document_id: null,
        status: "bezahlt",
        bank_status: "nicht_festgelegt",
        notes: null,
      },
    ];
    const { bytes } = await createDiaryPdf({
      project,
      workspace,
      entries: [{ ...entry, offer_ids: '["quote"]', payment_ids: '["payment"]' }],
      language: "en",
      fonts,
      photo: vi.fn(),
    });
    const text = (await extract(bytes)).join(" ");
    for (const value of [
      "Electrical quote",
      "Keller Elektro",
      "2,430.00",
      "Offer dated",
      "Paid materials",
      "Building supply workshop",
      "340.50",
      "Payment on",
    ])
      expect(text).toContain(value);
  });

  it("exports the selected entries chronologically with embedded photos, searchable Unicode and a video manifest", async () => {
    const { project, workspace, entry } = fixture();
    workspace.diary_media = [
      {
        id: "photo",
        diary_entry_id: entry.id,
        name: "Küche.jpg",
        storage_path: "photo",
        mime_type: "image/jpeg",
        size: 10,
      },
      {
        id: "video",
        diary_entry_id: entry.id,
        name: "Rundgang.webm",
        storage_path: "video",
        mime_type: "video/webm",
        size: 10,
      },
    ];
    const photo = vi.fn(async () => new Uint8Array(createCanvas(100, 60).toBuffer("image/jpeg")));
    const { bytes, omitted } = await createDiaryPdf({
      project,
      workspace,
      entries: [
        { ...entry, id: "two", title: "Späterer Bericht", entry_date: "2026-11-17" },
        entry,
      ],
      language: "de",
      fonts,
      photo,
    });
    const pages = await extract(bytes);
    expect(pages).toHaveLength(3);
    expect(pages[0]).toContain("Sanierung Müller");
    expect(pages[1]).toContain("Älterer Bericht");
    expect(pages[1]).toContain("Fußboden");
    expect(pages[1]).toContain("Rundgang.webm");
    expect(pages[2]).toContain("Späterer Bericht");
    expect(pages[2]).toContain("Seite 3 von 3");
    const pdf = await PDFDocument.load(bytes);
    expect(
      pdf.getPages()[1]!.node.Resources()?.lookup(PDFName.of("XObject"), PDFDict).keys(),
    ).toHaveLength(1);
    expect(photo).toHaveBeenCalledOnce();
    expect(omitted).toEqual([]);
    const filtered = await createDiaryPdf({
      project,
      workspace,
      entries: [entry],
      language: "en",
      fonts,
      photo,
    });
    expect((await extract(filtered.bytes)).join(" ")).not.toContain("Späterer Bericht");
  });

  it("keeps the media heading with the first photo when it needs a new page", async () => {
    const { project, workspace, entry } = fixture();
    workspace.diary_media = [
      {
        id: "photo",
        diary_entry_id: entry.id,
        name: "Site.jpg",
        storage_path: "photo",
        mime_type: "image/jpeg",
        size: 10,
      },
    ];
    const { bytes } = await createDiaryPdf({
      project,
      workspace,
      entries: [{ ...entry, work_done: "Documented cable routing. ".repeat(100) }],
      language: "en",
      fonts,
      photo: async () => new Uint8Array(createCanvas(400, 300).toBuffer("image/jpeg")),
    });
    const pages = await extract(bytes);
    const photoPage = pages.findIndex((text) => text.includes("Site.jpg"));
    expect(photoPage).toBeGreaterThan(1);
    expect(pages[photoPage]).toContain("Photos and videos");
    expect(pages[photoPage - 1]).not.toContain("Photos and videos");
  });

  it("paginates long text and explicitly marks unavailable photos without fetching videos", async () => {
    const { project, workspace, entry } = fixture();
    workspace.diary_media = [
      {
        id: "missing",
        diary_entry_id: entry.id,
        name: "Missing.heic",
        storage_path: null,
        mime_type: "image/heic",
        size: 4,
      },
    ];
    const result = await createDiaryPdf({
      project,
      workspace,
      entries: [{ ...entry, work_done: "Documented cable routing. ".repeat(600) }],
      language: "en",
      fonts,
      photo: async () => {
        throw new Error("Cannot decode");
      },
    });
    const pages = await extract(result.bytes);
    expect(pages.length).toBeGreaterThan(3);
    expect(pages.join(" ")).toContain("not embedded in this PDF");
    expect(result.omitted).toEqual(["Missing.heic"]);
    await expect(
      createDiaryPdf({ project, workspace, entries: [], language: "en", fonts, photo: vi.fn() }),
    ).rejects.toThrow("diary.pdf_empty");
  });
});
