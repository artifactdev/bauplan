import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import { Tooltip } from "recharts";
import { tr } from "@/i18n";
import { burnDown, planVsForecast } from "@/lib/analysis";
import { eur } from "@/lib/format";
import { ChartBox, Legend, MoneyTooltip, axisMoney } from "./charts";
import { ChartCard, SERIES_COLORS, periodLabel, useLabels, type TableData } from "./shared";
import type { AnalysisContext } from "./types";

export function BudgetSection({ ctx }: { ctx: AnalysisContext }) {
  const { ws, summary, ledger, filters } = ctx;
  const labels = useLabels(ws);
  const rows = planVsForecast(summary.items, filters);
  const top = rows.slice(0, 10);

  const stages = [
    {
      key: "planned",
      name: tr("budget.planned"),
      value: rows.reduce((s, r) => s + r.planned, 0),
      color: "var(--finance-planned)",
    },
    {
      key: "committed",
      name: tr("budget.committed"),
      value: rows.reduce((s, r) => s + r.committed, 0),
      color: "var(--finance-committed)",
    },
    {
      key: "invoiced",
      name: tr("budget.invoiced"),
      value: rows.reduce((s, r) => s + r.invoiced, 0),
      color: "var(--finance-expected)",
    },
    {
      key: "paid",
      name: tr("shared.paid"),
      value: rows.reduce((s, r) => s + r.paid, 0),
      color: "var(--finance-paid)",
    },
    {
      key: "expected",
      name: tr("budget.expected"),
      value: rows.reduce((s, r) => s + r.expected, 0),
      color: "var(--chart-2)",
    },
  ];
  const stagesTable: TableData = {
    columns: [
      { key: "name", label: tr("analysis.stage") },
      { key: "value", label: tr("shared.amount"), kind: "eur" },
    ],
    rows: stages.map((stage) => ({ name: stage.name, value: stage.value })),
  };

  const planTable: TableData = {
    columns: [
      { key: "title", label: tr("shared.cost_item") },
      { key: "trade", label: tr("shared.trade") },
      { key: "planned", label: tr("budget.planned"), kind: "eur" },
      { key: "committed", label: tr("budget.committed"), kind: "eur" },
      { key: "invoiced", label: tr("budget.invoiced"), kind: "eur" },
      { key: "paid", label: tr("shared.paid"), kind: "eur" },
      { key: "expected", label: tr("budget.expected"), kind: "eur" },
      { key: "variance", label: tr("analysis.variance"), kind: "eur" },
      { key: "variancePct", label: tr("analysis.variance_pct"), kind: "pct" },
    ],
    rows: rows.map((row) => ({ ...row, trade: row.tradeId ? labels.trade(row.tradeId) : "–" })),
  };
  const planChart = top.map((row) => ({
    name: row.title,
    planned: row.planned,
    expected: row.expected,
  }));

  const byTrade = new Map<string, number>();
  for (const row of rows)
    byTrade.set(row.tradeId ?? "", (byTrade.get(row.tradeId ?? "") ?? 0) + row.expected);
  const tradeTotal = [...byTrade.values()].reduce((s, v) => s + v, 0);
  const tradeData = [...byTrade.entries()]
    .filter(([, value]) => value > 0)
    .map(([id, value]) => ({ name: id ? labels.trade(id) : tr("analysis.none"), value }))
    .sort((a, b) => b.value - a.value);
  const tradeTable: TableData = {
    columns: [
      { key: "name", label: tr("shared.trade") },
      { key: "value", label: tr("budget.expected"), kind: "eur" },
      { key: "share", label: tr("analysis.share"), kind: "pct" },
    ],
    rows: tradeData.map((row) => ({ ...row, share: tradeTotal ? row.value / tradeTotal : 0 })),
  };

  const burn = burnDown(ledger, filters.granularity, summary.budget);
  const burnTable: TableData = {
    columns: [
      { key: "period", label: tr("analysis.period") },
      { key: "spent", label: tr("analysis.cumulative_spent"), kind: "eur" },
      { key: "paid", label: tr("analysis.cumulative_paid"), kind: "eur" },
      { key: "budget", label: tr("shared.total_budget"), kind: "eur" },
    ],
    rows: burn.map((row) => ({ ...row, period: periodLabel(row.period, filters.granularity) })),
  };
  const burnChart = burn.map((row) => ({
    ...row,
    label: periodLabel(row.period, filters.granularity),
  }));
  const burnNames = {
    spent: tr("analysis.cumulative_spent"),
    paid: tr("analysis.cumulative_paid"),
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ChartCard
        title={tr("analysis.budget_stages")}
        description={tr("analysis.budget_stages_hint")}
        exportName="budget-stufen"
        table={stagesTable}
        summary={stages.map((stage) => `${stage.name} ${eur(stage.value)}`).join(", ")}
        chart={
          <div>
            <ChartBox height={240}>
              <BarChart data={stages} layout="vertical" margin={{ left: 8, right: 24 }}>
                <CartesianGrid horizontal={false} />
                <XAxis
                  type="number"
                  tickFormatter={axisMoney}
                  domain={[0, (max: number) => Math.max(max, summary.budget)]}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={96}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  cursor={{ fill: "var(--muted)", opacity: 0.4 }}
                  content={<MoneyTooltip />}
                />
                {summary.budget > 0 && (
                  <ReferenceLine
                    x={summary.budget}
                    stroke="var(--foreground)"
                    strokeDasharray="4 3"
                  />
                )}
                <Bar
                  isAnimationActive={false}
                  dataKey="value"
                  name={tr("shared.amount")}
                  radius={4}
                >
                  {stages.map((stage) => (
                    <Cell key={stage.key} fill={stage.color} />
                  ))}
                </Bar>
              </BarChart>
            </ChartBox>
            {summary.budget > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                <span
                  aria-hidden="true"
                  className="mr-1.5 inline-block w-4 border-t border-dashed border-foreground align-middle"
                />
                {tr("shared.total_budget")}: {eur(summary.budget)}
              </p>
            )}
          </div>
        }
      />

      <ChartCard
        title={tr("analysis.by_trade")}
        description={tr("analysis.by_trade_hint")}
        exportName="gewerke"
        table={tradeTable}
        summary={tradeData.map((row) => `${row.name} ${eur(row.value)}`).join(", ")}
        chart={
          <div>
            <ChartBox height={240}>
              <PieChart>
                <Tooltip content={<MoneyTooltip />} />
                <Pie
                  isAnimationActive={false}
                  data={tradeData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius="55%"
                  outerRadius="85%"
                  paddingAngle={2}
                  strokeWidth={0}
                >
                  {tradeData.map((row, index) => (
                    <Cell key={row.name} fill={SERIES_COLORS[index % SERIES_COLORS.length]} />
                  ))}
                </Pie>
              </PieChart>
            </ChartBox>
            <Legend
              items={tradeData.map((row, index) => ({
                label: `${row.name} · ${tradeTotal ? Math.round((row.value / tradeTotal) * 100) : 0} %`,
                color: SERIES_COLORS[index % SERIES_COLORS.length]!,
              }))}
            />
          </div>
        }
      />

      <ChartCard
        className="lg:col-span-2"
        title={tr("analysis.plan_vs_forecast")}
        description={tr("analysis.plan_vs_forecast_hint")}
        exportName="plan-prognose"
        table={planTable}
        summary={top
          .map((row) => `${row.title}: ${eur(row.planned)} / ${eur(row.expected)}`)
          .join("; ")}
        chart={
          <div>
            <ChartBox height={Math.max(220, top.length * 44)}>
              <BarChart data={planChart} layout="vertical" margin={{ left: 8, right: 24 }}>
                <CartesianGrid horizontal={false} />
                <XAxis type="number" tickFormatter={axisMoney} />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={110}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  cursor={{ fill: "var(--muted)", opacity: 0.4 }}
                  content={
                    <MoneyTooltip
                      names={{ planned: tr("budget.planned"), expected: tr("budget.expected") }}
                    />
                  }
                />
                <Bar
                  isAnimationActive={false}
                  dataKey="planned"
                  fill="var(--finance-planned)"
                  radius={4}
                />
                <Bar
                  isAnimationActive={false}
                  dataKey="expected"
                  fill="var(--finance-expected)"
                  radius={4}
                />
              </BarChart>
            </ChartBox>
            <Legend
              items={[
                { label: tr("budget.planned"), color: "var(--finance-planned)" },
                { label: tr("budget.expected"), color: "var(--finance-expected)" },
              ]}
            />
          </div>
        }
      />

      <ChartCard
        className="lg:col-span-2"
        title={tr("analysis.burn_down")}
        description={tr("analysis.burn_down_hint")}
        exportName="verlauf"
        table={burnTable}
        summary={burn.length ? `${eur(burn.at(-1)!.spent)} / ${eur(summary.budget)}` : undefined}
        chart={
          <div>
            <ChartBox height={280}>
              <LineChart data={burnChart} margin={{ left: 8, right: 16 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" tickLine={false} minTickGap={24} />
                <YAxis tickFormatter={axisMoney} width={52} tickLine={false} axisLine={false} />
                <Tooltip content={<MoneyTooltip names={burnNames} />} />
                {summary.budget > 0 && (
                  <ReferenceLine
                    y={summary.budget}
                    stroke="var(--foreground)"
                    strokeDasharray="4 3"
                    label={{
                      value: tr("shared.total_budget"),
                      position: "insideTopLeft",
                      fontSize: 11,
                      fill: "var(--foreground)",
                    }}
                  />
                )}
                <Line
                  isAnimationActive={false}
                  type="monotone"
                  dataKey="spent"
                  stroke="var(--finance-expected)"
                  strokeWidth={2.5}
                  dot={false}
                />
                <Line
                  isAnimationActive={false}
                  type="monotone"
                  dataKey="paid"
                  stroke="var(--finance-paid)"
                  strokeWidth={2.5}
                  strokeDasharray="6 3"
                  dot={false}
                />
              </LineChart>
            </ChartBox>
            <Legend
              items={[
                { label: tr("analysis.cumulative_spent"), color: "var(--finance-expected)" },
                { label: tr("analysis.cumulative_paid"), color: "var(--finance-paid)" },
              ]}
            />
          </div>
        }
      />
    </div>
  );
}
