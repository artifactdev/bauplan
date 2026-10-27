import { createHash } from "node:crypto";
import { strFromU8, strToU8, unzipSync, zipSync, type Unzipped } from "fflate";
import { BOOL_COLS, NUMERIC_COLS, TABLE_NAMES, TABLES, type TableName } from "@/lib/schema";
import { appearanceSchema } from "@/lib/appearance";
import { navigationSchema } from "@/lib/navigation";
import { z } from "zod";
import type { BackupDatabase, BackupFile, Repo } from "./repo";

export const MAX_BACKUP_BYTES = 128 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 256 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 10_000;
const MAX_MANIFEST_BYTES = 32 * 1024 * 1024;
const FORMAT = "bauplan-backup";
const VERSION = 1;

type Manifest = {
  format: typeof FORMAT;
  version: typeof VERSION;
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
        !["tables", "users", "settings", "appearances", "navigation", "syncOperations"].includes(
          key,
        ),
    )
  )
    fail("Die Backup-Datenbank enthält unbekannte Bereiche.");
  const tables = value["tables"];
  if (
    Object.keys(tables).length !== TABLE_NAMES.length ||
    TABLE_NAMES.some((table) => !(table in tables))
  )
    fail("Das Backup enthält nicht alle Bauplan-Datentabellen.");

  const normalizedTables = {} as BackupDatabase["tables"];
  for (const table of TABLE_NAMES) {
    const columns = ["id", "created_at", ...TABLES[table]];
    const required =
      table === "tasks"
        ? columns.filter((column) => column !== "assignee_id")
        : table === "offers"
          ? columns.filter((column) => column !== "valid_until")
          : columns;
    const validatedRows = validateRows(tables[table], columns, required);
    const rows =
      table === "tasks"
        ? validatedRows.map((row) => ({ ...row, assignee_id: row["assignee_id"] ?? null }))
        : table === "offers"
          ? validatedRows.map((row) => ({ ...row, valid_until: row["valid_until"] ?? null }))
          : validatedRows;
    for (const row of rows) {
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
    normalizedTables[table] = rows;
  }

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
        navigationSchema.parse(JSON.parse(row["preferences"]));
      } catch {
        fail("Navigationsoptionen im Backup sind ungültig.");
      }
    },
  );
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
    syncOperations: validSyncOperations,
  };
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
  return (
    /^[a-zA-Z0-9._-]{1,255}$/.test(name) && name !== "." && name !== ".." && !name.includes("..")
  );
}

function hash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function fileList(database: BackupDatabase, files: BackupFile[]) {
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
    database.tables.documents
      .map((row) => row["storage_path"])
      .filter((name): name is string => typeof name === "string" && name.length > 0),
  );
  for (const name of referenced)
    if (!uploadedNames.has(name)) fail("Im Backup fehlt eine referenzierte Dokumentdatei.");
  return files.map((file) => ({
    name: file.name,
    size: file.bytes.byteLength,
    sha256: hash(file.bytes),
  }));
}

export async function createBackup(repo: Repo): Promise<Uint8Array> {
  const { database, files } = await repo.exportBackup(MAX_EXPANDED_BYTES);
  validateDatabase(database);
  const entries: Record<string, Uint8Array> = {};
  const manifest: Manifest = {
    format: FORMAT,
    version: VERSION,
    createdAt: new Date().toISOString(),
    database,
    files: fileList(database, files),
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
    fail("Das Backup ist größer als die erlaubten 128 MB.");
  return archive;
}

function validateArchiveFiles(entries: Unzipped): {
  manifest: Manifest;
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
  if (parsed["version"] !== VERSION)
    fail("Diese Backup-Version wird von dieser Bauplan-Version nicht unterstützt.");
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
  fileList(database, validFiles);
  return {
    manifest: { ...parsed, database } as unknown as Manifest,
    files: validFiles,
  };
}

export function parseBackup(bytes: Uint8Array): {
  database: BackupDatabase;
  files: BackupFile[];
} {
  if (!bytes.byteLength || bytes.byteLength > MAX_BACKUP_BYTES)
    fail("Die Backup-Datei ist leer oder überschreitet 128 MB.");
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
  const { manifest, files } = validateArchiveFiles(entries);
  return { database: manifest.database, files };
}

export async function restoreBackup(
  repo: Repo,
  bytes: Uint8Array,
  requireNoUsers = false,
): Promise<number> {
  const backup = parseBackup(bytes);
  await repo.restoreBackup(backup.database, backup.files, requireNoUsers);
  return backup.database.users.length;
}

export function digestBackupFile(bytes: Uint8Array) {
  return hash(bytes);
}
