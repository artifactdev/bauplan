import { tr } from "@/i18n";
import { usePushTarget } from "@/hooks/use-push-target";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { FileText, Pencil, Plus, Search, Split, Trash2 } from "lucide-react";
import { useMutations, useWorkspace } from "@/hooks/use-workspace";
import { eur, fmtDate, todayISO } from "@/lib/format";
import {
  contactLabel,
  contactOptions,
  offerOptions,
  potName,
  potOptions,
  tradeName,
  tradeOptions,
} from "@/lib/options";
import { type BankSubmissionStatus, type Expense, type ExpenseStatus } from "@/lib/schema";
import { expenseIsOverdue, expenseTransition, migrateExpenseStatus } from "@/lib/expenses";
import { exportExpenses, markExportedExpensesSubmitted } from "@/lib/data.functions";
import { getOfflineAccount, listChanges, listUploads } from "@/lib/offline-store";
import { Empty, MetricCard, PageHeader, Panel, Pill } from "@/components/app/ui-bits";
import { ExpenseDialog } from "@/components/app/ExpenseDialog";
import { ExpenseSplitDialog } from "@/components/app/ExpenseSplitDialog";
import { resolveFileUrl } from "@/components/app/doc-open";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_ws/ausgaben")({
  head: () => ({
    meta: [
      { title: tr("expenses.expenses_bauplan") },
      { name: "description", content: tr("expenses.receipts_general_invoices_document") },
      { property: "og:title", content: tr("expenses.expenses_bauplan") },
      { property: "og:description", content: tr("expenses.receipts_invoices_renovation_glance") },
    ],
  }),
  component: ExpensesPage,
});

const EXPENSE_STATUS: Record<
  ExpenseStatus,
  { label: string; tone: "neutral" | "warning" | "success" | "info" | "primary" | "danger" }
> = {
  offen: { label: tr("shared.open"), tone: "warning" },
  bezahlt: { label: tr("shared.paid"), tone: "success" },
  eingereicht: { label: tr("shared.submitted"), tone: "info" },
  erstattet: { label: tr("shared.reimbursed"), tone: "primary" },
  abgelehnt: { label: tr("shared.rejected"), tone: "danger" },
};
const STATUS_OPTIONS = Object.entries(EXPENSE_STATUS)
  .filter(([value]) => value === "offen" || value === "bezahlt")
  .map(([value, s]) => ({
    value,
    label: s.label,
  }));
const BANK_STATUS: Record<BankSubmissionStatus, string> = {
  nicht_festgelegt: tr("expenses.bank_unset"),
  einzureichen: tr("expenses.bank_ready"),
  eingereicht: tr("expenses.bank_submitted"),
  ausgezahlt: tr("expenses.bank_paid_out"),
  abgelehnt: tr("expenses.bank_rejected"),
};
const bankStatus = (expense: Expense) =>
  expense.bank_status ?? migrateExpenseStatus(expense.status).bank_status;

type Snapshot = Record<string, string | number | boolean | null>;
function snapshot(value: object): Snapshot {
  const result: Snapshot = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) continue;
    if (
      item !== null &&
      typeof item !== "string" &&
      typeof item !== "number" &&
      typeof item !== "boolean"
    )
      throw new Error("expenses.export_failed");
    result[key] = item;
  }
  return result;
}

function ExpensesPage() {
  const { ws, projectId, refetch } = useWorkspace();
  const { update, remove } = useMutations();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [bankFilter, setBankFilter] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState<{
    projectId: string;
    expenses: Snapshot[];
    documents: Snapshot[];
  } | null>(null);
  const [source, setSource] = useState<string>("all");
  const [trade, setTrade] = useState("all");
  const [contact, setContact] = useState("all");
  const [offer, setOffer] = useState("all");
  const [splitting, setSplitting] = useState<Expense | null>(null);
  const [sort, setSort] = useState("date");
  const [dlg, setDlg] = useState<{ id?: string; initial?: Record<string, unknown> } | null>(() =>
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("aktion") === "neu"
      ? {
          initial: { status: "bezahlt", expense_date: todayISO(), category: "Baumarkt" },
        }
      : null,
  );
  usePushTarget(ws.expenses, (expense) => setDlg({ id: expense.id, initial: { ...expense } }));
  const today = todayISO();
  const vendor = (expense: Expense) => {
    const linked = ws.contacts.find((item) => item.id === expense.contact_id);
    return linked ? contactLabel(linked) : expense.vendor;
  };
  const linkedOffer = (expense: Expense) => ws.offers.find((item) => item.id === expense.offer_id);
  const changeStatus = (expense: Expense, value: string) => {
    if (value === expense.status) return;
    update.mutate({
      table: "expenses",
      id: expense.id,
      patch: { status: value },
    });
  };
  const changeBankStatus = (expense: Expense, value: string) => {
    if (value === bankStatus(expense)) return;
    try {
      const patch = expenseTransition({ bank_status: value }, expense, ws.budget_pots);
      update.mutate({ table: "expenses", id: expense.id, patch });
    } catch (error) {
      if (error instanceof Error && error.message === "expenses.private_source_required") {
        setDlg({ id: expense.id, initial: { ...expense, bank_status: value } });
        toast.info(tr(error.message));
      } else toast.error(tr(error instanceof Error ? error.message : "expenses.export_failed"));
    }
  };
  const statusPill = (expense: Expense) => (
    <Pill tone={expenseIsOverdue(expense, today) ? "danger" : EXPENSE_STATUS[expense.status]?.tone}>
      {expenseIsOverdue(expense, today)
        ? tr("shared.overdue")
        : (EXPENSE_STATUS[expense.status]?.label ?? expense.status)}
    </Pill>
  );

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return ws.expenses
      .filter(
        (e) =>
          status === "all" ||
          (status === "overdue" ? expenseIsOverdue(e, today) : e.status === status),
      )
      .filter((e) => {
        const bank = bankStatus(e);
        return (
          bankFilter === "all" ||
          (bankFilter === "not_submitted"
            ? bank === "einzureichen" || bank === "nicht_festgelegt"
            : bankFilter === "completed"
              ? bank === "ausgezahlt" || bank === "abgelehnt"
              : bank === bankFilter)
        );
      })
      .filter(
        (e) =>
          source === "all" || (source === "none" ? !e.budget_pot_id : e.budget_pot_id === source),
      )
      .filter((e) => trade === "all" || e.trade_id === trade)
      .filter((e) => contact === "all" || e.contact_id === contact)
      .filter((e) => offer === "all" || e.offer_id === offer)
      .filter((e) => {
        const c = ws.contacts.find((item) => item.id === e.contact_id);
        const o = ws.offers.find((item) => item.id === e.offer_id);
        return (
          !s ||
          [
            e.title,
            e.vendor,
            e.category,
            c?.name,
            c?.company,
            o?.title,
            o?.contractor,
            tradeName(ws, e.trade_id),
          ]
            .join(" ")
            .toLowerCase()
            .includes(s)
        );
      })
      .sort((a, b) => {
        if (sort === "due") return (a.due_date || "9999").localeCompare(b.due_date || "9999");
        if (sort === "amount") return Number(b.amount) - Number(a.amount);
        if (sort === "title") return a.title.localeCompare(b.title);
        return (b.expense_date ?? "").localeCompare(a.expense_date ?? "");
      });
  }, [ws, q, status, bankFilter, source, trade, contact, offer, sort, today]);
  const bySource = (id: string | null) =>
    ws.expenses
      .filter((e) => (id ? e.budget_pot_id === id : !e.budget_pot_id))
      .reduce((a, e) => a + Number(e.amount), 0);

  const sumBy = (st: ExpenseStatus) =>
    ws.expenses.filter((e) => e.status === st).reduce((a, e) => a + Number(e.amount), 0);
  const sumBank = (st: BankSubmissionStatus) =>
    ws.expenses.filter((e) => bankStatus(e) === st).reduce((a, e) => a + Number(e.amount), 0);
  const total = ws.expenses.reduce((a, e) => a + Number(e.amount), 0);
  const hasRejected = ws.expenses.some((e) => bankStatus(e) === "abgelehnt");
  const overdueTotal = ws.expenses
    .filter((e) => expenseIsOverdue(e, today))
    .reduce((sum, e) => sum + Number(e.amount), 0);
  const listTotal = list.reduce((a, e) => a + Number(e.amount), 0);
  const selectedExpenses = ws.expenses.filter((expense) => selected.has(expense.id));
  const toggleSelected = (id: string, checked: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  const download = async (expenses: Expense[]) => {
    if (!navigator.onLine) {
      toast.error(tr("expenses.export_online"));
      return;
    }
    if (!projectId || !expenses.length) {
      toast.error(tr("expenses.export_empty"));
      return;
    }
    setExporting(true);
    try {
      const account = getOfflineAccount();
      if (!account) throw new Error("offline.no_account_available_offline");
      const [changes, uploads] = await Promise.all([
        listChanges(account.id),
        listUploads(account.id),
      ]);
      if (changes.length || uploads.length) throw new Error("expenses.export_pending");
      const result = await exportExpenses({
        data: { projectId, ids: expenses.map((item) => item.id) },
      });
      if ("missing" in result && result.missing) {
        toast.error(tr("expenses.export_missing", { titles: result.missing.join(", ") }));
        return;
      }
      if (!("archive" in result) || !result.archive) throw new Error("expenses.export_failed");
      const decoded = atob(result.archive);
      const bytes = Uint8Array.from(decoded, (char) => char.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "bank-submission.zip";
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExported({
        projectId,
        expenses: result.expenses.map(snapshot),
        documents: result.documents.map(snapshot),
      });
    } catch (error) {
      toast.error(tr(error instanceof Error ? error.message : "expenses.export_failed"));
    } finally {
      setExporting(false);
    }
  };
  const markExported = async () => {
    if (!projectId || !exported) return;
    try {
      if (projectId !== exported.projectId) throw new Error("expenses.export_conflict");
      await markExportedExpensesSubmitted({ data: exported });
      await refetch();
      toast.success(tr("expenses.export_marked"));
    } catch (error) {
      toast.error(tr(error instanceof Error ? error.message : "expenses.export_failed"));
    } finally {
      setExported(null);
    }
  };

  const openDoc = async (docId: string | null) => {
    const d = ws.documents.find((x) => x.id === docId);
    const url = await resolveFileUrl(d?.storage_path ?? null);
    if (url) window.open(url, "_blank");
  };

  return (
    <>
      <PageHeader
        title={tr("shared.expenses")}
        subtitle={tr("expenses.receipts_general_invoices_deducted")}
        actions={
          <Button
            size="sm"
            onClick={() =>
              setDlg({
                initial: { status: "bezahlt", expense_date: todayISO(), category: "Baumarkt" },
              })
            }
          >
            <Plus data-icon="inline-start" /> {tr("expenses.create_expense")}
          </Button>
        }
      />

      <div
        className={`grid grid-cols-2 gap-3 sm:grid-cols-3 ${hasRejected ? "xl:grid-cols-8" : "xl:grid-cols-7"}`}
      >
        <Stat label={tr("shared.total")} value={eur(total, true)} amount={total} tone="neutral" />
        {(["offen", "bezahlt"] as const).map((st) => (
          <Stat
            key={st}
            label={EXPENSE_STATUS[st].label}
            value={eur(sumBy(st), true)}
            amount={sumBy(st)}
            tone={EXPENSE_STATUS[st].tone}
            active={status === st}
            onClick={() => setStatus(status === st ? "all" : st)}
          />
        ))}
        {(["einzureichen", "eingereicht"] as const).map((st) => (
          <Stat
            key={st}
            label={BANK_STATUS[st]}
            value={eur(sumBank(st), true)}
            amount={sumBank(st)}
            tone="info"
            active={bankFilter === st}
            onClick={() => setBankFilter(bankFilter === st ? "all" : st)}
          />
        ))}
        <Stat
          label={tr("shared.overdue")}
          value={eur(overdueTotal, true)}
          amount={overdueTotal}
          tone="danger"
          active={status === "overdue"}
          onClick={() => setStatus(status === "overdue" ? "all" : "overdue")}
        />
        <Stat
          label={BANK_STATUS.ausgezahlt}
          value={eur(sumBank("ausgezahlt"), true)}
          amount={sumBank("ausgezahlt")}
          tone="primary"
          active={bankFilter === "ausgezahlt"}
          onClick={() => setBankFilter(bankFilter === "ausgezahlt" ? "all" : "ausgezahlt")}
        />
        {hasRejected && (
          <Stat
            label={BANK_STATUS.abgelehnt}
            value={eur(sumBank("abgelehnt"), true)}
            amount={sumBank("abgelehnt")}
            tone={EXPENSE_STATUS.abgelehnt.tone}
            active={bankFilter === "abgelehnt"}
            onClick={() => setBankFilter(bankFilter === "abgelehnt" ? "all" : "abgelehnt")}
          />
        )}
      </div>

      {ws.budget_pots.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          {ws.budget_pots.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setSource(source === p.id ? "all" : p.id)}
              className={`rounded-full border px-3 py-1 tabular ${source === p.id ? "border-primary bg-primary/10" : "bg-card"}`}
            >
              {p.name}: <span className="font-medium">{eur(bySource(p.id), true)}</span>
              {!p.deducts_from_budget && (
                <span className="ml-1 text-xs text-muted-foreground">
                  ({tr("shared.not_budget")})
                </span>
              )}
            </button>
          ))}
          {bySource(null) > 0 && (
            <span className="rounded-full border px-3 py-1 text-muted-foreground tabular">
              {tr("expenses.no_source")}: {eur(bySource(null), true)}
            </span>
          )}
        </div>
      )}

      <div className="my-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        <div className="relative col-span-2 w-full sm:w-72">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder={tr("shared.search")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-full sm:w-44" aria-label={tr("shared.status")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="all">{tr("shared.all_statuses")}</SelectItem>
              {STATUS_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
              <SelectItem value="overdue">{tr("shared.overdue")}</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
        <Select value={bankFilter} onValueChange={setBankFilter}>
          <SelectTrigger className="w-full sm:w-44" aria-label={tr("expenses.bank_status")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="all">{tr("expenses.bank_all")}</SelectItem>
              <SelectItem value="not_submitted">{tr("expenses.bank_not_submitted")}</SelectItem>
              <SelectItem value="completed">{tr("expenses.bank_completed")}</SelectItem>
              {Object.entries(BANK_STATUS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        {ws.budget_pots.length > 0 && (
          <Select value={source} onValueChange={setSource}>
            <SelectTrigger className="w-full sm:w-44" aria-label={tr("shared.paid_2")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{tr("expenses.all_sources")}</SelectItem>
              {ws.budget_pots.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
              <SelectItem value="none">{tr("expenses.no_source")}</SelectItem>
            </SelectContent>
          </Select>
        )}
        {[
          {
            value: trade,
            onChange: setTrade,
            label: tr("shared.all_trades"),
            options: tradeOptions(ws),
          },
          {
            value: contact,
            onChange: setContact,
            label: tr("expenses.all_contacts"),
            options: contactOptions(ws),
          },
          {
            value: offer,
            onChange: setOffer,
            label: tr("expenses.all_offers"),
            options: offerOptions(ws),
          },
        ].map((filter) => (
          <Select key={filter.label} value={filter.value} onValueChange={filter.onChange}>
            <SelectTrigger className="w-full sm:w-44" aria-label={filter.label}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">{filter.label}</SelectItem>
                {filter.options.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        ))}
        <Select value={sort} onValueChange={setSort}>
          <SelectTrigger className="w-full sm:w-44" aria-label={tr("expenses.sort_by")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="date">{tr("expenses.sort_date")}</SelectItem>
              <SelectItem value="due">{tr("expenses.sort_due")}</SelectItem>
              <SelectItem value="amount">{tr("expenses.sort_amount")}</SelectItem>
              <SelectItem value="title">{tr("expenses.sort_title")}</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
        {(q ||
          status !== "all" ||
          bankFilter !== "all" ||
          source !== "all" ||
          trade !== "all" ||
          contact !== "all" ||
          offer !== "all") && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setQ("");
              setStatus("all");
              setBankFilter("all");
              setSource("all");
              setTrade("all");
              setContact("all");
              setOffer("all");
            }}
          >
            {tr("shared.reset")}
          </Button>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={!list.length}
          onClick={() =>
            setSelected((current) => new Set([...current, ...list.map((expense) => expense.id)]))
          }
        >
          {tr("expenses.select_filtered")}
        </Button>
        {selectedExpenses.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            {tr("expenses.clear_selection")}
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={!list.length || exporting}
          onClick={() => void download(list)}
        >
          {tr("expenses.download_filtered")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!selectedExpenses.length || exporting}
          onClick={() => void download(selectedExpenses)}
        >
          {tr("expenses.download_selected")}
        </Button>
        {selectedExpenses.length > 0 && (
          <span className="text-sm text-muted-foreground">
            {tr("expenses.download_count", { count: selectedExpenses.length })}
          </span>
        )}
      </div>

      <Panel>
        <div className="hidden overflow-x-auto md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <span className="sr-only">{tr("expenses.select_expense")}</span>
                </TableHead>
                <TableHead>{tr("shared.date")}</TableHead>
                <TableHead>{tr("shared.description")}</TableHead>
                <TableHead>
                  {tr("shared.category")} / {tr("shared.trade")}
                </TableHead>
                <TableHead>{tr("shared.paid_2")}</TableHead>
                <TableHead>{tr("shared.payable")}</TableHead>
                <TableHead className="text-right">{tr("shared.amount")}</TableHead>
                <TableHead>
                  {tr("expenses.payment_status")} / {tr("expenses.bank_status")}
                </TableHead>
                <TableHead>{tr("shared.receipt")}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody className="tabular">
              {list.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>
                    <Checkbox
                      aria-label={`${tr("expenses.select_expense")}: ${e.title}`}
                      checked={selected.has(e.id)}
                      onCheckedChange={(checked) => toggleSelected(e.id, checked === true)}
                    />
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{fmtDate(e.expense_date)}</TableCell>
                  <TableCell className="max-w-64">
                    <div className="truncate font-medium" title={e.title}>
                      {e.title}
                    </div>
                    {vendor(e) && (
                      <div className="truncate text-xs text-muted-foreground">
                        {e.contact_id ? (
                          <Link to="/kontakte" className="hover:underline">
                            {vendor(e)}
                          </Link>
                        ) : (
                          vendor(e)
                        )}
                      </div>
                    )}
                    {linkedOffer(e) && (
                      <Link
                        to="/angebote"
                        className="block truncate text-xs text-primary hover:underline"
                        title={linkedOffer(e)?.title ?? undefined}
                      >
                        {tr("shared.quote")}: {linkedOffer(e)?.title || linkedOffer(e)?.contractor}
                      </Link>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    <div>{e.category ? tr(e.category) : "–"}</div>
                    {e.trade_id && <div className="text-xs">{tradeName(ws, e.trade_id)}</div>}
                  </TableCell>
                  <TableCell>{potName(ws, e.budget_pot_id) ?? "–"}</TableCell>
                  <TableCell
                    className={
                      expenseIsOverdue(e, today)
                        ? "whitespace-nowrap text-destructive"
                        : "whitespace-nowrap"
                    }
                  >
                    {fmtDate(e.due_date ?? null)}
                  </TableCell>
                  <TableCell className="text-right">{eur(e.amount, true)}</TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <Select value={e.status} onValueChange={(v) => changeStatus(e, v)}>
                        <SelectTrigger
                          className="h-8 w-36"
                          aria-label={tr("expenses.change_status")}
                        >
                          {statusPill(e)}
                        </SelectTrigger>
                        <SelectContent>
                          {STATUS_OPTIONS.map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select
                        value={bankStatus(e)}
                        onValueChange={(value) => changeBankStatus(e, value)}
                      >
                        <SelectTrigger
                          className="h-8 w-36"
                          aria-label={`${tr("expenses.bank_status")}: ${e.title}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {Object.entries(BANK_STATUS).map(([value, label]) => (
                              <SelectItem key={value} value={value}>
                                {label}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </div>
                  </TableCell>
                  <TableCell>
                    {e.document_id ? (
                      <Button size="sm" variant="ghost" onClick={() => openDoc(e.document_id)}>
                        <FileText className="h-4 w-4" /> {tr("expenses.open")}
                      </Button>
                    ) : (
                      <span className="whitespace-nowrap text-xs text-muted-foreground">
                        {tr("expenses.no_receipt")}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={tr("expenses.split_action")}
                      title={tr("expenses.split_action")}
                      onClick={() => setSplitting(e)}
                    >
                      <Split className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={tr("shared.edit")}
                      onClick={() => setDlg({ id: e.id, initial: { ...e } })}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={tr("shared.delete")}
                      onClick={() =>
                        confirm(tr("expenses.delete_expense_receipt_stays")) &&
                        remove.mutate({ table: "expenses", id: e.id })
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            {list.length > 0 && (
              <TableFooter className="tabular">
                <TableRow>
                  <TableCell colSpan={6}>{tr("expenses.sum")}</TableCell>
                  <TableCell className="text-right">{eur(listTotal, true)}</TableCell>
                  <TableCell colSpan={3} />
                </TableRow>
              </TableFooter>
            )}
          </Table>
        </div>
        <div className="grid gap-3 md:hidden">
          {list.map((e) => (
            <article key={e.id} className="rounded-lg border p-3">
              <div className="mb-2 flex items-center gap-2">
                <Checkbox
                  aria-label={`${tr("expenses.select_expense")}: ${e.title}`}
                  checked={selected.has(e.id)}
                  onCheckedChange={(checked) => toggleSelected(e.id, checked === true)}
                />
                <span className="text-xs text-muted-foreground">
                  {tr("expenses.select_expense")}
                </span>
              </div>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="break-words font-medium">{e.title}</h3>
                  {vendor(e) && (
                    <p className="mt-0.5 break-words text-sm text-muted-foreground">{vendor(e)}</p>
                  )}
                  {linkedOffer(e) && (
                    <Link
                      to="/angebote"
                      className="mt-1 block truncate text-xs text-primary hover:underline"
                    >
                      {tr("shared.quote")}: {linkedOffer(e)?.title || linkedOffer(e)?.contractor}
                    </Link>
                  )}
                </div>
                <span className="shrink-0 text-right font-semibold tabular">
                  {eur(e.amount, true)}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <span>{fmtDate(e.expense_date)}</span>
                {e.category && <span>· {tr(e.category)}</span>}
                {tradeName(ws, e.trade_id) && <span>· {tradeName(ws, e.trade_id)}</span>}
                {potName(ws, e.budget_pot_id) && <span>· {potName(ws, e.budget_pot_id)}</span>}
              </div>
              {e.due_date && (
                <p
                  className={
                    expenseIsOverdue(e, today)
                      ? "mt-2 text-xs text-destructive"
                      : "mt-2 text-xs text-muted-foreground"
                  }
                >
                  {tr("shared.payable")}: {fmtDate(e.due_date)}
                </p>
              )}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-2">
                <Select value={e.status} onValueChange={(v) => changeStatus(e, v)}>
                  <SelectTrigger
                    className="h-8 w-40 text-xs"
                    aria-label={tr("expenses.change_status")}
                  >
                    {statusPill(e)}
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={bankStatus(e)} onValueChange={(value) => changeBankStatus(e, value)}>
                  <SelectTrigger
                    className="h-8 w-40 text-xs"
                    aria-label={`${tr("expenses.bank_status")}: ${e.title}`}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {Object.entries(BANK_STATUS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <div className="flex">
                  {e.document_id && (
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={tr("expenses.open")}
                      onClick={() => openDoc(e.document_id)}
                    >
                      <FileText className="h-4 w-4" />
                    </Button>
                  )}
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={tr("expenses.split_action")}
                    title={tr("expenses.split_action")}
                    onClick={() => setSplitting(e)}
                  >
                    <Split className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={tr("shared.edit")}
                    onClick={() => setDlg({ id: e.id, initial: { ...e } })}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={tr("shared.delete")}
                    onClick={() =>
                      confirm(tr("expenses.delete_expense_receipt_stays")) &&
                      remove.mutate({ table: "expenses", id: e.id })
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </article>
          ))}
        </div>
        {!list.length && (
          <Empty>
            {ws.expenses.length ? tr("shared.no_results") : tr("expenses.no_expenses_yet_upload")}
          </Empty>
        )}
        {list.length > 0 && (
          <div className="mt-3 flex justify-end border-t pt-3 text-sm font-medium tabular md:hidden">
            {tr("expenses.sum")}: {eur(listTotal, true)}
          </div>
        )}
      </Panel>

      <ExpenseDialog
        open={!!dlg}
        onOpenChange={(o) => !o && setDlg(null)}
        editId={dlg?.id}
        initial={dlg?.initial}
      />
      <ExpenseSplitDialog expense={splitting} onClose={() => setSplitting(null)} />
      <AlertDialog
        open={!!exported}
        onOpenChange={(open) => {
          if (!open) setExported(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tr("expenses.export_mark_title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {tr("expenses.export_mark_description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tr("expenses.export_not_mark")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void markExported();
              }}
            >
              {tr("expenses.export_mark")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function Stat({
  label,
  value,
  amount,
  tone,
  active,
  onClick,
}: {
  label: string;
  value: string;
  amount: number;
  tone: "neutral" | "warning" | "success" | "info" | "primary" | "danger";
  active?: boolean;
  onClick?: () => void;
}) {
  const empty = amount === 0;
  return (
    <MetricCard
      compact
      muted={empty}
      label={label}
      value={value}
      tone={empty ? "neutral" : tone}
      active={active}
      onClick={onClick}
    />
  );
}
