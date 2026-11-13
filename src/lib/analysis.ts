import { z } from "zod";
import {
  countsTowardBudget,
  calculateCreditCosts,
  bankFundedPayments,
  isBankPot,
  isOverdue,
} from "./calc";
import { todayISO } from "./format";
import {
  DEFAULT_COST_ITEM_TITLES,
  type Expense,
  type ExpenseStatus,
  type Offer,
  type OfferStatus,
  type Task,
  type Workspace,
} from "./schema";

/** Filter value meaning "no trade / cost item / source / contact / assignee". */
export const NONE = "__none";

export const DATE_BASES = ["expense", "payment", "due"] as const;
export const GRANULARITIES = ["week", "month", "quarter"] as const;
export const SECTIONS = ["overview", "budget", "expenses", "offers", "tasks", "credit"] as const;
export type DateBasis = (typeof DATE_BASES)[number];
export type Granularity = (typeof GRANULARITIES)[number];
export type Section = (typeof SECTIONS)[number];

const ids = z.array(z.string().max(100)).max(200);
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable();

export const analysisFiltersSchema = z
  .object({
    from: isoDate,
    to: isoDate,
    dateBasis: z.enum(DATE_BASES),
    granularity: z.enum(GRANULARITIES),
    tradeIds: ids,
    costItemIds: ids,
    categories: ids,
    potIds: ids,
    statuses: z.array(z.enum(["offen", "bezahlt", "eingereicht", "erstattet", "abgelehnt"])),
    contactIds: ids,
    phases: ids,
    assigneeIds: ids,
    budgetOnly: z.boolean(),
  })
  .strict();
export type AnalysisFilters = z.infer<typeof analysisFiltersSchema>;

export const DEFAULT_FILTERS: AnalysisFilters = {
  from: null,
  to: null,
  dateBasis: "expense",
  granularity: "month",
  tradeIds: [],
  costItemIds: [],
  categories: [],
  potIds: [],
  statuses: [],
  contactIds: [],
  phases: [],
  assigneeIds: [],
  budgetOnly: false,
};

export const MAX_VIEWS = 20;
export const analysisViewsSchema = z
  .object({
    views: z
      .array(
        z
          .object({
            id: z.string().min(1).max(64),
            name: z.string().trim().min(1).max(60),
            section: z.enum(SECTIONS),
            filters: analysisFiltersSchema,
          })
          .strict(),
      )
      .max(MAX_VIEWS),
    defaultId: z.string().max(64).nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    const used = new Set(value.views.map((view) => view.id));
    if (used.size !== value.views.length || (value.defaultId && !used.has(value.defaultId)))
      context.addIssue({ code: "custom", message: "Analysis views must be unique" });
  });
export type AnalysisViews = z.infer<typeof analysisViewsSchema>;
export const DEFAULT_VIEWS: AnalysisViews = { views: [], defaultId: null };

export function activeFilterCount(filters: AnalysisFilters) {
  const base = DEFAULT_FILTERS;
  return (
    [filters.from, filters.to].filter(Boolean).length +
    (filters.budgetOnly ? 1 : 0) +
    (filters.dateBasis !== base.dateBasis ? 1 : 0) +
    [
      filters.tradeIds,
      filters.costItemIds,
      filters.categories,
      filters.potIds,
      filters.statuses,
      filters.contactIds,
      filters.phases,
      filters.assigneeIds,
    ].filter((list) => list.length > 0).length
  );
}

/* ---------- ledger: expenses and legacy invoices in one shape ---------- */

export type LedgerEntry = {
  id: string;
  kind: "expense" | "invoice";
  title: string;
  vendor: string | null;
  contactId: string | null;
  amount: number;
  date: string | null;
  dueDate: string | null;
  category: string | null;
  tradeId: string | null;
  costItemId: string | null;
  potId: string | null;
  status: ExpenseStatus;
  hasDocument: boolean;
  /** Bank money always counts; other sources only for real cost items that deduct from the budget. */
  countsToBudget: boolean;
};

function isSpecialCostItem(title: string) {
  const normalized = title.trim().toLocaleLowerCase();
  return DEFAULT_COST_ITEM_TITLES.some((item) => item.toLocaleLowerCase() === normalized);
}

export function buildLedger(
  ws: Pick<Workspace, "expenses" | "invoices" | "cost_items" | "budget_pots" | "contacts">,
  basis: DateBasis = "expense",
): LedgerEntry[] {
  const pots = ws.budget_pots ?? [];
  const costItems = new Map(ws.cost_items.map((item) => [item.id, item]));
  const classify = (potId: string | null | undefined, costItemId: string | null | undefined) => {
    const bank = isBankPot(pots.find((pot) => pot.id === potId));
    const item = costItemId ? costItems.get(costItemId) : undefined;
    return bank || (!!item && !isSpecialCostItem(item.title) && countsTowardBudget(potId, pots));
  };
  const pick = (
    own: string | null,
    expenseDate: string | null,
    payment: string | null,
    due: string | null,
  ) =>
    (basis === "payment"
      ? (payment ?? expenseDate)
      : basis === "due"
        ? (due ?? expenseDate)
        : (expenseDate ?? payment)) ??
    own ??
    null;
  const entries: LedgerEntry[] = ws.expenses.map((expense) => ({
    id: expense.id,
    kind: "expense",
    title: expense.title,
    vendor: expense.vendor,
    contactId: expense.contact_id ?? null,
    amount: Number(expense.amount),
    date: pick(null, expense.expense_date, expense.payment_date ?? null, expense.due_date ?? null),
    dueDate: expense.due_date ?? null,
    category: expense.category,
    tradeId: expense.trade_id,
    costItemId: expense.cost_item_id,
    potId: expense.budget_pot_id ?? null,
    status: expense.status,
    hasDocument: !!expense.document_id,
    countsToBudget: classify(expense.budget_pot_id, expense.cost_item_id),
  }));
  for (const invoice of ws.invoices) {
    entries.push({
      id: invoice.id,
      kind: "invoice",
      title: invoice.title || invoice.contractor,
      vendor: invoice.contractor,
      contactId: invoice.contact_id,
      amount: Number(invoice.amount),
      date: pick(null, invoice.invoice_date, invoice.payment_date ?? null, invoice.due_date),
      dueDate: invoice.due_date,
      category: "Handwerker",
      tradeId: invoice.trade_id,
      costItemId: invoice.cost_item_id,
      potId: invoice.budget_pot_id ?? null,
      status: invoice.paid ? "bezahlt" : "offen",
      hasDocument: !!invoice.document_id,
      countsToBudget: classify(invoice.budget_pot_id, invoice.cost_item_id),
    });
  }
  return entries;
}

const matches = (selected: string[], value: string | null | undefined) =>
  selected.length === 0 || selected.includes(value ?? NONE);

function inRange(date: string | null, filters: Pick<AnalysisFilters, "from" | "to">) {
  if (!filters.from && !filters.to) return true;
  if (!date) return false;
  const day = date.slice(0, 10);
  return (!filters.from || day >= filters.from) && (!filters.to || day <= filters.to);
}

export function filterLedger(entries: LedgerEntry[], filters: AnalysisFilters) {
  return entries.filter(
    (entry) =>
      inRange(entry.date, filters) &&
      matches(filters.tradeIds, entry.tradeId) &&
      matches(filters.costItemIds, entry.costItemId) &&
      matches(filters.categories, entry.category) &&
      matches(filters.potIds, entry.potId) &&
      matches(filters.contactIds, entry.contactId) &&
      (filters.statuses.length === 0 || filters.statuses.includes(entry.status)) &&
      (!filters.budgetOnly || entry.countsToBudget),
  );
}

export function filterOffers(offers: Offer[], filters: AnalysisFilters) {
  return offers.filter(
    (offer) =>
      inRange(offer.offer_date ?? offer.requested_date, filters) &&
      matches(filters.tradeIds, offer.trade_id) &&
      matches(filters.costItemIds, offer.cost_item_id) &&
      matches(filters.contactIds, offer.contact_id),
  );
}

export function filterTasks(tasks: Task[], filters: AnalysisFilters) {
  return tasks.filter(
    (task) =>
      inRange(task.due_date ?? task.start_date ?? null, filters) &&
      matches(filters.tradeIds, task.trade_id) &&
      matches(filters.costItemIds, task.cost_item_id) &&
      matches(filters.phases, task.phase) &&
      matches(filters.assigneeIds, task.assignee_id),
  );
}

/* ---------- periods ---------- */

const day = (value: string) => new Date(`${value}T00:00:00Z`);
const iso = (date: Date) => date.toISOString().slice(0, 10);

export function periodKey(date: string, granularity: Granularity) {
  const value = date.slice(0, 10);
  if (granularity === "month") return value.slice(0, 7);
  if (granularity === "quarter")
    return `${value.slice(0, 4)}-Q${Math.floor((Number(value.slice(5, 7)) - 1) / 3) + 1}`;
  const d = day(value);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return iso(d);
}

/** Every period between two dates, so charts show empty periods instead of skipping them. */
export function periodRange(first: string, last: string, granularity: Granularity) {
  const result: string[] = [];
  const end = periodKey(last, granularity);
  let cursor = first.slice(0, 10);
  for (let guard = 0; guard < 2000; guard++) {
    const key = periodKey(cursor, granularity);
    if (result.at(-1) !== key) result.push(key);
    if (key >= end) break;
    const next = day(cursor);
    if (granularity === "week") next.setUTCDate(next.getUTCDate() + 7);
    else if (granularity === "month") next.setUTCMonth(next.getUTCMonth() + 1, 1);
    else next.setUTCMonth(next.getUTCMonth() + 3, 1);
    cursor = iso(next);
  }
  return result;
}

/* ---------- aggregations ---------- */

export type Group = { key: string; amount: number; count: number };

export function groupSum(
  entries: LedgerEntry[],
  keyOf: (entry: LedgerEntry) => string | null,
): Group[] {
  const map = new Map<string, Group>();
  for (const entry of entries) {
    const key = keyOf(entry) ?? NONE;
    const group = map.get(key) ?? { key, amount: 0, count: 0 };
    group.amount += entry.amount;
    group.count += 1;
    map.set(key, group);
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount);
}

export type Series = { periods: string[]; keys: string[]; rows: Record<string, number | string>[] };

/** Amounts per period, split by a dimension (category, trade, source, status). */
export function seriesByPeriod(
  entries: LedgerEntry[],
  granularity: Granularity,
  keyOf: (entry: LedgerEntry) => string | null,
  maxKeys = 6,
): Series {
  const dated = entries.filter((entry) => entry.date);
  if (!dated.length) return { periods: [], keys: [], rows: [] };
  const totals = groupSum(dated, keyOf);
  const top = totals.slice(0, maxKeys).map((group) => group.key);
  const hasOther = totals.length > maxKeys;
  const keys = hasOther ? [...top, "__other"] : top;
  const dates = dated.map((entry) => entry.date!.slice(0, 10)).sort();
  const periods = periodRange(dates[0]!, dates.at(-1)!, granularity);
  const rows = periods.map(
    (period) =>
      ({ period, ...Object.fromEntries(keys.map((key) => [key, 0])) }) as Record<
        string,
        number | string
      >,
  );
  const byPeriod = new Map(rows.map((row) => [row["period"] as string, row]));
  for (const entry of dated) {
    const row = byPeriod.get(periodKey(entry.date!, granularity))!;
    const key = keyOf(entry) ?? NONE;
    const target = top.includes(key) ? key : "__other";
    row[target] = Number(row[target]) + entry.amount;
  }
  return { periods, keys, rows };
}

export const isPaid = (entry: Pick<LedgerEntry, "status">) => entry.status !== "offen";

export function ledgerTotals(entries: LedgerEntry[]) {
  const sum = (list: LedgerEntry[]) => list.reduce((total, entry) => total + entry.amount, 0);
  const paid = entries.filter(isPaid);
  const open = entries.filter((entry) => !isPaid(entry));
  return {
    total: sum(entries),
    count: entries.length,
    paid: sum(paid),
    open: sum(open),
    average: entries.length ? sum(entries) / entries.length : 0,
    byStatus: (status: ExpenseStatus) => sum(entries.filter((entry) => entry.status === status)),
  };
}

/** Money submitted to the bank and what became of it. Rate = reimbursed / decided. */
export function reimbursementFunnel(entries: LedgerEntry[]) {
  const sum = (status: ExpenseStatus) =>
    entries
      .filter((entry) => entry.status === status)
      .reduce((total, entry) => total + entry.amount, 0);
  const submitted = sum("eingereicht");
  const reimbursed = sum("erstattet");
  const rejected = sum("abgelehnt");
  const decided = reimbursed + rejected;
  return {
    submitted,
    reimbursed,
    rejected,
    pending: submitted,
    total: submitted + decided,
    rate: decided > 0 ? reimbursed / decided : null,
  };
}

export function dueBuckets(entries: LedgerEntry[], today = todayISO()) {
  const open = entries.filter((entry) => entry.status === "offen");
  const inDays = (days: number) => {
    const limit = day(today);
    limit.setUTCDate(limit.getUTCDate() + days);
    return iso(limit);
  };
  const buckets = { overdue: 0, week: 0, month: 0, later: 0, undated: 0 };
  for (const entry of open) {
    if (!entry.dueDate) buckets.undated += entry.amount;
    else if (entry.dueDate < today) buckets.overdue += entry.amount;
    else if (entry.dueDate <= inDays(7)) buckets.week += entry.amount;
    else if (entry.dueDate <= inDays(30)) buckets.month += entry.amount;
    else buckets.later += entry.amount;
  }
  return buckets;
}

export function dataQuality(entries: LedgerEntry[], ws: Pick<Workspace, "cost_items" | "offers">) {
  return {
    noCostItem: entries.filter((entry) => !entry.costItemId),
    noReceipt: entries.filter((entry) => !entry.hasDocument),
    noSource: entries.filter((entry) => !entry.potId),
    noPlan: ws.cost_items.filter((item) => !(Number(item.planned) > 0)),
    offersWithoutTrade: ws.offers.filter((offer) => !offer.trade_id),
  };
}

/* ---------- budget ---------- */

export type PlanRow = {
  id: string;
  title: string;
  tradeId: string | null;
  planned: number;
  committed: number;
  invoiced: number;
  paid: number;
  expected: number;
  variance: number;
  variancePct: number | null;
};

export function planVsForecast(
  items: {
    id: string;
    title: string;
    trade_id: string | null;
    planned: number;
    committed: number;
    invoiced: number;
    paid: number;
    expected: number;
  }[],
  filters: Pick<AnalysisFilters, "tradeIds" | "costItemIds">,
): PlanRow[] {
  return items
    .filter(
      (item) => matches(filters.tradeIds, item.trade_id) && matches(filters.costItemIds, item.id),
    )
    .map((item) => ({
      id: item.id,
      title: item.title,
      tradeId: item.trade_id,
      planned: item.planned,
      committed: item.committed,
      invoiced: item.invoiced,
      paid: item.paid,
      expected: item.expected,
      variance: item.expected - item.planned,
      variancePct: item.planned > 0 ? (item.expected - item.planned) / item.planned : null,
    }))
    .sort((a, b) => b.expected - a.expected);
}

/** Cumulative spend per period against the total budget. */
export function burnDown(entries: LedgerEntry[], granularity: Granularity, budget: number) {
  const dated = entries.filter((entry) => entry.date);
  if (!dated.length) return [];
  const dates = dated.map((entry) => entry.date!.slice(0, 10)).sort();
  const periods = periodRange(dates[0]!, dates.at(-1)!, granularity);
  const spent = new Map<string, number>();
  const paid = new Map<string, number>();
  for (const entry of dated) {
    const key = periodKey(entry.date!, granularity);
    spent.set(key, (spent.get(key) ?? 0) + entry.amount);
    if (isPaid(entry)) paid.set(key, (paid.get(key) ?? 0) + entry.amount);
  }
  let spentTotal = 0;
  let paidTotal = 0;
  return periods.map((period) => {
    spentTotal += spent.get(period) ?? 0;
    paidTotal += paid.get(period) ?? 0;
    return { period, spent: spentTotal, paid: paidTotal, budget };
  });
}

export function budgetStatus(
  budget: number,
  budgetExpected: number,
): "ok" | "tight" | "over" | "unset" {
  if (budget <= 0) return "unset";
  if (budgetExpected > budget) return "over";
  return budgetExpected > budget * 0.9 ? "tight" : "ok";
}

/* ---------- offers ---------- */

export type OfferComparison = {
  costItemId: string | null;
  min: number;
  max: number;
  accepted: number | null;
  count: number;
  saving: number;
};

/** Per cost item: price range of received/accepted quotes and the saving versus the most expensive one. */
export function offerComparison(offers: Offer[]): OfferComparison[] {
  const groups = new Map<string, Offer[]>();
  for (const offer of offers.filter(
    (item) => item.status === "received" || item.status === "accepted",
  )) {
    const key = offer.cost_item_id ?? NONE;
    groups.set(key, [...(groups.get(key) ?? []), offer]);
  }
  return [...groups.entries()]
    .map(([key, list]) => {
      const amounts = list.map((offer) => Number(offer.amount));
      const accepted = list.filter((offer) => offer.status === "accepted");
      const acceptedAmount = accepted.length
        ? accepted.reduce((total, offer) => total + Number(offer.amount), 0)
        : null;
      const max = Math.max(...amounts);
      return {
        costItemId: key === NONE ? null : key,
        min: Math.min(...amounts),
        max,
        accepted: acceptedAmount,
        count: list.length,
        saving: acceptedAmount !== null && list.length > 1 ? Math.max(0, max - acceptedAmount) : 0,
      };
    })
    .filter((row) => row.count > 1 || row.accepted !== null)
    .sort((a, b) => b.max - a.max);
}

export function offerPipeline(offers: Offer[]) {
  const statuses: OfferStatus[] = ["requested", "received", "accepted", "rejected"];
  return statuses.map((status) => {
    const list = offers.filter((offer) => offer.status === status);
    return {
      status,
      count: list.length,
      amount:
        status === "requested" ? 0 : list.reduce((total, offer) => total + Number(offer.amount), 0),
    };
  });
}

export function expiringOffers(offers: Offer[], today = todayISO(), days = 14) {
  const limit = day(today);
  limit.setUTCDate(limit.getUTCDate() + days);
  const until = iso(limit);
  return offers
    .filter(
      (offer) => offer.status === "received" && offer.valid_until && offer.valid_until <= until,
    )
    .sort((a, b) => a.valid_until!.localeCompare(b.valid_until!));
}

/* ---------- tasks and timeline ---------- */

export type TaskGroup = {
  key: string;
  open: number;
  progress: number;
  done: number;
  overdue: number;
  total: number;
};

export function taskProgress(
  tasks: Task[],
  keyOf: (task: Task) => string | null,
  today = todayISO(),
): TaskGroup[] {
  const map = new Map<string, TaskGroup>();
  for (const task of tasks) {
    const key = keyOf(task) ?? NONE;
    const group = map.get(key) ?? { key, open: 0, progress: 0, done: 0, overdue: 0, total: 0 };
    group.total += 1;
    if (task.status === "erledigt") group.done += 1;
    else if (task.status === "in_arbeit") group.progress += 1;
    else group.open += 1;
    if (isOverdue(task.due_date, task.status === "erledigt", today)) group.overdue += 1;
    map.set(key, group);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

export type TimelineItem = {
  id: string;
  title: string;
  kind: "task" | "event" | "deadline";
  start: string;
  end: string;
  done: boolean;
};

export function timelineItems(
  ws: Pick<Workspace, "tasks" | "events">,
  filters: AnalysisFilters,
): TimelineItem[] {
  const tasks = filterTasks(ws.tasks, filters)
    .filter((task) => task.due_date || task.start_date)
    .map((task) => ({
      id: task.id,
      title: task.title,
      kind: "task" as const,
      start: (task.start_date ?? task.due_date)!,
      end: (task.due_date ?? task.start_date)!,
      done: task.status === "erledigt",
    }));
  const events = ws.events
    .filter(
      (event) => inRange(event.event_date, filters) && matches(filters.tradeIds, event.trade_id),
    )
    .map((event) => ({
      id: event.id,
      title: event.title,
      kind: event.kind === "frist" ? ("deadline" as const) : ("event" as const),
      start: event.event_date,
      end: event.end_date ?? event.event_date,
      done: false,
    }));
  return [...tasks, ...events].sort(
    (a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end),
  );
}

/* ---------- credit ---------- */

export function creditAnalysis(
  ws: Pick<
    Workspace,
    "credit_terms" | "credit_repayments" | "expenses" | "invoices" | "budget_pots"
  >,
  today = todayISO(),
) {
  const terms = ws.credit_terms[0];
  if (!terms) return null;
  const payments = bankFundedPayments(ws.invoices, ws.expenses, terms.budget_pot_id);
  return calculateCreditCosts(terms, payments, ws.credit_repayments, today);
}
