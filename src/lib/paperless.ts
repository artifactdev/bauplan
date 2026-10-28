import { z } from "zod";
import type { Extraction } from "./ocr-parse";

const remoteId = z.number().int().positive();
export const paperlessSettingsSchema = z.object({
  enabled: z.boolean(),
  apiUrl: z.string().max(2048),
  publicUrl: z.string().max(2048),
});
export const paperlessSearchSchema = z.object({
  query: z.string().max(500).default(""),
  page: z.number().int().min(1).max(10000).default(1),
  tags: z.array(remoteId).max(50).default([]),
  documentType: remoteId.nullable().optional(),
  correspondent: remoteId.nullable().optional(),
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
});
export const paperlessRemoteSchema = z.object({ remoteId });
export const paperlessExportMetadataSchema = z.object({
  documentId: z.string().min(1).max(200),
  title: z.string().trim().min(1).max(250),
  documentDate: z.string().date().nullable(),
  tags: z.array(remoteId).max(50).default([]),
  documentType: remoteId.nullable().default(null),
  correspondent: remoteId.nullable().default(null),
});
export const paperlessExportSchema = z.object({
  documents: z.array(paperlessExportMetadataSchema).min(1).max(50),
});
export const paperlessDocumentIdsSchema = z.object({
  documentIds: z.array(z.string().min(1).max(200)).min(1).max(100),
});
export const paperlessReconcileSchema = z.object({
  documentId: z.string().min(1).max(200),
  action: z.enum(["link", "retry", "abandon", "check"]),
  remoteId: remoteId.optional(),
  confirmDuplicateRisk: z.boolean().default(false),
});
export type PaperlessSettings = z.infer<typeof paperlessSettingsSchema>;
export type PaperlessSearch = z.infer<typeof paperlessSearchSchema>;
export type PaperlessExportMetadata = z.infer<typeof paperlessExportMetadataSchema>;
export type PaperlessJobState =
  | "queued"
  | "transferring"
  | "processing"
  | "linked"
  | "failed"
  | "unknown"
  | "paused"
  | "abandoned";
export type PaperlessSettingsView = {
  instanceId: string | null;
  enabled: boolean;
  configured: boolean;
  encryptionReady: boolean;
  connected: boolean;
  browserUrl: string | null;
  apiUrl: string | null;
  config: PaperlessSettings | null;
};
export type PaperlessRemoteDocument = {
  id: number;
  title: string;
  created: string | null;
  tags: number[];
  correspondent: number | null;
  documentType: number | null;
  originalFileName: string | null;
};
export type PaperlessMetadata = {
  tags: { id: number; name: string }[];
  documentTypes: { id: number; name: string }[];
  correspondents: { id: number; name: string }[];
};
export type PaperlessDocumentState = {
  documentId: string;
  link: {
    remoteId: number;
    url: string | null;
    direction: "import" | "export";
    linkedAt: string;
  } | null;
  job: {
    state: PaperlessJobState;
    updatedAt: string;
    error: string | null;
    own: boolean;
    canAbandon: boolean;
    canResolve: boolean;
  } | null;
  verification: {
    state: "verified" | "inaccessible" | "unknown";
    checkedAt: string;
    lastVerifiedAt: string | null;
  } | null;
};
export type PaperlessImportResult = {
  documentId: string;
  duplicate: boolean;
  extraction: Extraction | null;
  extractionSource: "paperless";
  extractionError: "extraction_failed" | "metadata_unavailable" | null;
};
