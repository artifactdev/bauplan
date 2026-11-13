import { Link } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { tr } from "@/i18n";
import {
  budgetStatus,
  dataQuality,
  dueBuckets,
  expiringOffers,
  ledgerTotals,
  planVsForecast,
  reimbursementFunnel,
  taskProgress,
} from "@/lib/analysis";
import { eur } from "@/lib/format";
import { BudgetBreakdown, MetricCard, Panel, Pill } from "@/components/app/ui-bits";
import { pct } from "./shared";
import type { AnalysisContext } from "./types";

type Insight = { tone: "danger" | "warning" | "info" | "success"; text: string };

export function OverviewSection({ ctx }: { ctx: AnalysisContext }) {
  const { ws, summary, ledger, offers, tasks, today, filters } = ctx;
  const totals = ledgerTotals(ledger);
  const funnel = reimbursementFunnel(ledger);
  const due = dueBuckets(ledger, today);
  const status = budgetStatus(summary.budget, summary.budgetExpected);
  const progress = taskProgress(tasks, () => "all", today)[0];
  const quality = dataQuality(ledger, { cost_items: ws.cost_items, offers });
  const rows = planVsForecast(summary.items, filters);
  const overrun = rows
    .filter((row) => row.planned > 0 && row.variance > 0)
    .sort((a, b) => b.variance - a.variance)[0];
  const expiring = expiringOffers(offers, today);

  const insights: Insight[] = [];
  if (status === "over")
    insights.push({
      tone: "danger",
      text: tr("analysis.insight_over_budget", {
        amount: eur(summary.budgetExpected - summary.budget),
      }),
    });
  else if (status === "tight")
    insights.push({
      tone: "warning",
      text: tr("analysis.insight_tight", { amount: eur(summary.remaining) }),
    });
  if (overrun)
    insights.push({
      tone: "warning",
      text: tr("analysis.insight_overrun", {
        name: overrun.title,
        amount: eur(overrun.variance),
        pct: overrun.variancePct === null ? "–" : pct(overrun.variancePct),
      }),
    });
  if (due.overdue > 0)
    insights.push({
      tone: "danger",
      text: tr("analysis.insight_overdue", { amount: eur(due.overdue, true) }),
    });
  if (funnel.rejected > 0)
    insights.push({
      tone: "warning",
      text: tr("analysis.insight_rejected", { amount: eur(funnel.rejected, true) }),
    });
  if (funnel.pending > 0)
    insights.push({
      tone: "info",
      text: tr("analysis.insight_pending", { amount: eur(funnel.pending, true) }),
    });
  if (expiring.length > 0)
    insights.push({
      tone: "warning",
      text: tr("analysis.insight_expiring", { count: expiring.length }),
    });
  if (progress && progress.overdue > 0)
    insights.push({
      tone: "danger",
      text: tr("analysis.insight_tasks_overdue", { count: progress.overdue }),
    });
  if (insights.length === 0)
    insights.push({ tone: "success", text: tr("analysis.insight_all_good") });

  const qualityRows = [
    {
      label: tr("analysis.q_no_cost_item"),
      count: quality.noCostItem.length,
      to: "/ausgaben" as const,
    },
    {
      label: tr("analysis.q_no_receipt"),
      count: quality.noReceipt.length,
      to: "/ausgaben" as const,
    },
    { label: tr("analysis.q_no_source"), count: quality.noSource.length, to: "/ausgaben" as const },
    { label: tr("analysis.q_no_plan"), count: quality.noPlan.length, to: "/budget" as const },
    {
      label: tr("analysis.q_offers_no_trade"),
      count: quality.offersWithoutTrade.length,
      to: "/angebote" as const,
    },
  ];

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 sm:gap-4">
        <MetricCard
          label={tr("shared.total_budget")}
          value={eur(summary.budget)}
          hint={
            summary.budget > 0
              ? tr("analysis.hint_budget_split", {
                  bank: eur(summary.bankBudget),
                  extra: eur(summary.additionalFunding),
                })
              : tr("index.budget_not_set")
          }
        />
        <MetricCard
          label={tr("budget.expected_from_budget")}
          value={eur(summary.budgetExpected)}
          hint={
            summary.budget > 0
              ? summary.remaining >= 0
                ? `${eur(summary.remaining)} ${tr("budget.remaining").toLowerCase()}`
                : `${eur(-summary.remaining)} ${tr("index.over_budget")}`
              : undefined
          }
          tone={status === "over" ? "danger" : status === "tight" ? "warning" : "primary"}
        />
        <MetricCard
          label={tr("analysis.kpi_paid")}
          value={eur(totals.paid)}
          hint={tr("analysis.hint_entries", { count: totals.count })}
          tone="success"
        />
        <MetricCard
          label={tr("analysis.kpi_open")}
          value={eur(totals.open)}
          hint={
            due.overdue > 0
              ? tr("analysis.hint_overdue", { amount: eur(due.overdue) })
              : tr("index.no_open_invoices")
          }
          tone={due.overdue > 0 ? "danger" : "warning"}
        />
        <MetricCard
          label={tr("analysis.kpi_reimbursement_rate")}
          value={pct(funnel.rate)}
          hint={
            funnel.rate === null
              ? tr("analysis.hint_no_decisions")
              : tr("analysis.hint_reimbursed", { amount: eur(funnel.reimbursed) })
          }
          tone="info"
        />
        <MetricCard
          label={tr("shared.tasks")}
          value={progress ? pct(progress.done / progress.total) : "–"}
          hint={
            progress
              ? tr("analysis.hint_tasks", {
                  open: progress.total - progress.done,
                  overdue: progress.overdue,
                })
              : tr("tasks.no_tasks_yet")
          }
          tone="info"
        />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-5">
        {summary.budget > 0 && (
          <Panel className="lg:col-span-3" title={tr("shared.budget")}>
            <BudgetBreakdown
              budget={summary.budget}
              expected={summary.budgetExpected}
              paid={summary.budgetPaid}
            />
            <p className="mt-3 text-xs text-muted-foreground">
              {tr("analysis.budget_unfiltered_note")}
            </p>
          </Panel>
        )}
        <Panel
          className={summary.budget > 0 ? "lg:col-span-2" : "lg:col-span-5"}
          title={tr("analysis.insights")}
        >
          <ul className="grid gap-2.5 text-sm">
            {insights.map((insight, index) => (
              <li key={index} className="flex gap-2">
                {insight.tone === "success" ? (
                  <CheckCircle2
                    className="mt-0.5 h-4 w-4 shrink-0 text-success"
                    aria-hidden="true"
                  />
                ) : insight.tone === "info" ? (
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden="true" />
                ) : (
                  <AlertTriangle
                    className={`mt-0.5 h-4 w-4 shrink-0 ${insight.tone === "danger" ? "text-destructive" : "text-warning"}`}
                    aria-hidden="true"
                  />
                )}
                <span>{insight.text}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <Panel title={tr("analysis.data_quality")}>
        <p className="mb-3 text-sm text-muted-foreground">{tr("analysis.data_quality_hint")}</p>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {qualityRows.map((row) => (
            <li key={row.label}>
              <Link
                to={row.to}
                className="flex h-full items-center justify-between gap-2 rounded-lg border p-3 text-sm hover:bg-accent/50"
              >
                <span>{row.label}</span>
                <Pill tone={row.count > 0 ? "warning" : "success"}>{row.count}</Pill>
              </Link>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
