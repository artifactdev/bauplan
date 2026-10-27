import { tr } from "@/i18n";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useMutations, useWorkspace } from "@/hooks/use-workspace";
import { summarize, type ItemSummary } from "@/lib/calc";
import { eur } from "@/lib/format";
import { tradeName, tradeOptions } from "@/lib/options";
import { Bar, Empty, PageHeader, Panel } from "@/components/app/ui-bits";
import { ProjectDialog } from "@/components/app/ProjectDialog";
import { QuickCost } from "@/components/app/quick-actions";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
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

export const Route = createFileRoute("/_ws/budget")({
  head: () => ({
    meta: [
      { title: tr("budget.budget_bauplan") },
      { name: "description", content: tr("budget.cost_item_budget") },
      { property: "og:title", content: tr("budget.budget_bauplan") },
      { property: "og:description", content: tr("budget.cost_item_budget") },
    ],
  }),
  component: BudgetPage,
});

const ALL = "__all";
const NO_TRADE = "__no_trade";
type Stage = "planned" | "committed" | "invoiced" | "paid";
type SortKey = "title" | "trade" | Stage | "expected";
const STAGES: { key: Stage; label: string }[] = [
  { key: "planned", label: tr("budget.planned") },
  { key: "committed", label: tr("budget.committed") },
  { key: "invoiced", label: tr("budget.invoiced") },
  { key: "paid", label: tr("shared.paid") },
];
const COLUMNS: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: "title", label: tr("budget.item") },
  { key: "trade", label: tr("shared.trade") },
  { key: "planned", label: tr("budget.planned"), numeric: true },
  { key: "committed", label: tr("budget.committed"), numeric: true },
  { key: "invoiced", label: tr("budget.invoiced"), numeric: true },
  { key: "paid", label: tr("shared.paid"), numeric: true },
  { key: "expected", label: tr("budget.expected"), numeric: true },
];

type SortValue = string | number;

function compare(a: SortValue, b: SortValue) {
  return typeof a === "number" && typeof b === "number"
    ? a - b
    : String(a).localeCompare(String(b), "de");
}

function hasStage(item: ItemSummary, stage: Stage) {
  return item[stage] > 0;
}

function isStage(value: string): value is Stage {
  return STAGES.some((stage) => stage.key === value);
}

function isSortKey(value: string): value is SortKey {
  return COLUMNS.some((column) => column.key === value);
}

function BudgetPage() {
  const { ws } = useWorkspace();
  const { remove } = useMutations();
  const summary = useMemo(() => summarize(ws), [ws]);
  const project = ws.projects[0];
  const [costDlg, setCostDlg] = useState<{ id?: string; initial?: Record<string, unknown> } | null>(
    null,
  );
  const [budgetDlg, setBudgetDlg] = useState(false);
  const [filterTrade, setFilterTrade] = useState(ALL);
  const [filterStage, setFilterStage] = useState<typeof ALL | Stage>(ALL);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({
    key: "title",
    dir: 1,
  });

  const filteredItems = useMemo(() => {
    const items = summary.items.filter((item) => {
      const matchesTrade =
        filterTrade === ALL ||
        (filterTrade === NO_TRADE ? !item.trade_id : item.trade_id === filterTrade);
      const matchesStage = filterStage === ALL || hasStage(item, filterStage);
      return matchesTrade && matchesStage;
    });
    const sortValue = (item: ItemSummary): SortValue => {
      switch (sort.key) {
        case "title":
          return item.title;
        case "trade":
          return item.trade_id ? tradeName(ws, item.trade_id) : "";
        default:
          return item[sort.key];
      }
    };
    return items.sort((a, b) => sort.dir * compare(sortValue(a), sortValue(b)));
  }, [filterStage, filterTrade, sort, summary.items, ws]);

  const totals = filteredItems.reduce(
    (result, item) => ({
      planned: result.planned + item.planned,
      committed: result.committed + item.committed,
      invoiced: result.invoiced + item.invoiced,
      paid: result.paid + item.paid,
      expected: result.expected + item.expected,
    }),
    { planned: 0, committed: 0, invoiced: 0, paid: 0, expected: 0 },
  );
  const budgetShare =
    summary.budget > 0 ? Math.round((summary.expected / summary.budget) * 100) : null;
  const filtersActive = filterTrade !== ALL || filterStage !== ALL;
  const changeSort = (key: SortKey) =>
    setSort((current) => ({
      key,
      dir: current.key === key ? (current.dir === 1 ? -1 : 1) : 1,
    }));
  const editCostItem = (item: ItemSummary) => {
    const costItem = ws.cost_items.find((candidate) => candidate.id === item.id);
    if (!costItem) return;
    setCostDlg({
      id: item.id,
      initial: {
        title: costItem.title,
        trade_id: costItem.trade_id,
        planned: costItem.planned,
        description: costItem.description,
      },
    });
  };
  const deleteCostItem = (item: ItemSummary) => {
    if (confirm(tr("budget.delete_cost_item", { name: item.title })))
      remove.mutate({ table: "cost_items", id: item.id });
  };

  return (
    <>
      <PageHeader
        title={tr("shared.budget")}
        subtitle={tr("budget.cost_positions_explain")}
        actions={
          <Button size="sm" onClick={() => setCostDlg({})}>
            <Plus className="h-4 w-4" /> {tr("shared.new_cost_item")}
          </Button>
        }
      />

      <Panel
        title={tr("shared.total_budget")}
        className="mb-4"
        action={
          <Button
            variant="ghost"
            size="icon"
            aria-label={tr("budget.edit_budget")}
            onClick={() => setBudgetDlg(true)}
          >
            <Pencil className="h-4 w-4" />
          </Button>
        }
      >
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,1.3fr)]">
          <div>
            <div className="font-display text-3xl font-semibold tabular">{eur(summary.budget)}</div>
            {summary.budget > 0 ? (
              <>
                <div className="mt-3">
                  <Bar
                    value={summary.expected}
                    max={summary.budget}
                    tone={summary.remaining < 0 ? "danger" : "primary"}
                    color="expected"
                  />
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  {tr("budget.expected")}:{" "}
                  <span className="font-medium tabular text-foreground">
                    {eur(summary.expected)}
                  </span>
                  <span className="mx-1.5">·</span>
                  <span>
                    {budgetShare}% {tr("budget.used")}
                  </span>
                </p>
              </>
            ) : (
              <p className="mt-3 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
                {tr("budget.budget_not_set")}
              </p>
            )}
          </div>
          <dl className="grid grid-cols-2 content-start gap-x-4 gap-y-2 text-sm tabular">
            <dt className="text-muted-foreground">{tr("budget.planned")}</dt>
            <dd className="text-right">{eur(summary.planned)}</dd>
            <dt className="text-muted-foreground">{tr("budget.committed")}</dt>
            <dd className="text-right">{eur(summary.committed)}</dd>
            <dt className="text-muted-foreground">{tr("budget.invoiced")}</dt>
            <dd className="text-right">{eur(summary.invoiced)}</dd>
            <dt className="text-muted-foreground">{tr("budget.expenses_receipts")}</dt>
            <dd className="text-right">{eur(summary.expensesTotal)}</dd>
            <dt className="text-muted-foreground">{tr("shared.paid")}</dt>
            <dd className="text-right">{eur(summary.paid)}</dd>
            <dt className="font-medium">{tr("budget.expected")}</dt>
            <dd className="text-right font-medium">{eur(summary.expected)}</dd>
            <dt className="font-medium">{tr("budget.remaining")}</dt>
            <dd
              className={`text-right font-medium ${summary.remaining < 0 ? "text-destructive" : "text-success"}`}
            >
              {summary.budget > 0 ? eur(summary.remaining) : "–"}
            </dd>
          </dl>
        </div>
      </Panel>

      <Panel title={tr("budget.cost_items")}>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Select value={filterTrade} onValueChange={setFilterTrade}>
            <SelectTrigger className="w-full sm:w-56" aria-label={tr("shared.trade")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{tr("budget.all_trades")}</SelectItem>
              <SelectItem value={NO_TRADE}>{tr("budget.no_trade")}</SelectItem>
              {tradeOptions(ws).map((trade) => (
                <SelectItem key={trade.value} value={trade.value}>
                  {trade.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filterStage}
            onValueChange={(value) => setFilterStage(isStage(value) ? value : ALL)}
          >
            <SelectTrigger className="w-full sm:w-56" aria-label={tr("budget.cost_stage")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{tr("budget.all_stages")}</SelectItem>
              {STAGES.map((stage) => (
                <SelectItem key={stage.key} value={stage.key}>
                  {stage.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={sort.key}
            onValueChange={(value) => {
              if (isSortKey(value)) setSort((current) => ({ ...current, key: value }));
            }}
          >
            <SelectTrigger className="w-full sm:w-56" aria-label={tr("budget.sort_by_label")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COLUMNS.map((column) => (
                <SelectItem key={column.key} value={column.key}>
                  {column.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="icon"
            variant="outline"
            aria-label={tr("budget.reverse_sort")}
            title={tr("budget.reverse_sort")}
            onClick={() => setSort((current) => ({ ...current, dir: current.dir === 1 ? -1 : 1 }))}
          >
            {sort.dir === 1 ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
          </Button>
          {filtersActive && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setFilterTrade(ALL);
                setFilterStage(ALL);
              }}
            >
              <RotateCcw className="h-4 w-4" /> {tr("shared.reset")}
            </Button>
          )}
          <p className="ml-auto text-sm text-muted-foreground">
            {tr("budget.items_showing", {
              shown: filteredItems.length,
              total: summary.items.length,
            })}
          </p>
        </div>

        {filteredItems.length ? (
          <>
            <div className="hidden overflow-x-auto md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    {COLUMNS.map((column) => (
                      <TableHead key={column.key} className={column.numeric ? "text-right" : ""}>
                        <button
                          type="button"
                          className={`inline-flex items-center gap-1 hover:text-foreground ${column.numeric ? "ml-auto" : ""}`}
                          aria-label={tr("budget.sort_by", { label: column.label })}
                          onClick={() => changeSort(column.key)}
                        >
                          {column.label}
                          {sort.key === column.key ? (
                            sort.dir === 1 ? (
                              <ArrowUp className="h-3 w-3" />
                            ) : (
                              <ArrowDown className="h-3 w-3" />
                            )
                          ) : (
                            <ArrowUpDown className="h-3 w-3 opacity-40" />
                          )}
                        </button>
                      </TableHead>
                    ))}
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody className="tabular">
                  {filteredItems.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">{item.title}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {item.trade_id ? tradeName(ws, item.trade_id) : "–"}
                      </TableCell>
                      <TableCell className="text-right">{eur(item.planned)}</TableCell>
                      <TableCell className="text-right">
                        {item.committed ? eur(item.committed) : "–"}
                      </TableCell>
                      <TableCell className="text-right">
                        {item.invoiced ? eur(item.invoiced) : "–"}
                      </TableCell>
                      <TableCell className="text-right">
                        {item.paid ? eur(item.paid) : "–"}
                      </TableCell>
                      <TableCell
                        className={`text-right font-medium ${item.expected > item.planned ? "text-destructive" : ""}`}
                      >
                        {eur(item.expected)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={tr("shared.edit")}
                          onClick={() => editCostItem(item)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={tr("shared.delete")}
                          onClick={() => deleteCostItem(item)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter className="tabular">
                  <TableRow>
                    <TableCell colSpan={2}>{tr("budget.sum_filtered_items")}</TableCell>
                    <TableCell className="text-right">{eur(totals.planned)}</TableCell>
                    <TableCell className="text-right">{eur(totals.committed)}</TableCell>
                    <TableCell className="text-right">{eur(totals.invoiced)}</TableCell>
                    <TableCell className="text-right">{eur(totals.paid)}</TableCell>
                    <TableCell className="text-right">{eur(totals.expected)}</TableCell>
                    <TableCell />
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
            <div className="grid gap-3 md:hidden">
              {filteredItems.map((item) => (
                <article key={item.id} className="rounded-lg border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="break-words font-medium">{item.title}</h3>
                      {item.trade_id && (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {tradeName(ws, item.trade_id)}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={tr("shared.edit")}
                        onClick={() => editCostItem(item)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={tr("shared.delete")}
                        onClick={() => deleteCostItem(item)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <dl className="mt-2 grid grid-cols-2 gap-y-2 text-sm tabular">
                    <dt className="text-muted-foreground">{tr("budget.planned")}</dt>
                    <dd className="text-right">{eur(item.planned)}</dd>
                    <dt className="text-muted-foreground">{tr("budget.committed")}</dt>
                    <dd className="text-right">{item.committed ? eur(item.committed) : "–"}</dd>
                    <dt className="text-muted-foreground">{tr("budget.invoiced")}</dt>
                    <dd className="text-right">{item.invoiced ? eur(item.invoiced) : "–"}</dd>
                    <dt className="text-muted-foreground">{tr("shared.paid")}</dt>
                    <dd className="text-right">{item.paid ? eur(item.paid) : "–"}</dd>
                    <dt className="font-medium">{tr("budget.expected")}</dt>
                    <dd
                      className={`text-right font-medium ${item.expected > item.planned ? "text-destructive" : ""}`}
                    >
                      {eur(item.expected)}
                    </dd>
                  </dl>
                </article>
              ))}
              <div className="flex justify-between border-t pt-3 text-sm font-medium tabular">
                <span>{tr("budget.sum_filtered_items")}</span>
                <span>{eur(totals.expected)}</span>
              </div>
            </div>
          </>
        ) : summary.items.length ? (
          <Empty>{tr("budget.no_items_match_filters")}</Empty>
        ) : (
          <Empty>{tr("budget.no_cost_items_yet")}</Empty>
        )}
      </Panel>

      <QuickCost
        open={!!costDlg}
        onOpenChange={(open) => !open && setCostDlg(null)}
        initial={costDlg?.initial}
        editId={costDlg?.id}
      />
      {project && <ProjectDialog project={project} open={budgetDlg} onOpenChange={setBudgetDlg} />}
    </>
  );
}
