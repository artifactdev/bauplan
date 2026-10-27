import { tr } from "@/i18n";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ListPlus,
  Plus,
  Sparkles,
  TrendingUp,
  Upload,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useWorkspace } from "@/hooks/use-workspace";
import { isOverdue, summarize } from "@/lib/calc";
import { eur, fmtDate, todayISO } from "@/lib/format";
import { loadDemoData } from "@/lib/data.functions";
import { tradeName } from "@/lib/options";
import { offerDeadlines } from "@/lib/offer-deadlines";
import {
  Bar,
  Empty,
  MetricCard,
  PageHeader,
  Panel,
  Pill,
  PRIORITY,
} from "@/components/app/ui-bits";
import { Button } from "@/components/ui/button";
import { QuickTask, QuickCost, QuickUpload } from "@/components/app/quick-actions";
import { CreditSummaryCard } from "@/components/app/CreditCalculator";

export const Route = createFileRoute("/_ws/")({
  head: () => ({
    meta: [
      { title: tr("index.overview_bauplan") },
      {
        name: "description",
        content: tr("index.progress_budget_open_tasks"),
      },
      { property: "og:title", content: tr("index.overview_bauplan") },
      {
        property: "og:description",
        content: tr("index.progress_budget_open_tasks"),
      },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { ws } = useWorkspace();
  const qc = useQueryClient();
  const [dlg, setDlg] = useState<null | "task" | "cost" | "upload">(null);
  const s = useMemo(() => summarize(ws), [ws]);
  const today = todayISO();
  const project = ws.projects[0];
  const done = ws.tasks.filter((t) => t.status === "erledigt").length;
  const progress = ws.tasks.length ? Math.round((done / ws.tasks.length) * 100) : 0;
  const overdue = ws.tasks.filter((t) => isOverdue(t.due_date, t.status === "erledigt"));
  const open = ws.tasks
    .filter((t) => t.status !== "erledigt")
    .sort((a, b) => (a.due_date ?? "9").localeCompare(b.due_date ?? "9"));
  const upcoming = [
    ...offerDeadlines(ws.offers)
      .filter((e) => e.event_date >= today)
      .map((e) => ({ id: e.id, title: e.title, date: e.event_date, kind: e.kind })),
    ...ws.events
      .filter((e) => e.event_date >= today)
      .map((e) => ({ id: e.id, title: e.title, date: e.event_date, kind: e.kind })),
    ...ws.tasks
      .filter((t) => t.due_date && t.due_date >= today && t.status !== "erledigt")
      .map((t) => ({ id: t.id, title: t.title, date: t.due_date!, kind: "aufgabe" })),
  ]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 6);
  const overBudget = s.budget > 0 && s.expected > s.budget;
  const topCostItems = [...s.items].sort((a, b) => b.expected - a.expected).slice(0, 5);
  const budgetTone =
    s.budget > 0 && s.expected > s.budget
      ? "danger"
      : s.budget > 0 && s.expected > s.budget * 0.9
        ? "warning"
        : "primary";

  const isEmpty = !ws.cost_items.length && !ws.tasks.length;

  return (
    <>
      <PageHeader
        title={project?.name ?? tr("shared.overview")}
        subtitle={
          project?.start_date
            ? `${fmtDate(project.start_date)} – ${fmtDate(project.end_date)}`
            : undefined
        }
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setDlg("cost")}>
              <Plus className="h-4 w-4" /> {tr("index.cost")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setDlg("upload")}>
              <Upload className="h-4 w-4" /> {tr("shared.document")}
            </Button>
            <Button size="sm" onClick={() => setDlg("task")}>
              <ListPlus className="h-4 w-4" /> {tr("shared.task")}
            </Button>
          </>
        }
      />

      {isEmpty && (
        <Panel className="mb-6 border-primary/30 bg-accent/40">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">{tr("index.still_empty_create_trades")}</p>
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                await loadDemoData();
                await qc.invalidateQueries({ queryKey: ["ws"] });
                toast.success(tr("index.sample_data_loaded"));
              }}
            >
              <Sparkles className="h-4 w-4" /> {tr("index.load_sample_data")}
            </Button>
          </div>
        </Panel>
      )}

      <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label={tr("shared.total_budget")}
          value={eur(s.budget)}
          hint={s.budget > 0 ? undefined : tr("index.budget_not_set")}
          icon={<Wallet className="h-4 w-4" />}
        />
        <MetricCard
          label={tr("index.expected_costs")}
          value={eur(s.expected)}
          hint={
            s.budget <= 0
              ? tr("index.budget_not_set")
              : `${Math.round((s.expected / s.budget) * 100)} % · ${s.remaining >= 0 ? `${eur(s.remaining)} ${tr("budget.remaining").toLowerCase()}` : `${eur(-s.remaining)} ${tr("index.over_budget")}`}`
          }
          tone={
            s.budget > 0 && s.remaining < 0
              ? "danger"
              : s.budget > 0 && s.expected > s.budget * 0.9
                ? "warning"
                : "primary"
          }
          icon={<TrendingUp className="h-4 w-4" />}
        />
        <MetricCard
          label={tr("shared.paid")}
          value={eur(s.paid)}
          hint={s.open > 0 ? `${eur(s.open)} offene Rechnungen` : tr("index.no_open_invoices")}
          tone="success"
          icon={<CheckCircle2 className="h-4 w-4" />}
        />
        <MetricCard
          label={tr("index.progress")}
          value={ws.tasks.length ? `${progress} %` : "–"}
          hint={
            ws.tasks.length
              ? tr("index.tasks_completed", { done, total: ws.tasks.length })
              : tr("tasks.no_tasks_yet")
          }
          tone="info"
          icon={<ListPlus className="h-4 w-4" />}
        />
      </div>

      <div className="mt-6 grid min-w-0 items-start gap-5 lg:grid-cols-3">
        <Panel
          title={tr("shared.budget")}
          className="lg:col-span-2"
          action={
            <Link to="/budget" className="text-sm text-primary hover:underline">
              {tr("index.details")}
            </Link>
          }
        >
          <div className="mb-4">
            <div className="mb-2 flex flex-wrap justify-between gap-x-3 gap-y-1 text-sm">
              <span>
                {tr("budget.expected")} {eur(s.expected)}
              </span>
              {s.budget > 0 && (
                <span className="text-muted-foreground">
                  {tr("shared.from")} {eur(s.budget)}
                </span>
              )}
            </div>
            {s.budget > 0 ? (
              <Bar value={s.expected} max={s.budget} tone={budgetTone} color="expected" />
            ) : (
              <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
                {tr("index.budget_not_set")}
              </p>
            )}
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground tabular">
              <span className="inline-flex items-center gap-1.5">
                <i
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: "var(--finance-planned)" }}
                />
                {tr("budget.planned")} {eur(s.planned)}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <i
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: "var(--finance-committed)" }}
                />
                {tr("budget.committed")} {eur(s.committed)}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <i
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: "var(--finance-paid)" }}
                />
                {tr("shared.paid")} {eur(s.paid)}
              </span>
            </div>
          </div>
          <div className="mt-6">
            <h2 className="mb-3 text-sm font-medium">{tr("budget.top_cost_items")}</h2>
            <div className="grid gap-5">
              {topCostItems.map((item) => (
                <div key={item.id}>
                  <div className="mb-2 flex flex-wrap justify-between gap-x-3 gap-y-1 text-sm">
                    <span className="min-w-0">
                      {item.title}
                      {item.trade_id && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {tradeName(ws, item.trade_id)}
                        </span>
                      )}
                    </span>
                    <span className="tabular text-muted-foreground">{eur(item.expected)}</span>
                  </div>
                  <Bar
                    value={item.expected}
                    max={Math.max(item.planned, item.expected, 1)}
                    tone={item.expected > item.planned ? "warning" : "primary"}
                    color="expected"
                  />
                </div>
              ))}
              {!topCostItems.length && <Empty>{tr("budget.no_cost_items_yet")}</Empty>}
            </div>
          </div>
        </Panel>

        <div className="grid min-w-0 content-start gap-4">
          {(overdue.length > 0 || overBudget) && (
            <Panel title={tr("index.attention")} className="border-l-2 border-destructive">
              <ul className="grid gap-2 text-sm">
                {overdue.map((t) => (
                  <li key={t.id} className="flex gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                    <span>
                      <b className="font-medium">{t.title}</b> überfällig seit {fmtDate(t.due_date)}
                    </span>
                  </li>
                ))}
                {overBudget && (
                  <li key="budget-overrun" className="flex gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                    <span>
                      {tr("index.budget_overrun", { amount: eur(s.expected - s.budget) })}
                    </span>
                  </li>
                )}
              </ul>
            </Panel>
          )}
          <Panel
            title={tr("index.up_next")}
            action={
              <Link to="/kalender" className="text-sm text-primary hover:underline">
                {tr("shared.calendar")}
              </Link>
            }
          >
            <ul className="grid gap-2">
              {upcoming.map((u) => (
                <li key={u.id} className="flex items-center gap-3 text-sm">
                  <CalendarClock className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="flex-1 truncate">{u.title}</span>
                  <span className="tabular text-xs text-muted-foreground">{fmtDate(u.date)}</span>
                </li>
              ))}
              {!upcoming.length && <Empty>{tr("index.no_upcoming_appointments")}</Empty>}
            </ul>
          </Panel>
        </div>
      </div>

      <Panel
        title={tr("index.open_tasks")}
        className="mt-6"
        action={
          <Link to="/aufgaben" className="text-sm text-primary hover:underline">
            {tr("shared.all")}
          </Link>
        }
      >
        <ul className="divide-y">
          {open.slice(0, 6).map((t) => {
            const od = isOverdue(t.due_date, false);
            return (
              <li key={t.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <span className="min-w-0 flex-1">{t.title}</span>
                <span className="text-xs text-muted-foreground">{tradeName(ws, t.trade_id)}</span>
                <Pill tone={PRIORITY[t.priority]?.tone}>{PRIORITY[t.priority]?.label}</Pill>
                <span
                  className={`tabular text-xs ${od ? "font-medium text-destructive" : "text-muted-foreground"}`}
                >
                  {fmtDate(t.due_date)}
                </span>
              </li>
            );
          })}
          {!open.length && (
            <Empty>
              {ws.tasks.length ? (
                tr("index.all_done")
              ) : (
                <div className="grid justify-items-center gap-3">
                  <span>{tr("tasks.no_tasks_yet")}</span>
                  <Button size="sm" onClick={() => setDlg("task")}>
                    <Plus className="h-4 w-4" /> {tr("tasks.create_first_task")}
                  </Button>
                </div>
              )}
            </Empty>
          )}
        </ul>
      </Panel>

      <CreditSummaryCard />

      <QuickTask open={dlg === "task"} onOpenChange={(o) => setDlg(o ? "task" : null)} />
      <QuickCost open={dlg === "cost"} onOpenChange={(o) => setDlg(o ? "cost" : null)} />
      <QuickUpload open={dlg === "upload"} onOpenChange={(o) => setDlg(o ? "upload" : null)} />
    </>
  );
}
