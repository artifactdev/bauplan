import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { tr } from "@/i18n";
import { creditAnalysis, creditCostOutlook, creditRows } from "@/lib/analysis";
import { creditMonthlyBurden } from "@/lib/calc";
import { eur, fmtDate } from "@/lib/format";
import { MetricCard, Panel } from "@/components/app/ui-bits";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChartBox, Legend, MoneyTooltip, axisMoney } from "./charts";
import { ChartCard, periodLabel, type TableData } from "./shared";
import type { AnalysisContext } from "./types";

const HORIZONS = { "12": 12, "24": 24, "60": 60, all: null } as const;
type Horizon = keyof typeof HORIZONS;

export function CreditSection({ ctx }: { ctx: AnalysisContext }) {
  const { ws, today } = ctx;
  const [horizon, setHorizon] = useState<Horizon>("24");
  const credit = creditAnalysis(ws, today);
  if (!credit) {
    return (
      <Panel>
        <p className="text-sm text-muted-foreground">
          {tr("analysis.no_credit")}{" "}
          <Link to="/kredit" className="text-primary hover:underline">
            {tr("credit_calculator.loan_details")}
          </Link>
        </p>
      </Panel>
    );
  }
  const terms = ws.credit_terms[0]!;
  const outlook = creditCostOutlook(credit, today);
  const burden = creditMonthlyBurden(credit, terms.first_installment_date, today);
  const rows = creditRows(credit, today, HORIZONS[horizon]).map((row) => ({
    ...row,
    label: periodLabel(row.month, "month"),
  }));
  const drawnShare = terms.total_credit > 0 ? credit.actualBalance / terms.total_credit : 0;

  const table: TableData = {
    columns: [
      { key: "label", label: tr("analysis.period") },
      { key: "actualBalance", label: tr("analysis.balance_actual"), kind: "eur" },
      { key: "plannedBalance", label: tr("analysis.balance_planned"), kind: "eur" },
      { key: "actualCosts", label: tr("analysis.costs_actual"), kind: "eur" },
      { key: "plannedInterest", label: tr("analysis.interest_planned"), kind: "eur" },
      { key: "plannedRepayment", label: tr("analysis.repayment_planned"), kind: "eur" },
      { key: "plannedCommitment", label: tr("analysis.commitment_planned"), kind: "eur" },
    ],
    rows,
  };
  const names = {
    actualBalance: tr("analysis.balance_actual"),
    plannedBalance: tr("analysis.balance_planned"),
    actualCosts: tr("analysis.costs_actual"),
    plannedInterest: tr("analysis.interest_planned"),
    plannedRepayment: tr("analysis.repayment_planned"),
    plannedCommitment: tr("analysis.commitment_planned"),
  };
  const horizonLabels: Record<Horizon, string> = {
    "12": tr("analysis.horizon_months", { count: 12 }),
    "24": tr("analysis.horizon_months", { count: 24 }),
    "60": tr("analysis.horizon_months", { count: 60 }),
    all: tr("analysis.horizon_all"),
  };
  const horizonControl = (
    <Select value={horizon} onValueChange={(value) => setHorizon(value as Horizon)}>
      <SelectTrigger className="h-8 w-44" aria-label={tr("analysis.horizon")}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(Object.keys(HORIZONS) as Horizon[]).map((key) => (
          <SelectItem key={key} value={key}>
            {horizonLabels[key]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="grid grid-cols-2 gap-3 lg:col-span-2 lg:grid-cols-4">
        <MetricCard
          label={tr("analysis.credit_drawn")}
          value={eur(credit.actualBalance)}
          hint={tr("analysis.credit_drawn_hint", {
            share: Math.round(drawnShare * 100),
            total: eur(terms.total_credit),
          })}
        />
        <MetricCard
          label={tr("analysis.burden_now")}
          value={burden.now ? eur(burden.now.payment + burden.now.commitment, true) : "–"}
          hint={tr("analysis.burden_now_hint")}
          tone="warning"
        />
        <MetricCard
          label={tr("analysis.burden_after")}
          value={
            burden.afterFirstInstallment
              ? eur(
                  burden.afterFirstInstallment.payment + burden.afterFirstInstallment.commitment,
                  true,
                )
              : "–"
          }
          hint={tr("analysis.burden_after_hint", { date: fmtDate(terms.first_installment_date) })}
          tone="warning"
        />
        <MetricCard
          label={tr("analysis.costs_term")}
          value={eur(outlook.term, true)}
          hint={tr("analysis.costs_term_hint")}
          tone="warning"
        />
      </div>
      <div className="flex items-center justify-between gap-3 lg:col-span-2">
        <p className="text-sm text-muted-foreground">{tr("analysis.credit_basis_note")}</p>
        {horizonControl}
      </div>
      <ChartCard
        title={tr("analysis.balance_over_time")}
        description={tr("analysis.balance_over_time_hint")}
        exportName="kredit-saldo"
        table={table}
        summary={`${eur(credit.actualBalance)} / ${eur(credit.plannedBalance)}`}
        chart={
          <div>
            <ChartBox height={260}>
              <AreaChart data={rows} margin={{ left: 8, right: 16 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" tickLine={false} minTickGap={24} />
                <YAxis tickFormatter={axisMoney} width={52} tickLine={false} axisLine={false} />
                <Tooltip content={<MoneyTooltip names={names} />} />
                <Area
                  isAnimationActive={false}
                  type="stepAfter"
                  dataKey="plannedBalance"
                  stroke="var(--chart-3)"
                  strokeDasharray="6 3"
                  fill="var(--chart-3)"
                  fillOpacity={0.12}
                  strokeWidth={2}
                />
                <Area
                  isAnimationActive={false}
                  type="stepAfter"
                  dataKey="actualBalance"
                  stroke="var(--chart-1)"
                  fill="var(--chart-1)"
                  fillOpacity={0.25}
                  strokeWidth={2.5}
                  connectNulls={false}
                />
              </AreaChart>
            </ChartBox>
            <Legend
              items={[
                { label: names.actualBalance, color: "var(--chart-1)" },
                { label: names.plannedBalance, color: "var(--chart-3)" },
              ]}
            />
          </div>
        }
      />
      <ChartCard
        title={tr("analysis.credit_burden")}
        description={tr("analysis.credit_burden_hint")}
        exportName="kredit-kosten"
        table={table}
        summary={`${eur(outlook.next12)}`}
        chart={
          <div>
            <ChartBox height={260}>
              <ComposedChart data={rows} margin={{ left: 8, right: 16 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" tickLine={false} minTickGap={24} />
                <YAxis tickFormatter={axisMoney} width={52} tickLine={false} axisLine={false} />
                <Tooltip
                  cursor={{ fill: "var(--muted)", opacity: 0.4 }}
                  content={<MoneyTooltip names={names} />}
                />
                <Bar
                  isAnimationActive={false}
                  dataKey="plannedInterest"
                  stackId="cost"
                  fill="var(--chart-4)"
                />
                <Bar
                  isAnimationActive={false}
                  dataKey="plannedRepayment"
                  stackId="cost"
                  fill="var(--chart-1)"
                />
                <Bar
                  isAnimationActive={false}
                  dataKey="plannedCommitment"
                  stackId="cost"
                  fill="var(--chart-2)"
                  radius={[4, 4, 0, 0]}
                />
                <Line
                  isAnimationActive={false}
                  dataKey="actualCosts"
                  stroke="var(--foreground)"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  connectNulls={false}
                />
              </ComposedChart>
            </ChartBox>
            <Legend
              items={[
                { label: names.plannedInterest, color: "var(--chart-4)" },
                { label: names.plannedRepayment, color: "var(--chart-1)" },
                { label: names.plannedCommitment, color: "var(--chart-2)" },
                { label: names.actualCosts, color: "var(--foreground)" },
              ]}
            />
          </div>
        }
      />
    </div>
  );
}
