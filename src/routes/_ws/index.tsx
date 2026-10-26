import { tr } from "@/i18n";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, ListPlus, Plus, Sparkles, Upload } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useWorkspace } from "@/hooks/use-workspace";
import { isOverdue, summarize } from "@/lib/calc";
import { eur, fmtDate, todayISO } from "@/lib/format";
import { loadDemoData } from "@/lib/data.functions";
import { tradeName } from "@/lib/options";
import { Bar, Empty, PageHeader, Panel, Pill, PRIORITY } from "@/components/app/ui-bits";
import { Button } from "@/components/ui/button";
import { QuickTask, QuickCost, QuickUpload } from "@/components/app/quick-actions";
import { CreditSummaryCard } from "@/components/app/CreditCalculator";

export const Route = createFileRoute("/_ws/")({
  head: () => ({
    meta: [
      { title: tr("Übersicht – Bauplan") },
      {
        name: "description",
        content: tr("Fortschritt, Budget, offene Aufgaben und nächste Termine deiner Renovierung."),
      },
      { property: "og:title", content: tr("Übersicht – Bauplan") },
      {
        property: "og:description",
        content: tr("Fortschritt, Budget, offene Aufgaben und nächste Termine deiner Renovierung."),
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
    ...ws.events
      .filter((e) => e.event_date >= today)
      .map((e) => ({ id: e.id, title: e.title, date: e.event_date, kind: e.kind })),
    ...ws.tasks
      .filter((t) => t.due_date && t.due_date >= today && t.status !== "erledigt")
      .map((t) => ({ id: t.id, title: t.title, date: t.due_date!, kind: "aufgabe" })),
  ]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 6);
  const overBudget = s.trades.filter((t) => t.budget > 0 && t.deviation > 0);
  const budgetTone =
    s.expected > s.budget ? "danger" : s.expected > s.budget * 0.9 ? "warning" : "primary";

  const isEmpty = !ws.trades.length && !ws.cost_items.length && !ws.tasks.length;

  return (
    <>
      <PageHeader
        title={project?.name ?? tr("Übersicht")}
        subtitle={
          project?.start_date
            ? `${fmtDate(project.start_date)} – ${fmtDate(project.end_date)}`
            : undefined
        }
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setDlg("cost")}>
              <Plus className="h-4 w-4" /> {tr("Kosten")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setDlg("upload")}>
              <Upload className="h-4 w-4" /> {tr("Dokument")}
            </Button>
            <Button size="sm" onClick={() => setDlg("task")}>
              <ListPlus className="h-4 w-4" /> {tr("Aufgabe")}
            </Button>
          </>
        }
      />

      {isEmpty && (
        <Panel className="mb-6 border-primary/30 bg-accent/40">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">
              {tr(
                "Noch leer. Lege Gewerke im Budget an – oder schau dir zuerst ein Beispielprojekt an.",
              )}
            </p>
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                await loadDemoData();
                await qc.invalidateQueries({ queryKey: ["ws"] });
                toast.success(tr("Beispieldaten geladen"));
              }}
            >
              <Sparkles className="h-4 w-4" /> {tr("Beispieldaten laden")}
            </Button>
          </div>
        </Panel>
      )}

      <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label={tr("Gesamtbudget")} value={eur(s.budget)} />
        <Kpi
          label={tr("Voraussichtliche Kosten")}
          value={eur(s.expected)}
          hint={
            s.remaining >= 0 ? `${eur(s.remaining)} Puffer` : `${eur(-s.remaining)} über Budget`
          }
          tone={s.remaining < 0 ? "danger" : undefined}
        />
        <Kpi
          label={tr("Bezahlt")}
          value={eur(s.paid)}
          hint={s.open > 0 ? `${eur(s.open)} offene Rechnungen` : tr("Keine offenen Rechnungen")}
        />
        <Kpi
          label={tr("Fortschritt")}
          value={`${progress} %`}
          hint={`${done} von ${ws.tasks.length} Aufgaben erledigt`}
        />
      </div>

      <CreditSummaryCard />

      <div className="mt-6 grid min-w-0 items-start gap-5 lg:grid-cols-3">
        <Panel
          title={tr("Budget")}
          className="lg:col-span-2"
          action={
            <Link to="/budget" className="text-sm text-primary hover:underline">
              {tr("Details")}
            </Link>
          }
        >
          <div className="mb-4">
            <div className="mb-2 flex flex-wrap justify-between gap-x-3 gap-y-1 text-sm">
              <span>Voraussichtlich {eur(s.expected)}</span>
              <span className="text-muted-foreground">von {eur(s.budget)}</span>
            </div>
            <Bar value={s.expected} max={s.budget} tone={budgetTone} />
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground tabular">
              <span>Geplant {eur(s.planned)}</span>
              <span>Beauftragt {eur(s.committed)}</span>
              <span>Bezahlt {eur(s.paid)}</span>
            </div>
          </div>
          <div className="mt-6 grid gap-5">
            {s.trades.map((t) => (
              <div key={t.id}>
                <div className="mb-2 flex flex-wrap justify-between gap-x-3 gap-y-1 text-sm">
                  <span>{t.name}</span>
                  <span className="tabular text-muted-foreground">
                    {eur(t.expected)} / {eur(t.budget)}
                  </span>
                </div>
                <Bar
                  value={t.expected}
                  max={t.budget}
                  tone={t.deviation > 0 ? "danger" : "primary"}
                />
              </div>
            ))}
            {!s.trades.length && <Empty>{tr("Noch keine Gewerke angelegt.")}</Empty>}
          </div>
        </Panel>

        <div className="grid min-w-0 content-start gap-4">
          {(overdue.length > 0 || overBudget.length > 0) && (
            <Panel title={tr("Achtung")} className="border-l-2 border-destructive">
              <ul className="grid gap-2 text-sm">
                {overdue.map((t) => (
                  <li key={t.id} className="flex gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                    <span>
                      <b className="font-medium">{t.title}</b> überfällig seit {fmtDate(t.due_date)}
                    </span>
                  </li>
                ))}
                {overBudget.map((t) => (
                  <li key={t.id} className="flex gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                    <span>
                      <b className="font-medium">{t.name}</b> {eur(t.deviation)} über Budget
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          <Panel
            title={tr("Als Nächstes")}
            action={
              <Link to="/kalender" className="text-sm text-primary hover:underline">
                {tr("Kalender")}
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
              {!upcoming.length && <Empty>{tr("Keine anstehenden Termine.")}</Empty>}
            </ul>
          </Panel>
        </div>
      </div>

      <Panel
        title={tr("Offene Aufgaben")}
        className="mt-6"
        action={
          <Link to="/aufgaben" className="text-sm text-primary hover:underline">
            {tr("Alle")}
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
          {!open.length && <Empty>{tr("Alles erledigt.")}</Empty>}
        </ul>
      </Panel>

      <QuickTask open={dlg === "task"} onOpenChange={(o) => setDlg(o ? "task" : null)} />
      <QuickCost open={dlg === "cost"} onOpenChange={(o) => setDlg(o ? "cost" : null)} />
      <QuickUpload open={dlg === "upload"} onOpenChange={(o) => setDlg(o ? "upload" : null)} />
    </>
  );
}

function Kpi({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "danger" | undefined;
}) {
  return (
    <div className="min-w-0 rounded-xl bg-card p-5 shadow-card md:p-6">
      <div className="text-sm font-medium text-muted-foreground">{label}</div>
      <div
        className={`mt-3 font-display text-3xl font-semibold tracking-tight tabular ${tone === "danger" ? "text-destructive" : ""}`}
      >
        {value}
      </div>
      {hint && (
        <div
          className={`mt-2 text-sm ${tone === "danger" ? "text-destructive" : "text-muted-foreground"}`}
        >
          {hint}
        </div>
      )}
    </div>
  );
}
