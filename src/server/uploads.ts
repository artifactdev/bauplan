// Keeps uploaded files in their readable folders. Server-only; node modules are passed in
// because this code is bundled through repo.ts, which loads them dynamically.
import {
  collectionFolder,
  documentFolder,
  isSafeStoragePath,
  relocatedPath,
} from "@/lib/storage-paths";
import type { SqliteDb } from "./repo";

type Fs = typeof import("node:fs");
type Path = typeof import("node:path");
export type UploadsEnv = { fs: Fs; path: Path; root: string };

/** Absolute path of a stored file, or null when the relative path is unsafe. */
export function resolveUpload(env: UploadsEnv, relative: string): string | null {
  if (!isSafeStoragePath(relative)) return null;
  const full = env.path.resolve(env.root, ...relative.split("/"));
  const root = env.path.resolve(env.root);
  return full.startsWith(root + env.path.sep) ? full : null;
}

type Scope = { documents?: string[]; ideaImages?: string[]; ideas?: string[] };

function placeholders(ids: string[]) {
  return ids.map(() => "?").join(",");
}

/**
 * Moves files whose folder no longer matches their category or collection and updates
 * storage_path. Idempotent; without a scope it checks every file. Paperless-tracked documents
 * are skipped by the database guard and keep their current path.
 */
export function organizeUploads(db: SqliteDb, env: UploadsEnv, scope?: Scope) {
  const rows: {
    table: "documents" | "idea_images";
    id: string;
    current: string;
    target: string;
  }[] = [];
  const documentFilter = scope
    ? scope.documents?.length
      ? `WHERE id IN (${placeholders(scope.documents)})`
      : null
    : "";
  if (documentFilter !== null)
    for (const row of db
      .prepare(`SELECT id, category, storage_path FROM documents ${documentFilter}`)
      .all(...(scope?.documents ?? []))) {
      if (typeof row["storage_path"] !== "string") continue;
      rows.push({
        table: "documents",
        id: String(row["id"]),
        current: row["storage_path"],
        target: relocatedPath(row["storage_path"], documentFolder(row["category"] as string)),
      });
    }
  const imageConditions: string[] = [];
  const imageParams: string[] = [];
  if (scope?.ideaImages?.length) {
    imageConditions.push(`i.id IN (${placeholders(scope.ideaImages)})`);
    imageParams.push(...scope.ideaImages);
  }
  if (scope?.ideas?.length) {
    imageConditions.push(`i.idea_id IN (${placeholders(scope.ideas)})`);
    imageParams.push(...scope.ideas);
  }
  if (!scope || imageConditions.length)
    for (const row of db
      .prepare(
        `SELECT i.id, i.storage_path, ideas.collection FROM idea_images i JOIN ideas ON ideas.id = i.idea_id ${
          imageConditions.length ? `WHERE ${imageConditions.join(" OR ")}` : ""
        }`,
      )
      .all(...imageParams)) {
      if (typeof row["storage_path"] !== "string") continue;
      rows.push({
        table: "idea_images",
        id: String(row["id"]),
        current: row["storage_path"],
        target: relocatedPath(row["storage_path"], collectionFolder(row["collection"] as string)),
      });
    }

  for (const row of rows) {
    if (row.current === row.target) continue;
    const from = resolveUpload(env, row.current);
    const to = resolveUpload(env, row.target);
    if (!from || !to) continue;
    const fromExists = env.fs.existsSync(from);
    if (!fromExists && !env.fs.existsSync(to)) {
      console.warn(`[uploads] Missing file for ${row.table} ${row.id}`);
      continue;
    }
    if (fromExists && env.fs.existsSync(to)) {
      console.warn(`[uploads] Target already exists for ${row.table} ${row.id}`);
      continue;
    }
    try {
      db.prepare(`UPDATE ${row.table} SET storage_path = ? WHERE id = ? AND storage_path = ?`).run(
        row.target,
        row.id,
        row.current,
      );
    } catch {
      continue;
    }
    if (!fromExists) continue;
    try {
      env.fs.mkdirSync(env.path.dirname(to), { recursive: true });
      env.fs.renameSync(from, to);
    } catch (error) {
      db.prepare(`UPDATE ${row.table} SET storage_path = ? WHERE id = ?`).run(row.current, row.id);
      console.warn(`[uploads] Could not move ${row.table} ${row.id}`, error);
      continue;
    }
    removeEmptyParent(env, from);
  }
}

export function removeEmptyParent(env: UploadsEnv, file: string) {
  const parent = env.path.dirname(file);
  if (env.path.resolve(parent) === env.path.resolve(env.root)) return;
  try {
    if (env.fs.readdirSync(parent).length === 0) env.fs.rmdirSync(parent);
  } catch {
    // Folder removal is best effort.
  }
}

/**
 * Turns image documents that belong only to one idea into idea_images rows so they leave
 * the document list. Documents used elsewhere or tracked by Paperless stay documents.
 */
export function convertIdeaDocuments(db: SqliteDb) {
  const columns = new Set(
    db
      .prepare("PRAGMA table_info(documents)")
      .all()
      .map((row) => String(row["name"])),
  );
  const linkedByColumn = columns.has("idea_id")
    ? "SELECT d.id AS document_id, d.idea_id FROM documents d JOIN ideas ON ideas.id = d.idea_id UNION "
    : "";
  const candidates = db
    .prepare(
      `SELECT link.document_id, MIN(link.idea_id) AS idea_id, COUNT(DISTINCT link.idea_id) AS idea_count
       FROM (${linkedByColumn}SELECT document_id, id AS idea_id FROM ideas WHERE document_id IS NOT NULL) link
       GROUP BY link.document_id`,
    )
    .all();
  for (const candidate of candidates) {
    const documentId = String(candidate["document_id"]);
    if (Number(candidate["idea_count"]) !== 1) continue;
    const doc = db.prepare("SELECT * FROM documents WHERE id = ?").get(documentId);
    if (!doc || !String(doc["mime_type"] ?? "").startsWith("image/")) continue;
    const usedElsewhere = db
      .prepare(
        `SELECT 1 FROM offers WHERE document_id = ?1
         UNION ALL SELECT 1 FROM invoices WHERE document_id = ?1
         UNION ALL SELECT 1 FROM tasks WHERE document_id = ?1
         UNION ALL SELECT 1 FROM expenses WHERE document_id = ?1
         UNION ALL SELECT 1 FROM app_paperless_links WHERE document_id = ?1
         UNION ALL SELECT 1 FROM app_paperless_jobs WHERE document_id = ?1
         LIMIT 1`,
      )
      .get(documentId);
    if (usedElsewhere) continue;
    db.prepare(
      "INSERT INTO idea_images (id, created_at, idea_id, name, storage_path, mime_type, size) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(
      documentId,
      doc["created_at"] ?? new Date().toISOString(),
      String(candidate["idea_id"]),
      doc["name"] ?? null,
      doc["storage_path"] ?? null,
      doc["mime_type"] ?? null,
      doc["size"] ?? null,
    );
    db.prepare("UPDATE ideas SET document_id = NULL WHERE document_id = ?").run(documentId);
    db.prepare("DELETE FROM documents WHERE id = ?").run(documentId);
  }
}
