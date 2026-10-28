// @vitest-environment node
import { randomUUID, createHash } from "node:crypto";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createBackup, parseBackup, restoreBackup } from "./backup";
import { paperlessRepo, sqliteRepo, getSqliteDb, type SqliteDb } from "./repo";
import {
  connect,
  disconnect,
  documentStates,
  exportDocuments,
  importDocument,
  reconcile,
  saveSettings,
  search,
  settingsView,
  startPaperless,
  stopPaperless,
  autoImportSettings,
  saveAutoImport,
  processAutoImports,
  verifyDocuments,
} from "./paperless";
import {
  decryptToken,
  encryptToken,
  encryptionReady,
  normalizePaperlessUrl,
  PaperlessClient,
} from "./paperless-client";

const directory = join(process.cwd(), `.paperless-test-${randomUUID()}`);
const previousDataDir = process.env["DATA_DIR"];
const previousKey = process.env["PAPERLESS_SETTINGS_KEY"];
const repo = sqliteRepo();
const admin = { id: "admin", role: "admin" };
const member = { id: "member", role: "member" };
const bytes = new TextEncoder().encode("%PDF-1.7\nInvoice\n");
const hash = createHash("sha256").update(bytes).digest("hex");
const taskId = "a61bbd38-53e7-48cf-935d-689172891b4c";
let db: SqliteDb;
let remoteStatus = "SUCCESS";
let original = bytes;
let submit: "ok" | "timeout" | "reject" = "ok";
let inaccessible = false;
let remoteId = 42;
let metadataForbidden = false;
let emptyContent = false;
let originalMissing = false;
let correspondentId: number | null = null;
let autoTag = false;
let tagNext = false;
const requests: { url: string; token: string; options: RequestInit }[] = [];

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}
function detail(id = remoteId) {
  return {
    id,
    title: "Invoice roof",
    created: "2026-10-15T00:00:00Z",
    tags: autoTag ? [11] : metadataForbidden ? [1] : [],
    correspondent: correspondentId,
    document_type: null,
    original_file_name: "invoice.pdf",
    content: emptyContent
      ? ""
      : "RECHNUNG\nDachbau GmbH\nRechnungsdatum 15.10.2026\nGesamtbetrag 123,45 EUR",
  };
}
const request = vi.fn(async (url: string | URL | Request, options: RequestInit = {}) => {
  const address = String(url);
  const token = (options.headers as Record<string, string>)["Authorization"] ?? "";
  requests.push({ url: address, token, options });
  if (address.includes("post_document")) {
    if (submit === "timeout") throw new TypeError("network disconnected after acceptance");
    if (submit === "reject") return json({ detail: "forbidden" }, 403);
    return json(taskId);
  }
  if (address.includes("/api/tasks/"))
    return json([
      {
        task_id: taskId,
        status: remoteStatus,
        related_document: remoteStatus === "SUCCESS" ? remoteId : null,
        result: remoteStatus === "FAILURE" ? "duplicate document already exists" : "",
      },
    ]);
  if (address.includes("/download/"))
    return originalMissing
      ? json({}, 404)
      : new Response(original, { headers: { "content-type": "application/pdf" } });
  if (address.includes("/preview/"))
    return new Response(bytes, { headers: { "content-type": "application/pdf" } });
  if (/\/api\/documents\/\d+\/$/.test(address))
    return inaccessible
      ? json({}, 404)
      : json(detail(Number(address.match(/documents\/(\d+)/)?.[1])));
  if (address.includes("/api/documents/"))
    return json({
      count: 1,
      next: tagNext ? "http://paperless:8000/api/documents/?page=2" : null,
      results: [detail()],
    });
  if (metadataForbidden && address.includes("/api/tags/")) return json({}, 403);
  if (address.includes("/api/tags/") && autoTag)
    return json({ count: 1, next: null, results: [{ id: 11, name: "Bauplan" }] });
  if (address.includes("/api/correspondents/"))
    return json({ count: 1, next: null, results: [{ id: 7, name: "Roofing Ltd" }] });
  return json({ count: 0, next: null, results: [] });
});

beforeAll(async () => {
  mkdirSync(directory);
  process.env["DATA_DIR"] = directory;
  process.env["PAPERLESS_SETTINGS_KEY"] = "ab".repeat(32);
  db = await getSqliteDb();
});
beforeEach(async () => {
  await stopPaperless();
  db.exec(
    "DELETE FROM app_paperless_auto_import; DELETE FROM app_paperless_jobs; DELETE FROM app_paperless_links; DELETE FROM app_paperless_credentials; DELETE FROM app_paperless_checks; DELETE FROM app_paperless_config; DELETE FROM documents; DELETE FROM app_users;",
  );
  for (const [id, role] of [
    ["admin", "admin"],
    ["member", "member"],
    ["pending", "pending"],
  ]) {
    db.prepare("INSERT INTO app_users (id,email,role,created_at) VALUES (?,?,?,?)").run(
      id,
      `${id}@example.test`,
      role,
      new Date().toISOString(),
    );
  }
  vi.stubGlobal("fetch", request);
  requests.length = 0;
  request.mockClear();
  remoteStatus = "SUCCESS";
  original = bytes;
  submit = "ok";
  inaccessible = false;
  remoteId = 42;
  metadataForbidden = false;
  emptyContent = false;
  originalMissing = false;
  correspondentId = null;
  autoTag = false;
  tagNext = false;
  await saveSettings(admin, {
    enabled: true,
    apiUrl: "http://paperless.internal:8000",
    publicUrl: "https://archive.example.test",
  });
  await startPaperless();
  await stopPaperless();
  await connect(admin, "admin-token");
  await connect(member, "member-token");
});
afterEach(async () => {
  await stopPaperless();
  vi.unstubAllGlobals();
});
afterAll(() => {
  if (previousDataDir === undefined) delete process.env["DATA_DIR"];
  else process.env["DATA_DIR"] = previousDataDir;
  if (previousKey === undefined) delete process.env["PAPERLESS_SETTINGS_KEY"];
  else process.env["PAPERLESS_SETTINGS_KEY"] = previousKey;
  rmSync(directory, { recursive: true, force: true });
});
async function local(id = "local") {
  const path = await repo.putFile("local.pdf", "application/pdf", bytes);
  await repo.insert("documents", {
    id,
    name: "local.pdf",
    storage_path: path,
    mime_type: "application/pdf",
    size: bytes.length,
  });
  return id;
}
function exportMetadata(documentId = "local") {
  return {
    documentId,
    title: "Reviewed title",
    documentDate: "2026-10-15",
    tags: [],
    documentType: null,
    correspondent: null,
  };
}
async function work() {
  await startPaperless();
  await stopPaperless();
}

describe("Paperless private integration", () => {
  it("encrypts tokens with deployment key, binds ciphertext to user/instance, never returns secrets", async () => {
    const config = (await paperlessRepo.config())!;
    const encrypted = (await paperlessRepo.credential(member.id, config.instance_id))!;
    expect(encrypted).not.toContain("member-token");
    expect(decryptToken(encrypted, member.id, config.instance_id)).toBe("member-token");
    expect(() => decryptToken(encrypted, admin.id, config.instance_id)).toThrow(
      "credentials_invalid",
    );
    expect(() => decryptToken(encrypted, member.id, "another-instance")).toThrow(
      "credentials_invalid",
    );
    expect(JSON.stringify(await settingsView(member))).not.toContain("paperless.internal");
    expect(JSON.stringify(await settingsView(member))).not.toContain("member-token");
    delete process.env["PAPERLESS_SETTINGS_KEY"];
    expect(encryptionReady()).toBe(false);
    expect(() => encryptToken("secret", "a", "b")).toThrow("encryption_key");
    process.env["PAPERLESS_SETTINGS_KEY"] = "ab".repeat(32);
  });

  it("isolates search credentials, rejects pending accounts, preserves untrusted text as plain strings", async () => {
    requests.length = 0;
    await search(member.id, {
      query: "<img onerror=alert(1)>",
      page: 2,
      tags: [1],
      documentType: 3,
      correspondent: 4,
      dateFrom: "2026-01-01",
      dateTo: "2026-10-01",
    });
    expect(requests[0]?.token).toBe("Token member-token");
    expect((requests[0]?.options.headers as Record<string, string>)["Accept"]).toBe(
      "application/json; version=9",
    );
    expect(requests[0]?.url).toContain("page=2");
    expect(requests[0]?.url).toContain("tags__id__all=1");
    expect(requests[0]?.url).toContain("created__date__gte=2026-01-01");
    await expect(search("pending", { query: "", page: 1, tags: [] })).rejects.toThrow(
      "unauthorized",
    );
    expect(requests).toHaveLength(1);
    await expect(
      saveSettings(member, { enabled: true, apiUrl: "https://other.example", publicUrl: "" }),
    ).rejects.toThrow("unauthorized");
  });

  it("imports only an original local snapshot, extracts suggestions and resolves repeated/concurrent source imports", async () => {
    const [first, second] = await Promise.all([
      importDocument(member.id, 42),
      importDocument(admin.id, 42),
    ]);
    expect(first.documentId).toBe(second.documentId);
    expect([first.duplicate, second.duplicate].sort()).toEqual([false, true]);
    expect((await repo.getAll()).documents).toHaveLength(1);
    const imported = first.duplicate ? second : first;
    expect(imported.extraction?.amount).toBe(123.45);
    expect(imported.extractionSource).toBe("paperless");
    expect((await repo.getAll()).documents[0]?.category).toBe("Rechnung");
    expect((await repo.getAll()).expenses).toHaveLength(0);
    const document = (await repo.getAll()).documents[0]!;
    expect(await repo.readFile(document.storage_path!)).toEqual(bytes);
    expect(requests.some((call) => call.url.endsWith("/download/?original=true"))).toBe(true);
    expect(JSON.stringify(await repo.getAll())).not.toContain("RECHNUNG");
    expect(await importDocument(member.id, 42)).toMatchObject({
      documentId: first.documentId,
      duplicate: true,
      extraction: null,
    });
  });

  it("keeps a successful original import when optional metadata cannot be read, and allows manual assignment without text", async () => {
    metadataForbidden = true;
    const result = await importDocument(member.id, 42);
    expect(result).toMatchObject({ duplicate: false, extractionError: "metadata_unavailable" });
    expect(result.extraction?.amount).toBe(123.45);
    expect((await repo.getAll()).documents).toHaveLength(1);
    metadataForbidden = false;
    emptyContent = true;
    original = new TextEncoder().encode("%PDF-1.7\nDifferent original without text\n");
    const empty = await importDocument(member.id, 43);
    expect(empty).toMatchObject({
      duplicate: false,
      extractionError: null,
      extraction: {
        title: "Invoice roof",
        date: "2026-10-15",
        amount: null,
        vendor: null,
        contact_id: null,
      },
    });
    expect(
      (await repo.getAll()).documents.find((doc) => doc.id === empty.documentId)?.category,
    ).toBe("Sonstiges");
  });

  it("uses an authorized correspondent as a reviewed vendor suggestion and matches only a unique existing contact", async () => {
    emptyContent = true;
    correspondentId = 7;
    await repo.insert("contacts", { id: "roofing", name: "Roofing Ltd" });
    const first = await importDocument(member.id, 42);
    expect(first.extraction).toMatchObject({
      vendor: "Roofing Ltd",
      contact_id: "roofing",
      amount: null,
      title: "Invoice roof",
      date: "2026-10-15",
    });
    await repo.insert("contacts", { id: "other-roofing", name: "Roofing Ltd" });
    original = new TextEncoder().encode("%PDF-1.7\nDifferent original with correspondent\n");
    const ambiguous = await importDocument(member.id, 43);
    expect(ambiguous.extraction).toMatchObject({
      vendor: "Roofing Ltd",
      contact_id: null,
      amount: null,
    });
    expect((await repo.getAll()).contacts).toHaveLength(2);
    expect((await repo.getAll()).expenses).toHaveLength(0);
    expect((await repo.getAll()).offers).toHaveLength(0);
    await repo.remove("contacts", "roofing");
    await repo.remove("contacts", "other-roofing");
  });

  it("does not substitute an archive rendition for an unavailable original", async () => {
    originalMissing = true;
    await expect(importDocument(member.id, 42)).rejects.toThrow("not_found");
    expect((await repo.getAll()).documents).toHaveLength(0);
    expect(requests.filter((call) => call.url.includes("/download/"))).toHaveLength(1);
  });

  it("cleans downloaded files when configuration changes before database persistence", async () => {
    const before = readdirSync(join(directory, "uploads")).length;
    request.mockImplementationOnce(async () => json(detail()));
    request.mockImplementationOnce(async () => {
      const config = (await paperlessRepo.config())!;
      await paperlessRepo.configure({ ...config, enabled: 0 });
      return new Response(bytes, { headers: { "content-type": "application/pdf" } });
    });
    await expect(importDocument(member.id, 42)).rejects.toThrow("configuration_changed");
    expect((await repo.getAll()).documents).toHaveLength(0);
    expect(readdirSync(join(directory, "uploads"))).toHaveLength(before);
  });

  it("does not mutate source snapshots through generic online or offline writes", async () => {
    const imported = await importDocument(member.id, 42);
    await expect(
      repo.update("documents", imported.documentId, { storage_path: "other.pdf" }),
    ).rejects.toThrow("paperless.errors.active_transfer");
    const base = (await repo.getAll()).documents[0]!;
    await expect(
      repo.applySyncChange(member.id, {
        id: randomUUID(),
        table: "documents",
        action: "update",
        rowId: base.id,
        base,
        row: { ...base, storage_path: "other.pdf" },
      }),
    ).rejects.toThrow("paperless.errors.active_transfer");
    expect((await paperlessRepo.link(base.id))?.remote_id).toBe(42);
    await repo.remove("documents", base.id);
    expect(await paperlessRepo.link(base.id)).toBeUndefined();
  });

  it("claims a single shared export, persists task acceptance, validates checksum, and avoids a second import", async () => {
    await local();
    await exportDocuments(member.id, [exportMetadata()]);
    await exportDocuments(admin.id, [exportMetadata()]);
    await work();
    expect((await paperlessRepo.job("local"))?.state).toBe("processing");
    expect(requests.filter((call) => call.url.includes("post_document"))).toHaveLength(1);
    expect(requests.find((call) => call.url.includes("post_document"))?.token).toBe(
      "Token member-token",
    );
    const form = requests.find((call) => call.url.includes("post_document"))?.options
      .body as FormData;
    expect(form.get("title")).toBe("Reviewed title");
    expect(form.get("created")).toBe("2026-10-15T00:00:00Z");
    await work();
    expect((await paperlessRepo.job("local"))?.state).toBe("linked");
    expect(await importDocument(admin.id, 42)).toMatchObject({
      documentId: "local",
      duplicate: true,
    });
    expect((await documentStates(member.id))[0]).toMatchObject({
      link: {
        remoteId: 42,
        direction: "export",
        url: "https://archive.example.test/documents/42/details",
      },
      verification: { state: "verified" },
    });
  });

  it("never blindly replays uncertain submissions and requires content-verified reconciliation", async () => {
    await local();
    submit = "timeout";
    await exportDocuments(member.id, [exportMetadata()]);
    await work();
    expect((await paperlessRepo.job("local"))?.state).toBe("unknown");
    await work();
    await exportDocuments(admin.id, [exportMetadata()]);
    await work();
    expect(requests.filter((call) => call.url.includes("post_document"))).toHaveLength(1);
    await expect(repo.remove("documents", "local")).rejects.toThrow("active_transfer");
    const base = (await repo.getAll()).documents[0]!;
    await expect(
      repo.applySyncChange(member.id, {
        id: randomUUID(),
        table: "documents",
        action: "delete",
        rowId: "local",
        base,
        row: null,
      }),
    ).rejects.toThrow("active_transfer");
    await expect(
      reconcile(admin, {
        documentId: "local",
        action: "link",
        remoteId: 42,
        confirmDuplicateRisk: false,
      }),
    ).rejects.toThrow("not_owner");
    original = new TextEncoder().encode("different original");
    await expect(
      reconcile(member, {
        documentId: "local",
        action: "link",
        remoteId: 42,
        confirmDuplicateRisk: false,
      }),
    ).rejects.toThrow("content_mismatch");
    original = bytes;
    await reconcile(member, {
      documentId: "local",
      action: "link",
      remoteId: 42,
      confirmDuplicateRisk: false,
    });
    expect((await paperlessRepo.job("local"))?.state).toBe("linked");
    expect(requests.filter((call) => call.url.includes("post_document"))).toHaveLength(1);
  });

  it("treats a definitive permission rejection as failed, never borrows another user's token", async () => {
    await local();
    submit = "reject";
    await exportDocuments(member.id, [exportMetadata()]);
    await work();
    expect((await paperlessRepo.job("local"))?.state).toBe("failed");
    expect((await documentStates(admin.id))[0]?.job).toMatchObject({ own: false, error: null });
    await expect(
      reconcile(member, { documentId: "local", action: "retry", confirmDuplicateRisk: false }),
    ).rejects.toThrow("confirmation_required");
    await work();
    expect(requests.filter((call) => call.url.includes("post_document"))).toHaveLength(1);
  });

  it("does not infer duplicate identity from task error prose", async () => {
    await local();
    await exportDocuments(member.id, [exportMetadata()]);
    await work();
    remoteStatus = "FAILURE";
    await work();
    expect(await paperlessRepo.job("local")).toMatchObject({
      state: "unknown",
      error: "duplicate",
    });
    expect(await paperlessRepo.link("local")).toBeUndefined();
  });

  it("returns independently persisted progress for mixed batches and blocks unsynchronized selections before claiming", async () => {
    await local("one");
    await local("two");
    await repo.update("documents", "two", { mime_type: "application/octet-stream" });
    await expect(
      exportDocuments(member.id, [exportMetadata("one"), exportMetadata("offline-only")]),
    ).rejects.toThrow("document_missing");
    expect(await paperlessRepo.job("one")).toBeUndefined();
    await exportDocuments(member.id, [exportMetadata("one"), exportMetadata("two")]);
    await work();
    const statuses = await documentStates(member.id);
    expect(statuses.find((state) => state.documentId === "one")?.job?.state).toBe("processing");
    expect(statuses.find((state) => state.documentId === "two")?.job).toMatchObject({
      state: "failed",
      error: "unsupported_type",
    });
    expect(requests.filter((call) => call.url.includes("post_document"))).toHaveLength(1);
  });

  it("refuses a second shared mapping for the same source and stops paused tracking only after explicit warning confirmation", async () => {
    const imported = await importDocument(member.id, 42);
    await local();
    const config = (await paperlessRepo.config())!;
    await expect(
      paperlessRepo.linkDocument({
        document_id: "local",
        instance_id: config.instance_id,
        remote_id: 42,
        direction: "export",
        linked_at: new Date().toISOString(),
        checksum: hash,
      }),
    ).rejects.toThrow("source_conflict");
    expect((await paperlessRepo.source(config.instance_id, 42))?.document_id).toBe(
      imported.documentId,
    );
    await exportDocuments(member.id, [exportMetadata()]);
    await expect(
      reconcile(member, { documentId: "local", action: "abandon", confirmDuplicateRisk: false }),
    ).rejects.toThrow("confirmation_required");
    await reconcile(member, { documentId: "local", action: "abandon", confirmDuplicateRisk: true });
    await work();
    expect(requests.filter((call) => call.url.includes("post_document"))).toHaveLength(0);
    await repo.remove("documents", "local");
    expect(await paperlessRepo.job("local")).toBeUndefined();
  });

  it("does not let an old worker complete a link after tracking is paused", async () => {
    await local();
    await exportDocuments(member.id, [exportMetadata()]);
    await work();
    const job = (await paperlessRepo.job("local"))!;
    await paperlessRepo.transition(job.id, "processing", "paused", { error: "restored" });
    await expect(
      paperlessRepo.linkDocument(
        {
          document_id: "local",
          instance_id: job.instance_id,
          remote_id: 42,
          direction: "export",
          linked_at: new Date().toISOString(),
          checksum: hash,
        },
        job.id,
        "processing",
      ),
    ).rejects.toThrow("job_changed");
    expect(await paperlessRepo.link("local")).toBeUndefined();
  });

  it("allows a new explicit upload only after tracking abandonment acknowledged the duplicate risk", async () => {
    await local();
    submit = "timeout";
    await exportDocuments(member.id, [exportMetadata()]);
    await work();
    const oldJobId = (await paperlessRepo.job("local"))!.id;
    await reconcile(member, { documentId: "local", action: "abandon", confirmDuplicateRisk: true });
    submit = "ok";
    await exportDocuments(admin.id, [exportMetadata()]);
    await work();
    const newJob = (await paperlessRepo.job("local"))!;
    expect(newJob.id).not.toBe(oldJobId);
    expect(newJob).toMatchObject({ state: "processing", user_id: admin.id });
    expect(requests.filter((call) => call.url.includes("post_document"))).toHaveLength(2);
  });

  it("keeps per-user inaccessible verification private while retaining the shared link and last good check", async () => {
    await importDocument(member.id, 42);
    const id = (await repo.getAll()).documents[0]!.id;
    await verifyDocuments(member.id, [id]);
    inaccessible = true;
    await verifyDocuments(admin.id, [id]);
    expect((await documentStates(member.id))[0]?.verification?.state).toBe("verified");
    expect((await documentStates(admin.id))[0]).toMatchObject({
      verification: { state: "inaccessible", lastVerifiedAt: null },
      link: { remoteId: 42 },
    });
    await verifyDocuments(member.id, [id]);
    expect((await documentStates(member.id))[0]?.verification?.lastVerifiedAt).not.toBeNull();
    await exportDocuments(admin.id, [exportMetadata(id)]);
    await work();
    expect(requests.filter((call) => call.url.includes("post_document"))).toHaveLength(0);
  });

  it("pauses on disconnect and instance changes; accepted task IDs survive a concurrent disconnect", async () => {
    await local();
    await exportDocuments(member.id, [exportMetadata()]);
    await work();
    await disconnect(member.id);
    expect(await paperlessRepo.job("local")).toMatchObject({ state: "paused", task_id: taskId });
    await work();
    expect(await paperlessRepo.link("local")).toBeUndefined();
    const stableInstanceId = (await settingsView(member)).instanceId;
    await saveSettings(admin, {
      enabled: true,
      apiUrl: "http://paperless.internal:8000",
      publicUrl: "https://public-link.example.test",
    });
    expect((await settingsView(member)).instanceId).toBe(stableInstanceId);
    await connect(member, "replacement-token");
    await reconcile(member, { documentId: "local", action: "check", confirmDuplicateRisk: false });
    expect((await paperlessRepo.job("local"))?.state).toBe("linked");
    await saveSettings(admin, {
      enabled: true,
      apiUrl: "http://new-paperless.internal",
      publicUrl: "https://new-archive.example.test",
    });
    expect((await settingsView(member)).connected).toBe(false);
    expect((await settingsView(member)).instanceId).not.toBe(stableInstanceId);
    expect((await documentStates(member.id))[0]?.link?.url).toBe(
      "https://public-link.example.test/documents/42/details",
    );
  });

  it("retains links/files and paused transfer identity in backups, never tokens or automatic replay", async () => {
    await importDocument(member.id, 42);
    const importedId = (await repo.getAll()).documents[0]!.id;
    await local();
    await exportDocuments(member.id, [exportMetadata()]);
    await work();
    const archive = await createBackup(repo);
    const parsed = parseBackup(archive);
    expect(JSON.stringify(parsed.database)).not.toContain("ciphertext");
    expect(JSON.stringify(parsed.database)).not.toContain("member-token");
    expect(parsed.database.paperless?.jobs[0]).toMatchObject({ state: "paused", task_id: taskId });
    await restoreBackup(repo, archive);
    expect((await paperlessRepo.link(importedId))?.remote_id).toBe(42);
    expect((await settingsView(member)).connected).toBe(false);
    requests.length = 0;
    await work();
    expect(requests).toHaveLength(0);
    await connect(member, "reconnected-token");
    await work();
    expect(requests.filter((call) => call.url.includes("post_document"))).toHaveLength(0);
    expect((await paperlessRepo.job("local"))?.state).toBe("paused");
  });

  it("marks crash-interrupted submission unknown, preserves persistent original checksum and cleans private user state", async () => {
    await local();
    const config = (await paperlessRepo.config())!;
    await paperlessRepo.claim("local", member.id, config.instance_id, exportMetadata());
    const job = (await paperlessRepo.job("local"))!;
    await paperlessRepo.transition(job.id, "queued", "transferring", { checksum: hash });
    await paperlessRepo.accepted(job.id, taskId);
    await paperlessRepo.transition(job.id, "processing", "transferring");
    await work();
    expect(await paperlessRepo.job("local")).toMatchObject({ state: "unknown", checksum: hash });
    await paperlessRepo.transition(job.id, "unknown", "processing");
    const { deleteUser } = await import("./local-auth");
    await deleteUser(member.id);
    expect(await paperlessRepo.job("local")).toMatchObject({
      user_id: null,
      state: "paused",
      error: "account_deleted",
    });
    expect(await paperlessRepo.credential(member.id, config.instance_id)).toBeUndefined();
    expect((await documentStates(admin.id))[0]?.job).toMatchObject({
      own: false,
      canAbandon: true,
      canResolve: false,
      error: null,
    });
    await reconcile(admin, { documentId: "local", action: "abandon", confirmDuplicateRisk: true });
    await repo.remove("documents", "local");
    expect(await paperlessRepo.job("local")).toBeUndefined();
  });
});

describe("tag-based automatic imports", () => {
  async function enable() {
    autoTag = true;
    await saveAutoImport(member.id, { tagId: 11, confirmSharing: true });
    requests.length = 0;
  }
  function due() {
    db.exec("UPDATE app_paperless_auto_import SET next_run='2000-01-01T00:00:00Z'");
  }

  it("requires explicit sharing consent and an existing authorized tag", async () => {
    autoTag = true;
    await expect(saveAutoImport(member.id, { tagId: 11, confirmSharing: false })).rejects.toThrow(
      "confirmation_required",
    );
    await expect(saveAutoImport(member.id, { tagId: 12, confirmSharing: true })).rejects.toThrow(
      "invalid_metadata",
    );
    await expect(saveAutoImport("pending", { tagId: 11, confirmSharing: true })).rejects.toThrow(
      "unauthorized",
    );
    expect(await autoImportSettings(member.id)).toBeNull();
  });

  it("imports existing and later tagged files without financial entries, using only the owner's token", async () => {
    await enable();
    await processAutoImports();
    let workspace = await repo.getAll();
    expect(workspace.documents).toHaveLength(1);
    expect(workspace.offers).toHaveLength(0);
    expect(workspace.expenses).toHaveLength(0);
    expect(await autoImportSettings(member.id)).toMatchObject({
      imported: 1,
      skipped: 0,
      failed: 0,
      error: null,
    });
    expect(await autoImportSettings(admin.id)).toBeNull();
    expect(requests.every((call) => call.token === "Token member-token")).toBe(true);
    expect(requests.some((call) => call.url.includes("tags__id__all=11"))).toBe(true);
    expect(requests.some((call) => call.options.method === "POST")).toBe(false);
    requests.length = 0;
    await processAutoImports();
    expect(requests).toHaveLength(0);
    due();
    await processAutoImports();
    expect(await autoImportSettings(member.id)).toMatchObject({ imported: 0, skipped: 1 });
    expect(requests.some((call) => call.url.includes("/download/"))).toBe(false);
    remoteId = 43;
    original = new TextEncoder().encode("%PDF-1.7\nAnother invoice\n");
    due();
    await processAutoImports();
    workspace = await repo.getAll();
    expect(workspace.documents).toHaveLength(2);
    expect(await autoImportSettings(member.id)).toMatchObject({ imported: 1, failed: 0 });
  });

  it("runs due imports through the server worker on startup", async () => {
    await enable();
    await startPaperless();
    await vi.waitFor(async () => {
      expect((await autoImportSettings(member.id))?.lastRun).not.toBeNull();
      expect((await repo.getAll()).documents).toHaveLength(1);
    });
    await stopPaperless();
  });

  it("reuses identical local content and preserves its fields instead of creating duplicates", async () => {
    await local();
    await repo.update("documents", "local", { name: "Reviewed title", category: "Plan" });
    const filesBefore = readdirSync(join(directory, "uploads")).length;
    await enable();
    await processAutoImports();
    const config = (await paperlessRepo.config())!;
    expect((await paperlessRepo.source(config.instance_id, 42))?.document_id).toBe("local");
    expect((await repo.getAll()).documents).toHaveLength(1);
    expect(await paperlessRepo.document("local")).toMatchObject({
      name: "Reviewed title",
      category: "Plan",
    });
    expect(readdirSync(join(directory, "uploads"))).toHaveLength(filesBefore);
    expect(await autoImportSettings(member.id)).toMatchObject({ skipped: 1, imported: 0 });
    remoteId = 43;
    due();
    await processAutoImports();
    expect((await repo.getAll()).documents).toHaveLength(1);
    expect((await paperlessRepo.link("local"))?.remote_id).toBe(42);
  });

  it("prevents concurrent imports of different remote IDs with identical originals", async () => {
    const results = await Promise.all([
      importDocument(member.id, 42),
      importDocument(admin.id, 43),
    ]);
    expect(results.map((result) => result.duplicate).sort()).toEqual([false, true]);
    expect(results[0]?.documentId).toBe(results[1]?.documentId);
    expect((await repo.getAll()).documents).toHaveLength(1);
  });

  it("does not mistake a same-size different original for a duplicate", async () => {
    await local();
    original = new TextEncoder().encode(
      new TextDecoder().decode(bytes).replace("Invoice", "Another"),
    );
    expect(original.length).toBe(bytes.length);
    await enable();
    await processAutoImports();
    expect((await repo.getAll()).documents).toHaveLength(2);
    expect(await autoImportSettings(member.id)).toMatchObject({ imported: 1, skipped: 0 });
  });

  it("does not process a revoked member's rule", async () => {
    await enable();
    db.prepare("UPDATE app_users SET role='pending' WHERE id=?").run(member.id);
    await processAutoImports();
    expect(requests).toHaveLength(0);
    await expect(autoImportSettings(member.id)).rejects.toThrow("unauthorized");
    expect((await repo.getAll()).documents).toHaveLength(0);
  });

  it("removes the rule when its owner is deleted", async () => {
    await enable();
    await paperlessRepo.disconnect(member.id, true);
    expect(await paperlessRepo.autoImport(member.id)).toBeUndefined();
  });

  it("resumes bounded pages and starts the next complete scan at page one", async () => {
    await enable();
    tagNext = true;
    await processAutoImports();
    expect((await paperlessRepo.autoImport(member.id))?.page).toBe(2);
    tagNext = false;
    due();
    requests.length = 0;
    await processAutoImports();
    expect(requests.some((call) => call.url.includes("ordering=id&page=2&page_size=25"))).toBe(
      true,
    );
    expect((await paperlessRepo.autoImport(member.id))?.page).toBe(1);
  });

  it("leases a rule once, recovers expired leases, and invalidates leases when disabled", async () => {
    await enable();
    const rule = await paperlessRepo.claimAutoImport();
    expect(rule).toBeDefined();
    expect(await paperlessRepo.claimAutoImport()).toBeUndefined();
    db.exec("UPDATE app_paperless_auto_import SET lease_until='2000-01-01T00:00:00Z'");
    const recovered = await paperlessRepo.claimAutoImport();
    expect(recovered).toBeDefined();
    await saveAutoImport(member.id, { tagId: null, confirmSharing: false });
    expect(await paperlessRepo.autoImportCurrent(recovered!)).toBe(false);
    expect(await autoImportSettings(member.id)).toBeNull();
  });

  it("cannot commit an in-flight automatic import after its rule was disabled", async () => {
    await enable();
    const rule = (await paperlessRepo.claimAutoImport())!;
    const commit = paperlessRepo.importDocument;
    const spy = vi.spyOn(paperlessRepo, "importDocument").mockImplementation(async (...args) => {
      await saveAutoImport(member.id, { tagId: null, confirmSharing: false });
      return commit(...args);
    });
    try {
      await expect(importDocument(member.id, 42, rule)).rejects.toThrow("configuration_changed");
      expect((await repo.getAll()).documents).toHaveLength(0);
    } finally {
      spy.mockRestore();
    }
  });

  it("pauses without a connection or enabled instance and removes rules on disconnect or instance change", async () => {
    await enable();
    const config = (await paperlessRepo.config())!;
    await paperlessRepo.configure({ ...config, enabled: 0 });
    await processAutoImports();
    expect(requests).toHaveLength(0);
    await paperlessRepo.configure({ ...config, enabled: 1 });
    await disconnect(member.id);
    expect(await autoImportSettings(member.id)).toBeNull();
    await connect(member, "member-token");
    await enable();
    await paperlessRepo.configure({ ...config, instance_id: "new-instance" });
    expect(await autoImportSettings(member.id)).toBeNull();
  });

  it("reports failed downloads and retries on later passes without duplicate entries", async () => {
    await enable();
    originalMissing = true;
    await processAutoImports();
    expect(await autoImportSettings(member.id)).toMatchObject({ failed: 1, error: "not_found" });
    expect((await repo.getAll()).documents).toHaveLength(0);
    originalMissing = false;
    due();
    await processAutoImports();
    expect(await autoImportSettings(member.id)).toMatchObject({ imported: 1, error: null });
  });

  it("does not import files when their tag no longer matches", async () => {
    await enable();
    const rule = (await paperlessRepo.claimAutoImport())!;
    autoTag = false;
    await expect(importDocument(member.id, 42, rule)).rejects.toThrow("tag_removed");
    expect((await repo.getAll()).documents).toHaveLength(0);
  });

  it("excludes personal rules from backups and disables them on restore", async () => {
    await enable();
    const backup = await repo.exportBackup();
    expect(JSON.stringify(backup.database)).not.toContain("app_paperless_auto_import");
    await repo.restoreBackup(backup.database, backup.files);
    expect(await autoImportSettings(member.id)).toBeNull();
  });
});

describe("Paperless HTTP boundary", () => {
  it("enforces the automatic import page size instead of processing unbounded responses", async () => {
    const client = new PaperlessClient(
      "https://archive.example.test",
      "secret",
      vi.fn(async () =>
        json({
          count: 26,
          next: null,
          results: Array.from({ length: 26 }, (_, index) => detail(index + 1)),
        }),
      ),
    );
    await expect(client.tagged(11, 1)).rejects.toThrow("incompatible_api");
  });
  it("permits explicitly configured LAN destinations but rejects unsafe protocols, credentials and redirects", async () => {
    expect(normalizePaperlessUrl("http://paperless:8000/")).toBe("http://paperless:8000");
    for (const value of [
      "file:///etc/passwd",
      "https://user:token@example.test",
      "https://example.test?token=x",
      "https://example.test/#x",
    ])
      expect(() => normalizePaperlessUrl(value)).toThrow("invalid_url");
    const transport = vi.fn(async (_url: string | URL | Request, options?: RequestInit) => {
      expect(options?.redirect).toBe("error");
      throw new TypeError("redirect rejected");
    });
    const client = new PaperlessClient("http://paperless:8000", "private-token", transport);
    await expect(client.detail(1)).rejects.toThrow("unavailable");
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it.each([
    "http://archive.example.test/archive/api/tags/?page=2",
    "http://paperless:8000/api/tags/?page=2",
    "https://attacker.example/api/tags/?page=2",
    "//attacker.example/api/tags/?page=2",
    "/api/tags/?page=2",
  ])(
    "paginates only on the configured server regardless of advertised next URL %s",
    async (next) => {
      const transport = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(json({ count: 101, next, results: [{ id: 1, name: "First page" }] }))
        .mockResolvedValueOnce(
          json({ count: 101, next: null, results: [{ id: 2, name: "Second page" }] }),
        );
      const client = new PaperlessClient(
        "https://archive.example.test/archive",
        "secret",
        transport,
      );
      expect(await client.names("tags")).toEqual([
        { id: 1, name: "First page" },
        { id: 2, name: "Second page" },
      ]);
      expect(transport.mock.calls.map(([url]) => url)).toEqual([
        "https://archive.example.test/archive/api/tags/?page=1&page_size=100",
        "https://archive.example.test/archive/api/tags/?page=2&page_size=100",
      ]);
      for (const [, options] of transport.mock.calls) {
        expect(options?.headers).toMatchObject({ Authorization: "Token secret" });
        expect(options?.redirect).toBe("error");
      }
    },
  );
  it("bounds metadata pagination even if the server never ends the list", async () => {
    const transport = vi.fn(async () =>
      json({ count: 2001, next: "http://paperless:8000/api/tags/?page=2", results: [] }),
    );
    const client = new PaperlessClient("https://archive.example.test", "secret", transport);
    await expect(client.names("tags")).rejects.toThrow("metadata_limit");
    expect(transport).toHaveBeenCalledTimes(20);
  });
  it("rejects malformed schemas and oversized response bodies", async () => {
    const invalid = new PaperlessClient(
      "http://paperless:8000",
      "secret",
      vi.fn(async () => json({ nonsense: [] })),
    );
    await expect(invalid.detail(1)).rejects.toThrow("incompatible_api");
    const large = new PaperlessClient(
      "http://paperless:8000",
      "secret",
      vi.fn(async () => new Response("x", { headers: { "content-length": "999999999" } })),
    );
    await expect(large.detail(1)).rejects.toThrow("response_too_large");
  });
  it("proxies authorized preview bytes and reports permission, rate and API-version errors explicitly", async () => {
    const preview = new PaperlessClient(
      "http://paperless:8000",
      "own-token",
      vi.fn(async (_url, options) => {
        expect((options?.headers as Record<string, string>)["Authorization"]).toBe(
          "Token own-token",
        );
        return new Response(bytes, { headers: { "content-type": "application/pdf" } });
      }),
    );
    expect(await preview.preview(42)).toEqual({
      base64: Buffer.from(bytes).toString("base64"),
      mime: "application/pdf",
    });
    for (const [status, code] of [
      [401, "unauthorized"],
      [403, "forbidden"],
      [406, "incompatible_api"],
      [429, "rate_limited"],
    ] as const) {
      const rejected = new PaperlessClient(
        "http://paperless:8000",
        "own-token",
        vi.fn(async () => json({}, status)),
      );
      await expect(rejected.detail(1)).rejects.toThrow(`paperless.errors.${code}`);
    }
  });
});
