import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";
import { MAX_UPLOAD_BYTES } from "@/lib/limits";
import type {
  PaperlessExportMetadata,
  PaperlessRemoteDocument,
  PaperlessSearch,
} from "@/lib/paperless";

export class PaperlessError extends Error {
  constructor(
    public readonly code: string,
    public readonly status?: number,
  ) {
    super(`paperless.errors.${code}`);
  }
}

export function normalizePaperlessUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PaperlessError("invalid_url");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new PaperlessError("invalid_url");
  return url.href.replace(/\/+$/, "");
}

function settingsKey() {
  const value = process.env["PAPERLESS_SETTINGS_KEY"];
  if (!value || !/^[0-9a-f]{64}$/i.test(value)) throw new PaperlessError("encryption_key");
  return Buffer.from(value, "hex");
}
export function encryptionReady() {
  return /^[0-9a-f]{64}$/i.test(process.env["PAPERLESS_SETTINGS_KEY"] ?? "");
}
export function encryptToken(token: string, userId: string, instanceId: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", settingsKey(), iv);
  cipher.setAAD(Buffer.from(`${userId}:${instanceId}`));
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64")).join(".");
}
export function decryptToken(value: string, userId: string, instanceId: string) {
  const parts = value.split(".");
  if (parts.length !== 3) throw new PaperlessError("credentials_invalid");
  const key = settingsKey();
  try {
    const [iv, tag, bytes] = parts.map((part) => Buffer.from(part, "base64"));
    const decipher = createDecipheriv("aes-256-gcm", key, iv!);
    decipher.setAAD(Buffer.from(`${userId}:${instanceId}`));
    decipher.setAuthTag(tag!);
    return Buffer.concat([decipher.update(bytes!), decipher.final()]).toString("utf8");
  } catch {
    throw new PaperlessError("credentials_invalid");
  }
}

const remoteSchema = z.object({
  id: z.number().int().positive(),
  title: z.string(),
  created: z.string().nullable().optional(),
  tags: z.array(z.number().int().positive()).default([]),
  correspondent: z.number().int().positive().nullable().optional(),
  document_type: z.number().int().positive().nullable().optional(),
  original_file_name: z.string().nullable().optional(),
  content: z.string().nullable().optional(),
});
export type RemoteDetail = z.infer<typeof remoteSchema>;
export function remoteView(document: RemoteDetail): PaperlessRemoteDocument {
  return {
    id: document.id,
    title: document.title,
    created: document.created ?? null,
    tags: document.tags,
    correspondent: document.correspondent ?? null,
    documentType: document.document_type ?? null,
    originalFileName: document.original_file_name ?? null,
  };
}
const namedSchema = z.object({ id: z.number().int().positive(), name: z.string() });
const envelope = z.object({
  count: z.number().int().nonnegative(),
  next: z.string().nullable(),
  results: z.array(z.unknown()),
});
const MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/tiff",
  "image/webp",
  "image/gif",
  "text/plain",
  "application/xml",
  "text/xml",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.oasis.opendocument.spreadsheet",
]);

export function supportedPaperlessMime(mime: string) {
  if (!MIME_TYPES.has(mime)) throw new PaperlessError("unsupported_type");
}

export class PaperlessClient {
  private readonly deadline = Date.now() + 60_000;
  constructor(
    readonly baseUrl: string,
    private readonly token: string,
    private readonly request: typeof fetch = fetch,
  ) {}

  private async bytes(path: string, options: RequestInit = {}, maxBytes = 8 * 1024 * 1024) {
    if (!path.startsWith("api/") || path.includes("..") || path.includes("://"))
      throw new PaperlessError("invalid_endpoint");
    const remaining = this.deadline - Date.now();
    if (remaining <= 0) throw new PaperlessError("timeout");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.min(30_000, remaining));
    try {
      let response: Response;
      try {
        response = await this.request(`${this.baseUrl}/${path}`, {
          ...options,
          redirect: "error",
          signal: controller.signal,
          headers: {
            ...options.headers,
            Authorization: `Token ${this.token}`,
            Accept: "application/json; version=9",
          },
        });
      } catch {
        throw new PaperlessError(controller.signal.aborted ? "timeout" : "unavailable");
      }
      if (!response.ok) {
        const code =
          response.status === 401
            ? "unauthorized"
            : response.status === 403
              ? "forbidden"
              : response.status === 404
                ? "not_found"
                : response.status === 406
                  ? "incompatible_api"
                  : response.status === 429
                    ? "rate_limited"
                    : "remote_error";
        await response.body?.cancel();
        throw new PaperlessError(code, response.status);
      }
      if (Number(response.headers.get("content-length") ?? 0) > maxBytes) {
        await response.body?.cancel();
        throw new PaperlessError("response_too_large");
      }
      const reader = response.body?.getReader();
      if (!reader) throw new PaperlessError("invalid_response");
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          await reader.cancel();
          throw new PaperlessError("response_too_large");
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return { bytes, response };
    } catch (error) {
      if (error instanceof PaperlessError) throw error;
      throw new PaperlessError(controller.signal.aborted ? "timeout" : "invalid_response");
    } finally {
      clearTimeout(timeout);
    }
  }

  private async json(path: string, options?: RequestInit): Promise<unknown> {
    const { bytes } = await this.bytes(path, options);
    try {
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new PaperlessError("invalid_response");
    }
  }
  private parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.output<T> {
    const result = schema.safeParse(value);
    if (!result.success) throw new PaperlessError("incompatible_api");
    return result.data;
  }
  async search(input: PaperlessSearch) {
    const query = new URLSearchParams({
      page: String(input.page),
      page_size: "25",
      ordering: "-created",
    });
    if (input.query) query.set("query", input.query);
    if (input.tags.length) query.set("tags__id__all", input.tags.join(","));
    if (input.documentType) query.set("document_type__id", String(input.documentType));
    if (input.correspondent) query.set("correspondent__id", String(input.correspondent));
    if (input.dateFrom) query.set("created__date__gte", input.dateFrom);
    if (input.dateTo) query.set("created__date__lte", input.dateTo);
    const data = this.parse(envelope, await this.json(`api/documents/?${query}`));
    return {
      count: data.count,
      results: data.results.map((item) => remoteView(this.parse(remoteSchema, item))),
      page: input.page,
      pageSize: 25,
    };
  }
  async detail(id: number) {
    return this.parse(remoteSchema, await this.json(`api/documents/${id}/`));
  }
  async tagged(tagId: number, page: number) {
    const query = new URLSearchParams({
      tags__id__all: String(tagId),
      ordering: "id",
      page: String(page),
      page_size: "25",
    });
    const data = this.parse(
      envelope.extend({ results: z.array(remoteSchema).max(25) }),
      await this.json(`api/documents/?${query}`),
    );
    return {
      documents: data.results.map(remoteView),
      hasNext: Boolean(data.next),
    };
  }
  async names(kind: "tags" | "document_types" | "correspondents") {
    const results: z.infer<typeof namedSchema>[] = [];
    for (let page = 1; page <= 20; page++) {
      const data = this.parse(envelope, await this.json(`api/${kind}/?page=${page}&page_size=100`));
      results.push(...data.results.map((item) => this.parse(namedSchema, item)));
      if (!data.next) return results;
      // Use next only as a continuation flag: proxies may advertise an internal URL.
      // Every page is requested from the configured base, never the supplied destination.
    }
    throw new PaperlessError("metadata_limit");
  }
  async original(id: number) {
    const { bytes, response } = await this.bytes(
      `api/documents/${id}/download/?original=true`,
      {},
      MAX_UPLOAD_BYTES,
    );
    const mime = (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    supportedPaperlessMime(mime);
    if (!bytes.length) throw new PaperlessError("file_missing");
    return { bytes, mime };
  }
  async preview(id: number) {
    const { bytes, response } = await this.bytes(
      `api/documents/${id}/preview/`,
      {},
      12 * 1024 * 1024,
    );
    const mime = (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    if (!["application/pdf", "image/png", "image/jpeg", "image/webp"].includes(mime))
      throw new PaperlessError("unsupported_type");
    return { base64: Buffer.from(bytes).toString("base64"), mime };
  }
  async upload(bytes: Uint8Array, name: string, mime: string, metadata: PaperlessExportMetadata) {
    supportedPaperlessMime(mime);
    if (!bytes.length || bytes.length > MAX_UPLOAD_BYTES) throw new PaperlessError("file_size");
    const form = new FormData();
    form.append("document", new Blob([new Uint8Array(bytes)], { type: mime }), name);
    form.append("title", metadata.title);
    if (metadata.documentDate) form.append("created", `${metadata.documentDate}T00:00:00Z`);
    for (const tag of metadata.tags) form.append("tags", String(tag));
    if (metadata.documentType) form.append("document_type", String(metadata.documentType));
    if (metadata.correspondent) form.append("correspondent", String(metadata.correspondent));
    const result = await this.json("api/documents/post_document/", { method: "POST", body: form });
    if (typeof result !== "string" || !z.string().uuid().safeParse(result).success)
      throw new PaperlessError("submission_unknown");
    return result;
  }
  async task(taskId: string) {
    const data = this.parse(
      z.array(
        z.object({
          task_id: z.string(),
          status: z.string(),
          related_document: z.union([z.number(), z.string()]).nullable().optional(),
          result: z.string().nullable().optional(),
        }),
      ),
      await this.json(`api/tasks/?task_id=${encodeURIComponent(taskId)}`),
    );
    const task = data.find((item) => item.task_id === taskId);
    if (!task) return { state: "processing" as const };
    if (task.status === "SUCCESS") {
      const id = Number(task.related_document);
      if (!Number.isSafeInteger(id) || id <= 0) throw new PaperlessError("unresolved_task");
      return { state: "success" as const, remoteId: id };
    }
    if (task.status === "FAILURE") {
      // Duplicate task messages are not an identity proof; never parse prose into an auto-link.
      return {
        state: "failed" as const,
        error: /duplicate|already exists/i.test(task.result ?? "")
          ? "duplicate"
          : "processing_failed",
      };
    }
    return { state: "processing" as const };
  }
}
