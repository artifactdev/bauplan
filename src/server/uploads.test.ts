// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import type { Repo, SqliteDb } from "./repo";
import { convertIdeaDocuments, organizeUploads, resolveUpload, type UploadsEnv } from "./uploads";

const dir = fs.mkdtempSync(path.join(tmpdir(), "bauplan-uploads-"));
const previousDir = process.env["DATA_DIR"];
const env: UploadsEnv = { fs, path, root: path.join(dir, "uploads") };
let repo: Repo;
let db: SqliteDb;

beforeAll(async () => {
  process.env["DATA_DIR"] = dir;
  const module = await import("./repo");
  repo = module.sqliteRepo();
  db = await module.getSqliteDb();
});

afterAll(() => {
  if (previousDir === undefined) delete process.env["DATA_DIR"];
  else process.env["DATA_DIR"] = previousDir;
  fs.rmSync(dir, { recursive: true, force: true });
});

const exists = (relative: string) => fs.existsSync(path.join(env.root, ...relative.split("/")));

describe("upload folders", () => {
  it("resolves only paths inside the uploads root", () => {
    expect(resolveUpload(env, "documents/Plan/a.pdf")).toBe(
      path.resolve(env.root, "documents", "Plan", "a.pdf"),
    );
    expect(resolveUpload(env, "../renovierung.db")).toBeNull();
    expect(resolveUpload(env, "documents/../../x")).toBeNull();
  });

  it("migrates legacy flat files and turns idea-only images into idea images", () => {
    fs.writeFileSync(path.join(env.root, "legacy-plan.pdf"), "plan");
    fs.writeFileSync(path.join(env.root, "legacy-idea.jpg"), "idea");
    fs.writeFileSync(path.join(env.root, "legacy-shared.jpg"), "shared");
    const insertDoc = db.prepare(
      "INSERT INTO documents (id, created_at, name, category, storage_path, mime_type, size) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    insertDoc.run(
      "doc-plan",
      "2026-01-01",
      "Plan",
      "Plan",
      "legacy-plan.pdf",
      "application/pdf",
      4,
    );
    insertDoc.run("doc-idea", "2026-01-02", "Idee", "Foto", "legacy-idea.jpg", "image/jpeg", 4);
    insertDoc.run(
      "doc-shared",
      "2026-01-03",
      "Shared",
      "Foto",
      "legacy-shared.jpg",
      "image/jpeg",
      6,
    );
    const insertIdea = db.prepare(
      "INSERT INTO ideas (id, created_at, collection, title, document_id, favorite) VALUES (?, ?, ?, ?, ?, 0)",
    );
    insertIdea.run("idea-1", "2026-01-01", "Küche Ideen", "Fliesen", "doc-idea");
    insertIdea.run("idea-2", "2026-01-01", "Bad", "Armatur", "doc-shared");
    db.prepare(
      "INSERT INTO tasks (id, created_at, title, priority, status, document_id) VALUES ('task-1', '2026-01-01', 'T', 'mittel', 'offen', 'doc-shared')",
    ).run();

    convertIdeaDocuments(db);
    organizeUploads(db, env);
    organizeUploads(db, env);

    const docs = db.prepare("SELECT id, storage_path FROM documents ORDER BY id").all();
    expect(docs).toEqual([
      { id: "doc-plan", storage_path: "documents/Plan/legacy-plan.pdf" },
      { id: "doc-shared", storage_path: "documents/Foto/legacy-shared.jpg" },
    ]);
    expect(db.prepare("SELECT id, idea_id, storage_path FROM idea_images").all()).toEqual([
      {
        id: "doc-idea",
        idea_id: "idea-1",
        storage_path: "collections/Kueche-Ideen/legacy-idea.jpg",
      },
    ]);
    expect(db.prepare("SELECT document_id FROM ideas WHERE id = 'idea-1'").get()).toEqual({
      document_id: null,
    });
    expect(db.prepare("SELECT document_id FROM ideas WHERE id = 'idea-2'").get()).toEqual({
      document_id: "doc-shared",
    });
    expect(exists("legacy-plan.pdf")).toBe(false);
    expect(exists("documents/Plan/legacy-plan.pdf")).toBe(true);
    expect(exists("collections/Kueche-Ideen/legacy-idea.jpg")).toBe(true);
  });

  it("moves files when a document category or an idea collection changes", async () => {
    await repo.update("documents", "doc-plan", { category: "Vertrag", storage_path: "x.pdf" });
    const plan = (await repo.getAll()).documents.find((doc) => doc.id === "doc-plan");
    expect(plan?.storage_path).toBe("documents/Vertrag/legacy-plan.pdf");
    expect(await repo.readFile(plan!.storage_path!)).toEqual(new TextEncoder().encode("plan"));
    expect(exists("documents/Plan")).toBe(false);

    await repo.update("ideas", "idea-1", { collection: "Bad" });
    const image = (await repo.getAll()).idea_images.find((row) => row.id === "doc-idea");
    expect(image?.storage_path).toBe("collections/Bad/legacy-idea.jpg");
    expect(exists("collections/Bad/legacy-idea.jpg")).toBe(true);
    expect(exists("collections/Kueche-Ideen")).toBe(false);
  });

  it("stores new uploads in the requested folder", async () => {
    const stored = await repo.putFile(
      "Foto 1.jpg",
      "image/jpeg",
      new Uint8Array([1]),
      "collections/Bad",
    );
    expect(stored).toMatch(/^collections\/Bad\/[0-9a-f-]+-Foto_1\.jpg$/);
    expect(await repo.readFile(stored)).toEqual(new Uint8Array([1]));
    await repo.deleteFile(stored);
    expect(await repo.readFile(stored)).toBeNull();
    expect(await repo.readFile("../renovierung.db")).toBeNull();
  });
});
