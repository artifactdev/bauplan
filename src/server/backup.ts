import { createHash } from "node:crypto";
import { strFromU8, strToU8, unzipSync, zipSync, type Unzipped } from "fflate";
import { BOOL_COLS, NUMERIC_COLS, TABLE_NAMES, TABLES, type TableName } from "@/lib/schema";
import { appearanceSchema } from "@/lib/appearance";
import { parseNavigation } from "@/lib/navigation";
import { analysisViewsSchema } from "@/lib/analysis";
import { legacyInvoiceExpense } from "@/lib/expenses";
import { validateFundingEntry } from "@/lib/funding";
import { parseTaskChecklist } from "@/lib/tasks";
import { z } from "zod";
import { paperlessExportMetadataSchema } from "@/lib/paperless";
import { normalizePaperlessUrl } from "./paperless-client";
import { isSafeStoragePath } from "@/lib/storage-paths";
import { MAX_BACKUP_BYTES } from "@/lib/limits";
import type { BackupDatabase, BackupFile, Repo } from "./repo";

const MAX_EXPANDED_BYTES = MAX_BACKUP_BYTES;
const MAX_ARCHIVE_ENTRIES = 10_000;
const MAX_MANIFEST_BYTES = 32 * 1024 * 1024;
const FORMAT = "bauplan-backup";
const VERSION = 1;
// Tables added after the first backup format; older archives may omit them.
const OPTIONAL_TABLES = new Set<TableName>(["funding_entries", "idea_images"]);

type Manifest = {
  format: typeof FORMAT;
  version: 1 | 2;
  includesUploads?: false;
  createdAt: string;
  database: BackupDatabase;
  files: { name: string; size: number; sha256: string }[];
};

function fail(message: string): never {
  throw new Error(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isScalar(value: unknown): value is string | number | null {
  return value === null || typeof value === "string" || typeof value === "number";
}

function validateRows(
  rows: unknown,
  columns: readonly string[],
  required: readonly string[],
): Record<string, unknown>[] {
  if (!Array.isArray(rows)) fail("Backup-Datentabelle ist ungültig.");
  const allowed = new Set(columns);
  const ids = new Set<string>();
  return rows.map((row) => {
    if (!isRecord(row)) fail("Backup-Datensatz ist ungültig.");
    if (Object.keys(row).some((key) => !allowed.has(key)))
      fail("Backup-Datensatz enthält unbekannte Spalten.");
    if (required.some((key) => !(key in row))) fail("Backup-Datensatz ist unvollständig.");
    for (const value of Object.values(row))
      if (!isScalar(value) || (typeof value === "number" && !Number.isFinite(value)))
        fail("Backup-Datensatz enthält ungültige Werte.");
    const id = row["id"];
    if (typeof id !== "string" || !id || ids.has(id))
      fail("Backup-Datensatz enthält ungültige oder doppelte IDs.");
    ids.add(id);
    if (typeof row["created_at"] !== "string" || !row["created_at"])
      fail("Backup-Datensatz enthält ungültige Zeitstempel.");
    return row;
  });
}

function validateDatabase(value: unknown): BackupDatabase {
  if (!isRecord(value) || !isRecord(value["tables"])) fail("Die Backup-Datenbank ist ungültig.");
  if (
    Object.keys(value).some(
      (key) =>
        ![
          "tables",
          "users",
          "settings",
          "appearances",
          "navigation",
          "analysisViews",
          "syncOperations",
          "paperless",
        ].includes(key),
    )
  )
    fail("Die Backup-Datenbank enthält unbekannte Bereiche.");
  const tables = value["tables"];
  if (
    Object.keys(tables).some((table) => !TABLE_NAMES.includes(table as TableName)) ||
    TABLE_NAMES.some((table) => !OPTIONAL_TABLES.has(table) && !(table in tables))
  )
    fail("Das Backup enthält nicht alle Bauplan-Datentabellen.");

  const normalizedTables = {} as BackupDatabase["tables"];
  for (const table of TABLE_NAMES) {
    const columns = ["id", "created_at", ...TABLES[table]];
    const required =
      table !== "projects" ? columns.filter((column) => column !== "project_id") : columns;
    const requiredWithLegacyColumns =
      table === "tasks"
        ? required.filter((column) => !["assignee_id", "checklist"].includes(column))
        : table === "offers"
          ? required.filter((column) => column !== "valid_until")
          : table === "expenses"
            ? required.filter((column) => !["offer_id", "contact_id", "due_date"].includes(column))
            : table === "events"
              ? required.filter((column) => !["caldav_uid", "caldav_data"].includes(column))
              : table === "credit_terms"
                ? required.filter((column) => column !== "assumed_full_draw_date")
                : required;
    const validatedRows = validateRows(
      OPTIONAL_TABLES.has(table) && !(table in tables) ? [] : tables[table],
      columns,
      requiredWithLegacyColumns,
    );
    const rows: Record<string, unknown>[] =
      table !== "projects"
        ? validatedRows.map((row) => ({ project_id: row["project_id"] ?? null, ...row }))
        : validatedRows;
    const normalizedRows: Record<string, unknown>[] =
      table === "tasks"
        ? rows.map((row) => ({
            ...row,
            assignee_id: row["assignee_id"] ?? null,
            checklist: row["checklist"] ?? null,
          }))
        : table === "offers"
          ? rows.map((row) => ({ ...row, valid_until: row["valid_until"] ?? null }))
          : table === "expenses"
            ? rows.map((row) => ({
                ...row,
                offer_id: row["offer_id"] ?? null,
                contact_id: row["contact_id"] ?? null,
                due_date: row["due_date"] ?? null,
              }))
            : table === "credit_terms"
              ? rows.map((row) => ({
                  ...row,
                  assumed_full_draw_date: row["assumed_full_draw_date"] ?? null,
                }))
              : table === "events"
                ? rows.map((row) => ({
                    ...row,
                    caldav_uid: row["caldav_uid"] ?? null,
                    caldav_data: row["caldav_data"] ?? null,
                  }))
                : rows;
    for (const row of normalizedRows) {
      if (table === "tasks") parseTaskChecklist(row["checklist"]);
      for (const [column, item] of Object.entries(row)) {
        if (item !== null && NUMERIC_COLS.has(column) && typeof item !== "number")
          fail("Backup-Datensatz enthält ungültige Zahlenwerte.");
        if (
          BOOL_COLS.has(column) &&
          item !== null &&
          item !== 0 &&
          item !== 1 &&
          item !== false &&
          item !== true
        )
          fail("Backup-Datensatz enthält ungültige Wahrheitswerte.");
        if (
          !NUMERIC_COLS.has(column) &&
          !BOOL_COLS.has(column) &&
          item !== null &&
          typeof item !== "string"
        )
          fail("Backup-Datensatz enthält ungültige Textwerte.");
      }
    }
    normalizedTables[table] = normalizedRows;
  }
  const defaultProject = normalizedTables.projects
    .slice()
    .sort(
      (left, right) =>
        String(left["created_at"]).localeCompare(String(right["created_at"])) ||
        String(left["id"]).localeCompare(String(right["id"])),
    )[0];
  if (typeof defaultProject?.["id"] === "string")
    for (const table of TABLE_NAMES) {
      if (table === "projects") continue;
      for (const row of normalizedTables[table]) row["project_id"] ??= defaultProject["id"];
    }
  const expenseIds = new Set(normalizedTables.expenses.map((row) => row["id"]));
  for (const invoice of normalizedTables.invoices) {
    const expense = legacyInvoiceExpense(invoice);
    if (expenseIds.has(expense["id"]))
      fail("Backup enthält kollidierende Rechnungs- und Ausgaben-IDs.");
    expenseIds.add(expense["id"]);
    normalizedTables.expenses.push(expense);
  }
  normalizedTables.invoices = [];
  for (const entry of normalizedTables.funding_entries)
    validateFundingEntry(
      entry,
      normalizedTables.budget_pots.map((pot) => ({
        id: String(pot["id"]),
        deducts_from_budget: Boolean(pot["deducts_from_budget"]),
      })),
    );

  const users = value["users"];
  if (!Array.isArray(users)) fail("Die Benutzerkonten im Backup sind ungültig.");
  const userIds = new Set<string>();
  const emails = new Set<string>();
  const oidcSubs = new Set<string>();
  const validUsers = users.map((user) => {
    if (!isRecord(user)) fail("Das Backup enthält ein ungültiges Benutzerkonto.");
    const { id, email, name, password_hash, role, oidc_sub, created_at } = user;
    if (
      typeof id !== "string" ||
      !id ||
      userIds.has(id) ||
      typeof email !== "string" ||
      !z.string().email().safeParse(email).success ||
      email !== email.trim().toLowerCase() ||
      emails.has(email.toLowerCase()) ||
      (name !== null && typeof name !== "string") ||
      (password_hash !== null && typeof password_hash !== "string") ||
      !["admin", "member", "pending"].includes(String(role)) ||
      (oidc_sub !== null && typeof oidc_sub !== "string") ||
      typeof created_at !== "string" ||
      !created_at ||
      (typeof oidc_sub === "string" && oidcSubs.has(oidc_sub)) ||
      Object.keys(user).some(
        (key) =>
          !["id", "email", "name", "password_hash", "role", "oidc_sub", "created_at"].includes(key),
      )
    )
      fail("Das Backup enthält ein ungültiges Benutzerkonto.");
    userIds.add(id);
    emails.add(email.toLowerCase());
    if (typeof oidc_sub === "string") oidcSubs.add(oidc_sub);
    return user;
  });
  if (validUsers.length && !validUsers.some((user) => user["role"] === "admin"))
    fail("Das Backup enthält kein Administratorkonto.");

  const settings = validateKeyValueRows(value["settings"], "key", "value");
  const appearances = validateUserRows(
    value["appearances"],
    ["user_id", "palette", "mode"],
    userIds,
    (row) => {
      try {
        appearanceSchema.parse({ palette: row["palette"], mode: row["mode"] });
      } catch {
        fail("Darstellungseinstellungen im Backup sind ungültig.");
      }
    },
  );
  const navigation = validateUserRows(
    value["navigation"],
    ["user_id", "preferences"],
    userIds,
    (row) => {
      if (typeof row["preferences"] !== "string")
        fail("Navigationsoptionen im Backup sind ungültig.");
      try {
        parseNavigation(JSON.parse(row["preferences"]));
      } catch {
        fail("Navigationsoptionen im Backup sind ungültig.");
      }
    },
  );
  const analysisViews =
    value["analysisViews"] === undefined
      ? undefined
      : validateUserRows(value["analysisViews"], ["user_id", "views"], userIds, (row) => {
          try {
            if (typeof row["views"] !== "string") throw new Error("invalid");
            analysisViewsSchema.parse(JSON.parse(row["views"]));
          } catch {
            fail("Analyseansichten im Backup sind ungültig.");
          }
        });
  const syncOperations = value["syncOperations"];
  if (!Array.isArray(syncOperations)) fail("Sync-Metadaten im Backup sind ungültig.");
  const operationIds = new Set<string>();
  const validSyncOperations = syncOperations.map((row) => {
    if (
      !isRecord(row) ||
      Object.keys(row).some((key) => !["id", "user_id", "applied_at"].includes(key)) ||
      typeof row["id"] !== "string" ||
      !row["id"] ||
      operationIds.has(row["id"]) ||
      typeof row["user_id"] !== "string" ||
      !userIds.has(row["user_id"]) ||
      typeof row["applied_at"] !== "string" ||
      !row["applied_at"]
    )
      fail("Sync-Metadaten im Backup sind ungültig.");
    operationIds.add(row["id"]);
    return row;
  });

  return {
    tables: normalizedTables,
    users: validUsers,
    settings,
    appearances,
    navigation,
    ...(analysisViews ? { analysisViews } : {}),
    syncOperations: validSyncOperations,
    ...(value["paperless"] === undefined
      ? {}
      : {
          paperless: validatePaperlessBackup(
            value["paperless"],
            new Set(normalizedTables.documents.map((row) => String(row["id"]))),
            userIds,
          ),
        }),
  };
}

function validatePaperlessBackup(
  value: unknown,
  documentIds: Set<string>,
  userIds: Set<string>,
): NonNullable<BackupDatabase["paperless"]> {
  const identifier = z.string().min(1).max(200);
  const hash = z.string().regex(/^[a-f0-9]{64}$/);
  const timestamp = z.string().datetime({ offset: true });
  const parsed = z
    .object({
      config: z
        .array(
          z
            .object({
              id: z.literal(1),
              instance_id: identifier,
              enabled: z.union([z.literal(0), z.literal(1)]),
              api_url: z.string().max(2048),
              browser_url: z.string().max(2048),
            })
            .strict(),
        )
        .max(1),
      links: z.array(
        z
          .object({
            document_id: identifier,
            instance_id: identifier,
            remote_id: z.number().int().positive(),
            direction: z.enum(["import", "export"]),
            linked_at: timestamp,
            checksum: hash,
            browser_url: z.string().max(2048),
          })
          .strict(),
      ),
      jobs: z.array(
        z
          .object({
            id: identifier,
            document_id: identifier,
            instance_id: identifier,
            user_id: identifier.nullable(),
            metadata: z.string().max(20000),
            state: z.enum([
              "queued",
              "transferring",
              "processing",
              "linked",
              "failed",
              "unknown",
              "paused",
              "abandoned",
            ]),
            task_id: z.string().uuid().nullable(),
            error: z.string().max(100).nullable(),
            created_at: timestamp,
            updated_at: timestamp,
            checksum: hash.nullable(),
          })
          .strict(),
      ),
    })
    .strict()
    .safeParse(value);
  if (!parsed.success) fail("paperless.errors.invalid_backup");
  const data = parsed.data;
  for (const config of data.config) {
    if (
      normalizePaperlessUrl(config.api_url) !== config.api_url ||
      normalizePaperlessUrl(config.browser_url) !== config.browser_url
    )
      fail("paperless.errors.invalid_backup");
  }
  const sources = new Set<string>();
  const linkedDocuments = new Set<string>();
  for (const link of data.links) {
    if (normalizePaperlessUrl(link.browser_url) !== link.browser_url)
      fail("paperless.errors.invalid_backup");
    const source = `${link.instance_id}:${link.remote_id}`;
    if (
      !documentIds.has(link.document_id) ||
      linkedDocuments.has(link.document_id) ||
      sources.has(source)
    )
      fail("paperless.errors.invalid_backup");
    linkedDocuments.add(link.document_id);
    sources.add(source);
  }
  const jobDocuments = new Set<string>();
  const jobIds = new Set<string>();
  for (const job of data.jobs) {
    let metadata: unknown;
    try {
      metadata = JSON.parse(job.metadata);
    } catch {
      fail("paperless.errors.invalid_backup");
    }
    const checked = paperlessExportMetadataSchema.safeParse(metadata);
    if (
      !checked.success ||
      checked.data.documentId !== job.document_id ||
      !documentIds.has(job.document_id) ||
      jobDocuments.has(job.document_id) ||
      jobIds.has(job.id) ||
      (job.user_id !== null && !userIds.has(job.user_id)) ||
      (job.state === "linked" && !linkedDocuments.has(job.document_id))
    )
      fail("paperless.errors.invalid_backup");
    jobDocuments.add(job.document_id);
    jobIds.add(job.id);
  }
  return data;
}

function validateKeyValueRows(value: unknown, keyColumn: string, valueColumn: string) {
  if (!Array.isArray(value)) fail("Backup-Datentabelle ist ungültig.");
  const keys = new Set<string>();
  return value.map((row) => {
    if (
      !isRecord(row) ||
      Object.keys(row).some((key) => key !== keyColumn && key !== valueColumn) ||
      typeof row[keyColumn] !== "string" ||
      !row[keyColumn] ||
      keys.has(row[keyColumn] as string) ||
      (row[valueColumn] !== null && typeof row[valueColumn] !== "string")
    )
      fail("Backup-Datentabelle ist ungültig.");
    keys.add(row[keyColumn] as string);
    return row;
  });
}

function validateUserRows(
  value: unknown,
  columns: string[],
  userIds: Set<string>,
  validate: (row: Record<string, unknown>) => void,
) {
  if (!Array.isArray(value)) fail("Backup-Datentabelle ist ungültig.");
  const ids = new Set<string>();
  return value.map((row) => {
    if (
      !isRecord(row) ||
      Object.keys(row).some((key) => !columns.includes(key)) ||
      columns.some((key) => !(key in row)) ||
      typeof row["user_id"] !== "string" ||
      !userIds.has(row["user_id"]) ||
      ids.has(row["user_id"])
    )
      fail("Backup-Datentabelle ist ungültig.");
    ids.add(row["user_id"]);
    validate(row);
    return row;
  });
}

function safeUploadName(name: string): boolean {
  return isSafeStoragePath(name) && !name.includes("..");
}

function hash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function fileList(database: BackupDatabase, files: BackupFile[], includesUploads = true) {
  if (files.length + 1 > MAX_ARCHIVE_ENTRIES) fail("Das Backup enthält zu viele Dateien.");
  const uploadedNames = new Set<string>();
  let totalBytes = 0;
  for (const file of files) {
    if (!safeUploadName(file.name) || uploadedNames.has(file.name))
      fail("Das Backup enthält einen ungültigen oder doppelten Dateinamen.");
    totalBytes += file.bytes.byteLength;
    if (totalBytes > MAX_EXPANDED_BYTES)
      fail("Das Backup überschreitet die erlaubte entpackte Größe.");
    uploadedNames.add(file.name);
  }
  const referenced = new Set(
    [...database.tables.documents, ...database.tables.idea_images]
      .map((row) => row["storage_path"])
      .filter((name): name is string => typeof name === "string" && name.length > 0),
  );
  if (includesUploads)
    for (const name of referenced)
      if (!uploadedNames.has(name)) fail("Im Backup fehlt eine referenzierte Dokumentdatei.");
  return files.map((file) => ({
    name: file.name,
    size: file.bytes.byteLength,
    sha256: hash(file.bytes),
  }));
}

export async function createBackup(repo: Repo, includeUploads = true): Promise<Uint8Array> {
  const { database, files } = await repo.exportBackup(MAX_EXPANDED_BYTES, includeUploads);
  validateDatabase(database);
  const entries: Record<string, Uint8Array> = {};
  const manifest: Manifest = {
    format: FORMAT,
    version: includeUploads ? VERSION : 2,
    ...(includeUploads ? {} : { includesUploads: false as const }),
    createdAt: new Date().toISOString(),
    database,
    files: fileList(database, files, includeUploads),
  };
  const manifestBytes = strToU8(JSON.stringify(manifest));
  if (manifestBytes.byteLength > MAX_MANIFEST_BYTES) fail("Die Backup-Datenbank ist zu groß.");
  const expandedBytes =
    manifestBytes.byteLength + files.reduce((total, file) => total + file.bytes.byteLength, 0);
  if (expandedBytes > MAX_EXPANDED_BYTES)
    fail("Das Backup überschreitet die erlaubte entpackte Größe.");
  entries["backup.json"] = manifestBytes;
  for (const file of files) entries[`uploads/${file.name}`] = file.bytes;
  const archive = zipSync(entries, { level: 0 });
  if (archive.byteLength > MAX_BACKUP_BYTES)
    fail("Das Backup ist größer als die erlaubten 512 MB.");
  return archive;
}

function validateArchiveFiles(entries: Unzipped): {
  database: BackupDatabase;
  includesUploads: boolean;
  files: BackupFile[];
} {
  const metadata = entries["backup.json"];
  if (!metadata) fail("Das Backup enthält keine Metadaten.");
  if (metadata.byteLength > MAX_MANIFEST_BYTES) fail("Die Backup-Metadaten sind zu groß.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(strFromU8(metadata));
  } catch {
    fail("Die Backup-Metadaten sind beschädigt.");
  }
  if (!isRecord(parsed)) fail("Die Backup-Metadaten sind ungültig.");
  if (parsed["format"] !== FORMAT) fail("Die Datei ist kein Bauplan-Backup.");
  if (parsed["version"] !== VERSION && parsed["version"] !== 2)
    fail("Diese Backup-Version wird von dieser Bauplan-Version nicht unterstützt.");
  const includesUploads = parsed["version"] === VERSION;
  if (
    (includesUploads && "includesUploads" in parsed) ||
    (!includesUploads && parsed["includesUploads"] !== false)
  )
    fail("Die Backup-Metadaten sind ungültig.");
  if (typeof parsed["createdAt"] !== "string" || !Array.isArray(parsed["files"]))
    fail("Die Backup-Metadaten sind unvollständig.");
  const database = validateDatabase(parsed["database"]);
  const files = new Map<string, Uint8Array>();
  for (const [name, bytes] of Object.entries(entries)) {
    if (name === "backup.json") continue;
    if (!name.startsWith("uploads/") || !safeUploadName(name.slice("uploads/".length)))
      fail("Das Backup enthält einen unsicheren Dateipfad.");
    const fileName = name.slice("uploads/".length);
    if (files.has(fileName)) fail("Das Backup enthält doppelte Dateien.");
    files.set(fileName, bytes);
  }
  if (parsed["files"].length !== files.size) fail("Die Dateiliste im Backup stimmt nicht überein.");
  if (!includesUploads && files.size !== 0) fail("Die Backup-Metadaten sind ungültig.");
  const manifestFiles = new Set<string>();
  const validFiles = parsed["files"].map((entry) => {
    if (
      !isRecord(entry) ||
      typeof entry["name"] !== "string" ||
      !safeUploadName(entry["name"]) ||
      manifestFiles.has(entry["name"]) ||
      typeof entry["size"] !== "number" ||
      !Number.isSafeInteger(entry["size"]) ||
      typeof entry["sha256"] !== "string" ||
      !/^[a-f0-9]{64}$/.test(entry["sha256"])
    )
      fail("Die Dateiliste im Backup ist ungültig.");
    manifestFiles.add(entry["name"]);
    const bytes = files.get(entry["name"]);
    if (!bytes || bytes.byteLength !== entry["size"] || hash(bytes) !== entry["sha256"])
      fail("Eine Backup-Datei fehlt oder ist beschädigt.");
    return { name: entry["name"], bytes };
  });
  if (manifestFiles.size !== files.size) fail("Das Backup enthält nicht aufgeführte Dateien.");
  fileList(database, validFiles, includesUploads);
  return {
    database,
    includesUploads,
    files: validFiles,
  };
}

export function parseBackup(bytes: Uint8Array): {
  database: BackupDatabase;
  files: BackupFile[];
  includesUploads: boolean;
} {
  if (!bytes.byteLength || bytes.byteLength > MAX_BACKUP_BYTES)
    fail("Die Backup-Datei ist leer oder überschreitet 512 MB.");
  let fileCount = 0;
  let expandedBytes = 0;
  const entryNames = new Set<string>();
  let entries: Unzipped;
  try {
    entries = unzipSync(bytes, {
      filter: ({ name, originalSize, compression }) => {
        fileCount++;
        if (fileCount > MAX_ARCHIVE_ENTRIES) fail("Das Backup enthält zu viele Dateien.");
        if (entryNames.has(name)) fail("Das Backup enthält doppelte Dateien.");
        entryNames.add(name);
        if (compression !== 0 && compression !== 8)
          fail("Das Backup verwendet ein nicht unterstütztes Kompressionsverfahren.");
        if (
          name !== "backup.json" &&
          (!name.startsWith("uploads/") || !safeUploadName(name.slice("uploads/".length)))
        )
          fail("Das Backup enthält einen unsicheren Dateipfad.");
        if (!Number.isSafeInteger(originalSize) || originalSize < 0)
          fail("Das Backup enthält eine ungültige Dateigröße.");
        expandedBytes += originalSize;
        if (expandedBytes > MAX_EXPANDED_BYTES)
          fail("Das Backup überschreitet die erlaubte entpackte Größe.");
        return true;
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Das Backup")) throw error;
    throw new Error("Die Backup-Datei ist beschädigt oder kein gültiges ZIP-Archiv.");
  }
  return validateArchiveFiles(entries);
}

export async function restoreBackup(
  repo: Repo,
  bytes: Uint8Array,
  requireNoUsers = false,
): Promise<number> {
  const backup = parseBackup(bytes);
  await repo.restoreBackup(backup.database, backup.files, requireNoUsers, !backup.includesUploads);
  return backup.database.users.length;
}

export function digestBackupFile(bytes: Uint8Array) {
  return hash(bytes);
}
