// Shared data model; SQLite creates and updates these tables at startup.

// Private account metadata must not be included in TABLES or Workspace.
export const USER_APPEARANCE_TABLE = "app_user_appearance";
export const USER_NAVIGATION_TABLE = "app_user_navigation";
export const USER_NAVIGATION_DDL = `CREATE TABLE IF NOT EXISTS ${USER_NAVIGATION_TABLE} (
  user_id TEXT PRIMARY KEY, preferences TEXT NOT NULL
)`;
export const USER_APPEARANCE_DDL = `CREATE TABLE IF NOT EXISTS ${USER_APPEARANCE_TABLE} (
  user_id TEXT PRIMARY KEY, palette TEXT NOT NULL, mode TEXT NOT NULL
)`;

export const TABLES = {
  projects: ["name", "address", "total_budget", "start_date", "end_date"],
  trades: ["name", "budget", "color"],
  cost_items: ["trade_id", "title", "description", "planned"],
  offers: ["trade_id", "cost_item_id", "document_id", "contact_id", "requested_date", "contractor", "title", "amount", "offer_date", "status", "notes"],
  invoices: ["trade_id", "cost_item_id", "document_id", "contact_id", "contractor", "title", "amount", "invoice_date", "due_date", "paid", "budget_pot_id"],
  documents: ["name", "category", "tags", "description", "storage_path", "mime_type", "size", "trade_id", "task_id", "cost_item_id"],
  tasks: ["title", "trade_id", "phase", "priority", "status", "due_date", "notes", "cost_item_id", "document_id"],
  events: ["title", "event_date", "start_time", "end_date", "end_time", "kind", "trade_id", "notes"],
  ideas: ["collection", "title", "url", "document_id", "notes", "tags", "trade_id", "room", "price", "favorite"],
  contacts: ["name", "company", "trade_id", "phone", "email", "address", "website", "notes"],
  expenses: ["title", "vendor", "amount", "expense_date", "category", "trade_id", "cost_item_id", "document_id", "status", "notes", "budget_pot_id"],
  budget_pots: ["name", "deducts_from_budget", "notes"],
} as const;

export type TableName = keyof typeof TABLES;
export const TABLE_NAMES = Object.keys(TABLES) as TableName[];

export const NUMERIC_COLS = new Set(["total_budget", "budget", "planned", "amount", "size", "price"]);
export const BOOL_COLS = new Set(["paid", "favorite", "deducts_from_budget"]);

type Base = { id: string; created_at?: string };
export type Project = Base & { name: string; address: string | null; total_budget: number; start_date: string | null; end_date: string | null };
export type Trade = Base & { name: string; budget: number; color: string | null };
export type CostItem = Base & { trade_id: string | null; title: string; description: string | null; planned: number };
export type OfferStatus = "requested" | "received" | "accepted" | "rejected";
export type Offer = Base & { trade_id: string | null; cost_item_id: string | null; document_id: string | null; contact_id: string | null; requested_date: string | null; contractor: string; title: string | null; amount: number; offer_date: string | null; status: OfferStatus; notes: string | null };
export type Invoice = Base & { trade_id: string | null; cost_item_id: string | null; document_id: string | null; contact_id: string | null; contractor: string; title: string | null; amount: number; invoice_date: string | null; due_date: string | null; paid: boolean; budget_pot_id?: string | null };
export type Doc = Base & { name: string; category: string; tags: string | null; description: string | null; storage_path: string | null; mime_type: string | null; size: number | null; trade_id: string | null; task_id: string | null; cost_item_id: string | null };
export type Task = Base & { title: string; trade_id: string | null; phase: string | null; priority: "niedrig" | "mittel" | "hoch"; status: "offen" | "in_arbeit" | "erledigt"; due_date: string | null; notes: string | null; cost_item_id: string | null; document_id: string | null };
export type CalEvent = Base & { title: string; event_date: string; start_time: string | null; end_date: string | null; end_time: string | null; kind: "termin" | "frist" | "arbeit"; trade_id: string | null; notes: string | null };

export type ExpenseStatus = "offen" | "bezahlt" | "eingereicht" | "erstattet";
export type Expense = Base & { title: string; vendor: string | null; amount: number; expense_date: string | null; category: string | null; trade_id: string | null; cost_item_id: string | null; document_id: string | null; status: ExpenseStatus; notes: string | null; budget_pot_id?: string | null };
/** Payment source (e.g. "Bank", "Privat"); only sources with deducts_from_budget count against the total budget. */
export type BudgetPot = Base & { name: string; deducts_from_budget: boolean; notes: string | null };
export const EXPENSE_CATEGORIES = ["Baumarkt", "Material", "Werkzeug", "Entsorgung", "Gebühren", "Transport", "Verpflegung", "Sonstiges"];

export type Idea = Base & { collection: string; title: string; url: string | null; document_id: string | null; notes: string | null; tags: string | null; trade_id: string | null; room: string | null; price: number | null; favorite: boolean };

export type Contact = Base & { name: string; company: string | null; trade_id: string | null; phone: string | null; email: string | null; address: string | null; website: string | null; notes: string | null };

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
};

export const DOC_CATEGORIES = ["Angebot", "Rechnung", "Vertrag", "Plan", "Datenblatt", "Foto", "Beleg", "Sonstiges"];
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
