import { createHash } from "node:crypto";
import type {
  PaperlessDocumentState,
  PaperlessExportMetadata,
  PaperlessImportResult,
  PaperlessSearch,
  PaperlessSettings,
  PaperlessSettingsView,
  PaperlessAutoImportInput,
  PaperlessAutoImportView,
} from "@/lib/paperless";
import { paperlessExportMetadataSchema } from "@/lib/paperless";
import { extractFromText } from "@/lib/ocr-parse";
import { MAX_UPLOAD_BYTES } from "@/lib/limits";
import { paperlessRepo, sqliteRepo, type PaperlessJob, type PaperlessAutoImportRule } from "./repo";
import {
  decryptToken,
  encryptToken,
  encryptionReady,
  normalizePaperlessUrl,
  PaperlessClient,
  PaperlessError,
  supportedPaperlessMime,
} from "./paperless-client";

type Actor = { id: string; role: string };
const checksum = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const now = () => new Date().toISOString();
const DOCUMENT_CATEGORIES = {
  angebot: "Angebot",
  rechnung: "Rechnung",
  kassenzettel: "Beleg",
  vertrag: "Vertrag",
  plan: "Plan",
  datenblatt: "Datenblatt",
  foto: "Foto",
  sonstiges: "Sonstiges",
} as const;

async function connection(userId: string) {
  if (!(await paperlessRepo.allowed(userId))) throw new PaperlessError("unauthorized");
  const config = await paperlessRepo.config();
  if (!config?.enabled) throw new PaperlessError("disabled");
  const encrypted = await paperlessRepo.credential(userId, config.instance_id);
  if (!encrypted) throw new PaperlessError("not_connected");
  return {
    config,
    client: new PaperlessClient(
      config.api_url,
      decryptToken(encrypted, userId, config.instance_id),
    ),
  };
}
export async function settingsView(user: Actor): Promise<PaperlessSettingsView> {
  const allowed = await paperlessRepo.allowed(user.id);
  if (!allowed)
    return {
      allowed: false,
      instanceId: null,
      enabled: false,
      configured: false,
      encryptionReady: false,
      connected: false,
      browserUrl: null,
      apiUrl: null,
      config: null,
    };
  const config = await paperlessRepo.config();
  return {
    allowed: true,
    instanceId: config?.instance_id ?? null,
    enabled: Boolean(config?.enabled),
    configured: Boolean(config),
    encryptionReady: encryptionReady(),
    connected: Boolean(config && (await paperlessRepo.credential(user.id, config.instance_id))),
    browserUrl: config?.browser_url ?? null,
    apiUrl: user.role === "admin" ? (config?.api_url ?? null) : null,
    config:
      user.role === "admin"
        ? {
            enabled: Boolean(config?.enabled),
            apiUrl: config?.api_url ?? "",
            publicUrl: config?.browser_url ?? "",
          }
        : null,
  };
}
export async function saveSettings(user: Actor, input: PaperlessSettings) {
  if (user.role !== "admin") throw new PaperlessError("unauthorized");
  const previous = await paperlessRepo.config();
  if (!input.enabled && !input.apiUrl.trim()) {
    if (previous) await paperlessRepo.configure({ ...previous, enabled: 0 });
    return settingsView(user);
  }
  const apiUrl = normalizePaperlessUrl(input.apiUrl.trim());
  const browserUrl = normalizePaperlessUrl(input.publicUrl.trim() || apiUrl);
  if (input.enabled && !encryptionReady()) throw new PaperlessError("encryption_key");
  await paperlessRepo.configure({
    id: 1,
    instance_id: previous?.api_url === apiUrl ? previous.instance_id : crypto.randomUUID(),
    enabled: input.enabled ? 1 : 0,
    api_url: apiUrl,
    browser_url: browserUrl,
  });
  return settingsView(user);
}
export async function connect(user: Actor, token: string) {
  if (!(await paperlessRepo.allowed(user.id))) throw new PaperlessError("unauthorized");
  const config = await paperlessRepo.config();
  if (!config?.enabled) throw new PaperlessError("disabled");
  const encrypted = encryptToken(token, user.id, config.instance_id);
  // Validate this user's document access without escalating to another account.
  const client = new PaperlessClient(config.api_url, token);
  await client.search({ query: "", page: 1, tags: [] });
  await paperlessRepo.connect(user.id, config.instance_id, encrypted);
  return settingsView(user);
}
export async function disconnect(userId: string) {
  if (!(await paperlessRepo.allowed(userId))) throw new PaperlessError("unauthorized");
  await paperlessRepo.disconnect(userId);
  return { ok: true as const };
}
export async function search(userId: string, input: PaperlessSearch) {
  return (await connection(userId)).client.search(input);
}
export async function metadata(userId: string) {
  const { client } = await connection(userId);
  const [tags, documentTypes, correspondents] = await Promise.all([
    client.names("tags"),
    client.names("document_types"),
    client.names("correspondents"),
  ]);
  return { tags, documentTypes, correspondents };
}
export async function autoImportSettings(userId: string): Promise<PaperlessAutoImportView> {
  if (!(await paperlessRepo.allowed(userId))) throw new PaperlessError("unauthorized");
  const rule = await paperlessRepo.autoImport(userId);
  return rule
    ? {
        tagId: rule.tag_id,
        lastRun: rule.last_run,
        nextRun: rule.next_run,
        imported: rule.imported,
        skipped: rule.skipped,
        failed: rule.failed,
        error: rule.error,
      }
    : null;
}
export async function importTags(userId: string) {
  return (await connection(userId)).client.names("tags");
}
export async function saveAutoImport(userId: string, input: PaperlessAutoImportInput) {
  if (!(await paperlessRepo.allowed(userId))) throw new PaperlessError("unauthorized");
  if (input.tagId === null) {
    await paperlessRepo.saveAutoImport(userId, null, null);
  } else {
    if (!input.confirmSharing) throw new PaperlessError("confirmation_required");
    const { config, client } = await connection(userId);
    if (!(await client.names("tags")).some((tag) => tag.id === input.tagId))
      throw new PaperlessError("invalid_metadata");
    await paperlessRepo.saveAutoImport(userId, config.instance_id, input.tagId);
    wakePaperless();
  }
  return autoImportSettings(userId);
}
export async function preview(userId: string, remoteId: number) {
  return (await connection(userId)).client.preview(remoteId);
}
export async function importDocument(
  userId: string,
  remoteId: number,
  autoRule?: PaperlessAutoImportRule,
): Promise<PaperlessImportResult> {
  const { config, client } = await connection(userId);
  if (
    autoRule &&
    (autoRule.user_id !== userId ||
      config.instance_id !== autoRule.instance_id ||
      !(await paperlessRepo.autoImportCurrent(autoRule)))
  )
    throw new PaperlessError("configuration_changed");
  // Resolve access with the requesting user even for an already-known project source.
  const remote = await client.detail(remoteId);
  if (autoRule && !remote.tags.includes(autoRule.tag_id)) throw new PaperlessError("tag_removed");
  const existing = await paperlessRepo.source(config.instance_id, remoteId);
  if (existing) {
    await paperlessRepo.check(userId, existing.document_id, "verified");
    return {
      documentId: existing.document_id,
      duplicate: true,
      extraction: null,
      extractionSource: "paperless",
      extractionError: null,
    };
  }
  const file = await client.original(remoteId);
  const repo = sqliteRepo();
  const name = (remote.original_file_name || remote.title || `paperless-${remoteId}`)
    .replace(/[/\\\p{Cc}]/gu, "_")
    .slice(0, 240);
  const storagePath = await repo.putFile(name, file.mime, file.bytes);
  let retained = false;
  let documentId: string;
  try {
    const result = await paperlessRepo.importDocument(
      {
        document_id: crypto.randomUUID(),
        instance_id: config.instance_id,
        remote_id: remoteId,
        direction: "import",
        linked_at: now(),
        checksum: checksum(file.bytes),
      },
      {
        name,
        category: "Sonstiges",
        tags: null,
        description: null,
        storage_path: storagePath,
        mime_type: file.mime,
        size: file.bytes.length,
        trade_id: null,
        task_id: null,
        cost_item_id: null,
      },
      userId,
      autoRule,
    );
    retained = !result.duplicate;
    documentId = result.documentId;
    if (result.duplicate)
      return { ...result, extraction: null, extractionSource: "paperless", extractionError: null };
  } finally {
    if (!retained) await repo.deleteFile(storagePath);
  }
  await paperlessRepo.check(userId, documentId, "verified");
  // Recognition/enrichment is deliberately subsequent to the durable local import.
  // Its explicit warning must never roll back a successfully imported original.
  let extraction: PaperlessImportResult["extraction"] = null;
  let extractionError: PaperlessImportResult["extractionError"] = null;
  const workspace = await repo.getAll();
  try {
    extraction = extractFromText(remote.content ?? "", {
      trades: workspace.trades.map((trade) => trade.name),
      contacts: workspace.contacts.map((contact) => ({
        ...contact,
        trade: workspace.trades.find((trade) => trade.id === contact.trade_id)?.name ?? null,
      })),
    });
  } catch (error) {
    extractionError = "extraction_failed";
    console.error(
      "[paperless] Rule-based extraction failed",
      error instanceof Error ? error.name : "internal_error",
    );
  }
  if (extraction) {
    extraction.title = remote.title || extraction.title;
    extraction.date ||= remote.created?.slice(0, 10) ?? null;
  }
  if (extraction && !extraction.vendor && remote.correspondent) {
    try {
      const correspondent = (await client.names("correspondents")).find(
        (item) => item.id === remote.correspondent,
      );
      if (correspondent) {
        extraction.vendor = correspondent.name;
        const normalized = correspondent.name.trim().toLocaleLowerCase();
        const matches = workspace.contacts.filter((contact) =>
          [contact.name, contact.company].some(
            (name) => name?.trim().toLocaleLowerCase() === normalized,
          ),
        );
        if (matches.length === 1) extraction.contact_id = matches[0]!.id;
      }
    } catch (error) {
      if (!(error instanceof PaperlessError)) throw error;
      extractionError ??= "metadata_unavailable";
    }
  }
  let tags: string[] = [];
  if (remote.tags.length) {
    try {
      tags = (await client.names("tags"))
        .filter((tag) => remote.tags.includes(tag.id))
        .map((tag) => tag.name);
    } catch (error) {
      if (!(error instanceof PaperlessError)) throw error;
      extractionError ??= "metadata_unavailable";
    }
  }
  if (extraction) extraction.tags = [...new Set([...extraction.tags, ...tags])];
  await repo.update("documents", documentId, {
    category: DOCUMENT_CATEGORIES[extraction?.doc_type ?? "sonstiges"],
    tags: tags.length ? tags.join(", ") : null,
  });
  return {
    documentId,
    duplicate: false,
    extraction,
    extractionSource: "paperless",
    extractionError,
  };
}
export async function documentStates(userId: string): Promise<PaperlessDocumentState[]> {
  if (!(await paperlessRepo.allowed(userId))) throw new PaperlessError("unauthorized");
  const [config, rows] = await Promise.all([paperlessRepo.config(), paperlessRepo.states(userId)]);
  const links = new Map(rows.links.map((link) => [link.document_id, link]));
  const jobs = new Map(rows.jobs.map((job) => [job.document_id, job]));
  const checks = new Map(rows.checks.map((check) => [check["document_id"], check]));
  return rows.documents.map((document) => {
    const documentId = String(document["id"]);
    const link = links.get(documentId);
    const job = jobs.get(documentId);
    const check = checks.get(documentId);
    return {
      documentId,
      link: link
        ? {
            remoteId: link.remote_id,
            direction: link.direction,
            linkedAt: link.linked_at,
            url: `${config?.instance_id === link.instance_id ? config.browser_url : link.browser_url}/documents/${link.remote_id}/details`,
          }
        : null,
      job: job
        ? {
            state: job.state,
            updatedAt: job.updated_at,
            error: job.user_id === userId ? job.error : null,
            own: job.user_id === userId,
            canAbandon:
              !["linked", "abandoned"].includes(job.state) &&
              (job.user_id === userId || (!job.user_id && rows.role === "admin")),
            canResolve:
              job.user_id === userId &&
              ["processing", "unknown", "paused", "failed"].includes(job.state),
          }
        : null,
      verification: check
        ? {
            state: check["state"] as "verified" | "inaccessible" | "unknown",
            checkedAt: String(check["checked_at"]),
            lastVerifiedAt: check["last_verified_at"] ? String(check["last_verified_at"]) : null,
          }
        : null,
    };
  });
}
async function requireDocument(documentId: string) {
  const doc = await paperlessRepo.document(documentId);
  if (!doc?.["storage_path"]) throw new PaperlessError("document_missing");
  const mime = String(doc["mime_type"] ?? "");
  supportedPaperlessMime(mime);
  const bytes = await sqliteRepo().readFile(String(doc["storage_path"]));
  if (!bytes) throw new PaperlessError("file_missing");
  if (!bytes.length || bytes.length > MAX_UPLOAD_BYTES) throw new PaperlessError("file_size");
  return { doc, bytes, mime };
}
async function validateMetadata(userId: string, documents: PaperlessExportMetadata[]) {
  if (!documents.some((doc) => doc.tags.length || doc.documentType || doc.correspondent)) return;
  const choices = await metadata(userId);
  for (const doc of documents) {
    if (
      doc.tags.some((id) => !choices.tags.some((tag) => tag.id === id)) ||
      (doc.documentType && !choices.documentTypes.some((type) => type.id === doc.documentType)) ||
      (doc.correspondent && !choices.correspondents.some((item) => item.id === doc.correspondent))
    )
      throw new PaperlessError("invalid_metadata");
  }
}
export async function exportDocuments(userId: string, documents: PaperlessExportMetadata[]) {
  const { config } = await connection(userId);
  await validateMetadata(userId, documents);
  for (const document of documents)
    if (!(await paperlessRepo.document(document.documentId)))
      throw new PaperlessError("document_missing");
  // Claims are per document; an unsupported/missing file becomes an explicit item failure in the worker.
  for (const document of documents)
    await paperlessRepo.claim(document.documentId, userId, config.instance_id, document);
  wakePaperless();
  const selected = new Set(documents.map((doc) => doc.documentId));
  return (await documentStates(userId)).filter((state) => selected.has(state.documentId));
}
export async function verifyDocuments(userId: string, documentIds: string[]) {
  const { config, client } = await connection(userId);
  for (const documentId of documentIds) {
    const link = await paperlessRepo.link(documentId);
    if (!link) continue;
    if (link.instance_id !== config.instance_id) {
      await paperlessRepo.check(userId, documentId, "unknown");
      continue;
    }
    try {
      await client.detail(link.remote_id);
      await paperlessRepo.check(userId, documentId, "verified");
    } catch (error) {
      if (!(error instanceof PaperlessError)) throw error;
      await paperlessRepo.check(
        userId,
        documentId,
        ["not_found", "forbidden", "unauthorized"].includes(error.code)
          ? "inaccessible"
          : "unknown",
      );
    }
  }
  const selected = new Set(documentIds);
  return (await documentStates(userId)).filter((state) => selected.has(state.documentId));
}
export async function reconcile(
  user: Actor,
  input: {
    documentId: string;
    action: "link" | "retry" | "abandon" | "check";
    remoteId?: number | undefined;
    confirmDuplicateRisk: boolean;
  },
) {
  if (!(await paperlessRepo.allowed(user.id))) throw new PaperlessError("unauthorized");
  const job = await paperlessRepo.job(input.documentId);
  if (!job) throw new PaperlessError("job_missing");
  if (
    job.user_id !== user.id &&
    !(input.action === "abandon" && user.role === "admin" && !job.user_id)
  )
    throw new PaperlessError("not_owner");
  if (
    ["linked", "abandoned"].includes(job.state) ||
    (input.action !== "abandon" && ["transferring", "queued"].includes(job.state))
  )
    throw new PaperlessError("job_changed");
  if (input.action === "abandon") {
    if (!input.confirmDuplicateRisk) throw new PaperlessError("confirmation_required");
    if (
      !(await paperlessRepo.transition(job.id, job.state, "abandoned", {
        error: "tracking_abandoned",
      }))
    )
      throw new PaperlessError("job_changed");
  } else {
    const { config, client } = await connection(user.id);
    if (config.instance_id !== job.instance_id) throw new PaperlessError("configuration_changed");
    if (input.action === "link") {
      if (!input.remoteId) throw new PaperlessError("remote_id_required");
      await client.detail(input.remoteId);
      const [original, local] = await Promise.all([
        client.original(input.remoteId),
        requireDocument(input.documentId),
      ]);
      const hash = checksum(local.bytes);
      if (checksum(original.bytes) !== hash) throw new PaperlessError("content_mismatch");
      await paperlessRepo.linkDocument(
        {
          document_id: job.document_id,
          instance_id: job.instance_id,
          remote_id: input.remoteId,
          direction: "export",
          linked_at: now(),
          checksum: hash,
        },
        job.id,
        job.state,
      );
      await paperlessRepo.check(user.id, input.documentId, "verified");
    } else if (input.action === "retry") {
      if (!input.confirmDuplicateRisk) throw new PaperlessError("confirmation_required");
      if (!["failed", "paused", "unknown"].includes(job.state))
        throw new PaperlessError("job_changed");
      const selectedMetadata = paperlessExportMetadataSchema.parse(JSON.parse(job.metadata));
      await validateMetadata(user.id, [selectedMetadata]);
      await paperlessRepo.claim(job.document_id, user.id, job.instance_id, selectedMetadata, true);
      wakePaperless();
    } else {
      if (!job.task_id) throw new PaperlessError("submission_unknown");
      if (job.state === "paused" || job.state === "unknown")
        await paperlessRepo.transition(job.id, job.state, "processing");
      const current = await paperlessRepo.job(input.documentId);
      if (current?.state === "processing") await processJob(current);
    }
  }
  return (await documentStates(user.id)).find((state) => state.documentId === input.documentId)!;
}

async function finishTask(job: PaperlessJob, client: PaperlessClient) {
  if (!job.task_id) throw new PaperlessError("submission_unknown");
  const task = await client.task(job.task_id);
  if (task.state === "failed") {
    await paperlessRepo.transition(
      job.id,
      "processing",
      task.error === "duplicate" ? "unknown" : "failed",
      { error: task.error },
    );
  } else if (task.state === "success") {
    await client.detail(task.remoteId);
    const original = await client.original(task.remoteId);
    if (!job.checksum || checksum(original.bytes) !== job.checksum)
      throw new PaperlessError("content_mismatch");
    await paperlessRepo.linkDocument(
      {
        document_id: job.document_id,
        instance_id: job.instance_id,
        remote_id: task.remoteId,
        direction: "export",
        linked_at: now(),
        checksum: job.checksum,
      },
      job.id,
      "processing",
    );
    if (job.user_id) await paperlessRepo.check(job.user_id, job.document_id, "verified");
  } else if (Date.now() - new Date(job.created_at).getTime() > 15 * 60_000) {
    await paperlessRepo.transition(job.id, "processing", "paused", { error: "processing_timeout" });
  }
}
async function processJob(job: PaperlessJob) {
  try {
    if (!job.user_id) throw new PaperlessError("not_owner");
    const { config, client } = await connection(job.user_id);
    if (config.instance_id !== job.instance_id) throw new PaperlessError("configuration_changed");
    if (job.state === "processing") {
      await finishTask(job, client);
      return;
    }
    const file = await requireDocument(job.document_id);
    const selectedMetadata = paperlessExportMetadataSchema.parse(JSON.parse(job.metadata));
    if (
      !(await paperlessRepo.transition(job.id, "queued", "transferring", {
        checksum: checksum(file.bytes),
      }))
    )
      return;
    let taskId: string;
    try {
      taskId = await client.upload(
        file.bytes,
        String(file.doc["name"]),
        file.mime,
        selectedMetadata,
      );
    } catch (error) {
      // Only a definitive rejection before acceptance permits a safe failed state.
      const rejected =
        error instanceof PaperlessError &&
        error.status !== undefined &&
        error.status < 500 &&
        error.status !== 408;
      await paperlessRepo.transition(job.id, "transferring", rejected ? "failed" : "unknown", {
        error: error instanceof PaperlessError ? error.code : "submission_unknown",
      });
      if (!(error instanceof PaperlessError)) throw error;
      return;
    }
    await paperlessRepo.accepted(job.id, taskId);
  } catch (error) {
    if (!(error instanceof PaperlessError)) {
      await paperlessRepo.transition(job.id, "transferring", "unknown", {
        error: "internal_error",
      });
      await paperlessRepo.transition(
        job.id,
        job.state,
        job.state === "processing" ? "unknown" : "failed",
        { error: "internal_error" },
      );
      throw error;
    }
    const paused = [
      "disabled",
      "not_connected",
      "credentials_invalid",
      "encryption_key",
      "unauthorized",
      "not_owner",
      "configuration_changed",
      "access_revoked",
    ].includes(error.code);
    await paperlessRepo.transition(
      job.id,
      job.state,
      paused ? "paused" : job.state === "processing" ? "unknown" : "failed",
      { error: error.code },
    );
  }
}

export async function processAutoImports() {
  const rule = await paperlessRepo.claimAutoImport();
  if (!rule) return;
  const result = {
    page: rule.page,
    imported: 0,
    skipped: 0,
    failed: 0,
    error: null as string | null,
  };
  try {
    const { client } = await connection(rule.user_id);
    // Validate the tag so a deleted tag cannot silently turn into an unfiltered import.
    if (!(await client.names("tags")).some((tag) => tag.id === rule.tag_id))
      throw new PaperlessError("invalid_metadata");
    const batch = await client.tagged(rule.tag_id, rule.page);
    for (const document of batch.documents) {
      if (!(await paperlessRepo.autoImportCurrent(rule))) return;
      try {
        if (!document.tags.includes(rule.tag_id)) throw new PaperlessError("tag_removed");
        if (await paperlessRepo.source(rule.instance_id, document.id)) {
          result.skipped++;
          continue;
        }
        const imported = await importDocument(rule.user_id, document.id, rule);
        if (imported.duplicate) result.skipped++;
        else {
          result.imported++;
          if (imported.extractionError) result.error = imported.extractionError;
        }
      } catch (error) {
        if (!(error instanceof PaperlessError)) throw error;
        if (error.code === "tag_removed") result.skipped++;
        else {
          result.failed++;
          result.error = error.code;
        }
      }
    }
    result.page = batch.hasNext ? rule.page + 1 : 1;
  } catch (error) {
    result.failed++;
    // A changed remote list may make a saved page invalid; restart the next pass.
    if (error instanceof PaperlessError && error.code === "not_found") result.page = 1;
    result.error = error instanceof PaperlessError ? error.code : "internal_error";
    console.error("[paperless] Automatic import failed", result.error);
  } finally {
    await paperlessRepo.finishAutoImport(rule, result);
  }
}

let running: Promise<void> | null = null;
let closing = false;
export function wakePaperless() {
  if (closing || running) return;
  running = (async () => {
    const jobs = await paperlessRepo.jobs();
    // At most two remote requests in flight. One bounded pass; the server lifecycle wakes again.
    for (let index = 0; index < jobs.length; index += 2)
      await Promise.all(jobs.slice(index, index + 2).map(processJob));
    if (!closing) await processAutoImports();
  })()
    .catch((error: unknown) => {
      console.error(
        "[paperless] Background reconciliation failed",
        error instanceof PaperlessError ? error.code : "internal_error",
      );
    })
    .finally(() => {
      running = null;
    });
}
export async function startPaperless() {
  closing = false;
  await paperlessRepo.recover();
  wakePaperless();
}
export async function stopPaperless() {
  closing = true;
  await running;
}
