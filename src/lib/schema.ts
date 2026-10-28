// Shared data model; SQLite creates and updates these tables at startup.

// Private account metadata must not be included in TABLES or Workspace.
export const PAPERLESS_TABLES = {
  app_paperless_access: ["user_id"],
  app_paperless_auto_import: [
    "user_id",
    "instance_id",
    "tag_id",
    "revision",
    "page",
    "next_run",
    "lease_until",
    "last_run",
    "imported",
    "skipped",
    "failed",
    "error",
  ],
  app_paperless_config: ["id", "instance_id", "enabled", "api_url", "browser_url"],
  app_paperless_credentials: ["user_id", "instance_id", "ciphertext"],
  app_paperless_links: [
    "document_id",
    "instance_id",
    "remote_id",
    "direction",
    "linked_at",
    "checksum",
    "browser_url",
  ],
  app_paperless_jobs: [
    "id",
    "document_id",
    "instance_id",
    "user_id",
    "metadata",
    "state",
    "task_id",
    "error",
    "created_at",
    "updated_at",
    "checksum",
  ],
  app_paperless_checks: ["user_id", "document_id", "state", "checked_at", "last_verified_at"],
} as const;
export const PAPERLESS_ACCESS_DDL = `
CREATE TABLE IF NOT EXISTS app_paperless_access (user_id TEXT PRIMARY KEY);
`;
export const PAPERLESS_AUTO_IMPORT_DDL = `
CREATE TABLE IF NOT EXISTS app_paperless_auto_import (
 user_id TEXT PRIMARY KEY, instance_id TEXT NOT NULL, tag_id INTEGER NOT NULL CHECK(tag_id > 0),
 revision TEXT NOT NULL, page INTEGER NOT NULL DEFAULT 1, next_run TEXT NOT NULL,
 lease_until TEXT, last_run TEXT, imported INTEGER NOT NULL DEFAULT 0,
 skipped INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0, error TEXT
);
`;
export const PAPERLESS_DDL = `
CREATE TABLE IF NOT EXISTS app_paperless_config (
 id INTEGER PRIMARY KEY CHECK(id = 1), instance_id TEXT NOT NULL, enabled INTEGER NOT NULL,
 api_url TEXT NOT NULL, browser_url TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS app_paperless_credentials (
 user_id TEXT PRIMARY KEY, instance_id TEXT NOT NULL, ciphertext TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS app_paperless_links (
 document_id TEXT PRIMARY KEY, instance_id TEXT NOT NULL, remote_id INTEGER NOT NULL CHECK(remote_id > 0),
 direction TEXT NOT NULL CHECK(direction IN ('import','export')), linked_at TEXT NOT NULL, checksum TEXT NOT NULL,
 browser_url TEXT NOT NULL,
 UNIQUE(instance_id, remote_id)
);
CREATE TABLE IF NOT EXISTS app_paperless_jobs (
 id TEXT PRIMARY KEY, document_id TEXT NOT NULL UNIQUE, instance_id TEXT NOT NULL,
 user_id TEXT, metadata TEXT NOT NULL, state TEXT NOT NULL, task_id TEXT, error TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, checksum TEXT
);
CREATE TABLE IF NOT EXISTS app_paperless_checks (
 user_id TEXT NOT NULL, document_id TEXT NOT NULL, state TEXT NOT NULL,
 checked_at TEXT NOT NULL, last_verified_at TEXT, PRIMARY KEY(user_id, document_id)
);
CREATE TRIGGER IF NOT EXISTS paperless_document_delete_guard BEFORE DELETE ON documents
 WHEN EXISTS(SELECT 1 FROM app_paperless_jobs WHERE document_id = OLD.id
 AND state IN ('queued','transferring','processing','unknown','paused'))
 BEGIN SELECT RAISE(ABORT, 'paperless.errors.active_transfer'); END;
CREATE TRIGGER IF NOT EXISTS paperless_document_cleanup AFTER DELETE ON documents
 BEGIN
 DELETE FROM app_paperless_links WHERE document_id = OLD.id;
 DELETE FROM app_paperless_jobs WHERE document_id = OLD.id;
 DELETE FROM app_paperless_checks WHERE document_id = OLD.id;
 END;
CREATE TRIGGER IF NOT EXISTS paperless_document_file_guard BEFORE UPDATE OF storage_path ON documents
 WHEN OLD.storage_path IS NOT NEW.storage_path AND (
 EXISTS(SELECT 1 FROM app_paperless_links WHERE document_id = OLD.id) OR
 EXISTS(SELECT 1 FROM app_paperless_jobs WHERE document_id = OLD.id
 AND state IN ('queued','transferring','processing','unknown','paused')))
 BEGIN SELECT RAISE(ABORT, 'paperless.errors.active_transfer'); END;
`;
export const PUSH_DDL = `
CREATE TABLE IF NOT EXISTS app_push_subscriptions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, session_hash TEXT NOT NULL,
  endpoint TEXT UNIQUE NOT NULL, subscription TEXT NOT NULL, language TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS app_push_jobs (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, resource_table TEXT NOT NULL, resource_id TEXT NOT NULL,
  recipient TEXT, version TEXT NOT NULL, due_at TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS app_push_deliveries (
  job_id TEXT NOT NULL, subscription_id TEXT NOT NULL, sent INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0, next_attempt TEXT NOT NULL, lease_until TEXT,
  PRIMARY KEY (job_id, subscription_id)
);
CREATE INDEX IF NOT EXISTS app_push_user ON app_push_subscriptions(user_id);
`;
export const USER_APPEARANCE_TABLE = "app_user_appearance";
export const USER_NAVIGATION_TABLE = "app_user_navigation";
export const USER_NAVIGATION_DDL = `CREATE TABLE IF NOT EXISTS ${USER_NAVIGATION_TABLE} (
  user_id TEXT PRIMARY KEY, preferences TEXT NOT NULL
)`;
export const USER_APPEARANCE_DDL = `CREATE TABLE IF NOT EXISTS ${USER_APPEARANCE_TABLE} (
  user_id TEXT PRIMARY KEY, palette TEXT NOT NULL, mode TEXT NOT NULL
)`;
export const SYNC_OPERATIONS_DDL = `CREATE TABLE IF NOT EXISTS app_sync_operations (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, applied_at TEXT NOT NULL
)`;

export const TABLES = {
  projects: ["name", "address", "total_budget", "start_date", "end_date"],
  trades: ["name", "budget", "color"],
  cost_items: ["trade_id", "title", "description", "planned"],
  offers: [
    "trade_id",
    "cost_item_id",
    "document_id",
    "contact_id",
    "requested_date",
    "contractor",
    "title",
    "amount",
    "offer_date",
    "valid_until",
    "status",
    "notes",
  ],
  invoices: [
    "trade_id",
    "cost_item_id",
    "document_id",
    "contact_id",
    "contractor",
    "title",
    "amount",
    "invoice_date",
    "due_date",
    "paid",
    "payment_date",
    "budget_pot_id",
  ],
  documents: [
    "name",
    "category",
    "tags",
    "description",
    "storage_path",
    "mime_type",
    "size",
    "trade_id",
    "task_id",
    "cost_item_id",
  ],
  tasks: [
    "title",
    "assignee_id",
    "trade_id",
    "phase",
    "priority",
    "status",
    "start_date",
    "due_date",
    "notes",
    "cost_item_id",
    "document_id",
  ],
  events: [
    "title",
    "event_date",
    "start_time",
    "end_date",
    "end_time",
    "kind",
    "trade_id",
    "notes",
    "caldav_uid",
    "caldav_data",
  ],
  ideas: [
    "collection",
    "title",
    "url",
    "document_id",
    "notes",
    "tags",
    "trade_id",
    "room",
    "price",
    "favorite",
  ],
  contacts: ["name", "company", "trade_id", "phone", "email", "address", "website", "notes"],
  expenses: [
    "title",
    "vendor",
    "contact_id",
    "offer_id",
    "amount",
    "expense_date",
    "due_date",
    "payment_date",
    "category",
    "trade_id",
    "cost_item_id",
    "document_id",
    "status",
    "notes",
    "budget_pot_id",
  ],
  budget_pots: ["name", "deducts_from_budget", "notes"],
  funding_entries: ["budget_pot_id", "amount", "received_date", "notes"],
  credit_terms: [
    "budget_pot_id",
    "total_credit",
    "annual_rate",
    "interest_free_start",
    "interest_free_end",
    "repayment_start",
    "commitment_rate",
    "commitment_free_end",
    "repayment_months",
    "day_basis",
    "effective_rate",
    "fixed_rate_end",
    "payout_rate",
    "net_credit",
    "repayment_rate",
    "monthly_installment",
    "repayment_count",
    "first_installment_date",
    "commitment_start",
  ],
  credit_repayments: ["amount", "repayment_date", "notes"],
} as const;

export type TableName = keyof typeof TABLES;
export const TABLE_NAMES = Object.keys(TABLES) as TableName[];

export const NUMERIC_COLS = new Set([
  "total_budget",
  "budget",
  "planned",
  "amount",
  "size",
  "price",
  "total_credit",
  "annual_rate",
  "commitment_rate",
  "repayment_months",
  "day_basis",
  "effective_rate",
  "payout_rate",
  "net_credit",
  "repayment_rate",
  "monthly_installment",
  "repayment_count",
]);
export const BOOL_COLS = new Set(["paid", "favorite", "deducts_from_budget"]);

type Base = { id: string; created_at?: string };
export type Project = Base & {
  name: string;
  address: string | null;
  total_budget: number;
  start_date: string | null;
  end_date: string | null;
};
export type Trade = Base & { name: string; budget: number; color: string | null };
export type CostItem = Base & {
  trade_id: string | null;
  title: string;
  description: string | null;
  planned: number;
};
export type OfferStatus = "requested" | "received" | "accepted" | "rejected";
export type Offer = Base & {
  trade_id: string | null;
  cost_item_id: string | null;
  document_id: string | null;
  contact_id: string | null;
  requested_date: string | null;
  contractor: string;
  title: string | null;
  amount: number;
  offer_date: string | null;
  valid_until?: string | null;
  status: OfferStatus;
  notes: string | null;
};
export type Invoice = Base & {
  trade_id: string | null;
  cost_item_id: string | null;
  document_id: string | null;
  contact_id: string | null;
  contractor: string;
  title: string | null;
  amount: number;
  invoice_date: string | null;
  due_date: string | null;
  paid: boolean;
  payment_date?: string | null;
  budget_pot_id?: string | null;
};
export type Doc = Base & {
  name: string;
  category: string;
  tags: string | null;
  description: string | null;
  storage_path: string | null;
  mime_type: string | null;
  size: number | null;
  trade_id: string | null;
  task_id: string | null;
  cost_item_id: string | null;
};
export type Task = Base & {
  title: string;
  assignee_id: string | null;
  trade_id: string | null;
  phase: string | null;
  priority: "niedrig" | "mittel" | "hoch";
  status: "offen" | "in_arbeit" | "erledigt";
  start_date?: string | null;
  due_date: string | null;
  notes: string | null;
  cost_item_id: string | null;
  document_id: string | null;
};
export type CalEvent = Base & {
  title: string;
  event_date: string;
  start_time: string | null;
  end_date: string | null;
  end_time: string | null;
  kind: "termin" | "frist" | "arbeit";
  trade_id: string | null;
  notes: string | null;
  caldav_uid?: string | null;
  caldav_data?: string | null;
};

export type ExpenseStatus = "offen" | "bezahlt" | "eingereicht" | "erstattet";
export type Expense = Base & {
  title: string;
  vendor: string | null;
  contact_id?: string | null;
  offer_id?: string | null;
  amount: number;
  expense_date: string | null;
  due_date?: string | null;
  payment_date?: string | null;
  category: string | null;
  trade_id: string | null;
  cost_item_id: string | null;
  document_id: string | null;
  status: ExpenseStatus;
  notes: string | null;
  budget_pot_id?: string | null;
};
/** Payment source (e.g. "Bank", "Privat"); only sources with deducts_from_budget count against the total budget. */
export type BudgetPot = Base & { name: string; deducts_from_budget: boolean; notes: string | null };
export type CreditTerms = Base & {
  budget_pot_id: string | null;
  total_credit: number;
  annual_rate: number;
  interest_free_start: string | null;
  interest_free_end: string | null;
  repayment_start: string | null;
  commitment_rate: number;
  commitment_free_end: string | null;
  repayment_months: number | null;
  day_basis: 360 | 365;
  effective_rate?: number | null;
  fixed_rate_end?: string | null;
  payout_rate?: number | null;
  net_credit?: number | null;
  repayment_rate?: number | null;
  monthly_installment?: number | null;
  repayment_count?: number | null;
  first_installment_date?: string | null;
  commitment_start?: string | null;
};
export type CreditRepayment = Base & {
  amount: number;
  repayment_date: string;
  notes: string | null;
};
export const EXPENSE_CATEGORIES = [
  "Handwerker",
  "Baumarkt",
  "Material",
  "Werkzeug",
  "Entsorgung",
  "Gebühren",
  "Transport",
  "Verpflegung",
  "Sonstiges",
];

export type Idea = Base & {
  collection: string;
  title: string;
  url: string | null;
  document_id: string | null;
  notes: string | null;
  tags: string | null;
  trade_id: string | null;
  room: string | null;
  price: number | null;
  favorite: boolean;
};

export type Contact = Base & {
  name: string;
  company: string | null;
  trade_id: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  website: string | null;
  notes: string | null;
};

export type Workspace = {
  contacts: Contact[];
  projects: Project[];
  trades: Trade[];
  cost_items: CostItem[];
  offers: Offer[];
  invoices: Invoice[];
  documents: Doc[];
  tasks: Task[];
  events: CalEvent[];
  ideas: Idea[];
  expenses: Expense[];
  budget_pots: BudgetPot[];
  funding_entries: FundingEntry[];
  credit_terms: CreditTerms[];
  credit_repayments: CreditRepayment[];
};

export type FundingEntry = Base & {
  budget_pot_id: string;
  amount: number;
  received_date: string;
  notes: string | null;
};

export const DOC_CATEGORIES = [
  "Angebot",
  "Rechnung",
  "Vertrag",
  "Plan",
  "Datenblatt",
  "Foto",
  "Beleg",
  "Sonstiges",
];
export const PHASES = ["Planung", "Rückbau", "Rohinstallation", "Innenausbau", "Abschluss"];

/** Sanitize an incoming row to only known columns with normalized types. */
export function cleanRow(table: TableName, row: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const col of TABLES[table] as readonly string[]) {
    if (!(col in row)) continue;
    let v = row[col];
    if (v === "" || v === undefined) v = null;
    if (v !== null && NUMERIC_COLS.has(col)) v = Number(v) || 0;
    if (BOOL_COLS.has(col)) v = Boolean(v);
    out[col] = v;
  }
  return out;
}
