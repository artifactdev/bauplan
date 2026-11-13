import { Link } from "@tanstack/react-router";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import { tr } from "@/i18n";
import { creditAnalysis } from "@/lib/analysis";
import { eur } from "@/lib/format";
import { MetricCard, Panel } from "@/components/app/ui-bits";
import { ChartBox, Legend, MoneyTooltip, axisMoney } from "./charts";
import { ChartCard, periodLabel, type TableData } from "./shared";
import type { AnalysisContext } from "./types";

export function CreditSection({ ctx }: { ctx: AnalysisContext }) {
  const { ws, today } = ctx;
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
  const months = credit.months.map((month) => ({
    ...month,
    label: periodLabel(month.month.slice(0, 7), "month"),
    plannedCosts: month.plannedInterest + month.plannedCommitment,
    actualCosts: month.actualInterest + month.actualCommitment,
  }));
  const balanceTable: TableData = {
    columns: [
      { key: "label", label: tr("analysis.period") },
      { key: "actualBalance", label: tr("analysis.balance_actual"), kind: "eur" },
      { key: "plannedBalance", label: tr("analysis.balance_planned"), kind: "eur" },
      { key: "actualCosts", label: tr("analysis.costs_actual"), kind: "eur" },
      { key: "plannedCosts", label: tr("analysis.costs_planned"), kind: "eur" },
      { key: "plannedCumulative", label: tr("analysis.costs_cumulative"), kind: "eur" },
    ],
    rows: months,
  };
  const names = {
    actualBalance: tr("analysis.balance_actual"),
    plannedBalance: tr("analysis.balance_planned"),
    actualCosts: tr("analysis.costs_actual"),
    plannedCosts: tr("analysis.costs_planned"),
    plannedCumulative: tr("analysis.costs_cumulative"),
  };
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="grid grid-cols-2 gap-3 lg:col-span-2 lg:grid-cols-4">
        <MetricCard label={tr("analysis.balance_actual")} value={eur(credit.actualBalance)} />
        <MetricCard
          label={tr("analysis.balance_planned")}
          value={eur(credit.plannedBalance)}
          tone="info"
        />
        <MetricCard
          label={tr("analysis.costs_actual")}
          value={eur(credit.actualInterest + credit.actualCommitment, true)}
          tone="warning"
        />
        <MetricCard
          label={tr("analysis.costs_planned")}
          value={eur(credit.plannedInterest + credit.plannedCommitment, true)}
          tone="warning"
          hint={
            credit.annuity
              ? tr("analysis.annuity", { amount: eur(credit.annuity, true) })
              : undefined
          }
        />
      </div>
      <ChartCard
        title={tr("analysis.balance_over_time")}
        exportName="kredit-saldo"
        table={balanceTable}
        summary={`${eur(credit.actualBalance)} / ${eur(credit.plannedBalance)}`}
        chart={
          <div>
            <ChartBox height={260}>
              <AreaChart data={months} margin={{ left: 8, right: 16 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" tickLine={false} minTickGap={24} />
                <YAxis tickFormatter={axisMoney} width={52} tickLine={false} axisLine={false} />
                <Tooltip content={<MoneyTooltip names={names} />} />
                <Area
                  isAnimationActive={false}
                  type="monotone"
                  dataKey="plannedBalance"
                  stroke="var(--chart-3)"
                  strokeDasharray="6 3"
                  fill="var(--chart-3)"
                  fillOpacity={0.12}
                  strokeWidth={2}
                />
                <Area
                  isAnimationActive={false}
                  type="monotone"
                  dataKey="actualBalance"
                  stroke="var(--chart-1)"
                  fill="var(--chart-1)"
                  fillOpacity={0.25}
                  strokeWidth={2.5}
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
        title={tr("analysis.credit_costs")}
        exportName="kredit-kosten"
        table={balanceTable}
        summary={`${eur(credit.plannedInterest + credit.plannedCommitment)}`}
        chart={
          <div>
            <ChartBox height={260}>
              <BarChart data={months} margin={{ left: 8, right: 16 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" tickLine={false} minTickGap={24} />
                <YAxis tickFormatter={axisMoney} width={52} tickLine={false} axisLine={false} />
                <Tooltip
                  cursor={{ fill: "var(--muted)", opacity: 0.4 }}
                  content={<MoneyTooltip names={names} />}
                />
                <Bar
                  isAnimationActive={false}
                  dataKey="actualCosts"
                  fill="var(--chart-2)"
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  isAnimationActive={false}
                  dataKey="plannedCosts"
                  fill="var(--chart-4)"
                  fillOpacity={0.6}
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ChartBox>
            <Legend
              items={[
                { label: names.actualCosts, color: "var(--chart-2)" },
                { label: names.plannedCosts, color: "var(--chart-4)" },
              ]}
            />
          </div>
        }
      />
    </div>
  );
}
