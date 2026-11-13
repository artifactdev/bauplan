import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, Tooltip, XAxis, YAxis } from "recharts";
import { tr } from "@/i18n";
import {
  NONE,
  dueBuckets,
  groupSum,
  ledgerTotals,
  reimbursementFunnel,
  seriesByPeriod,
  type LedgerEntry,
} from "@/lib/analysis";
import { eur, fmtDate } from "@/lib/format";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChartBox, Legend, MoneyTooltip, axisMoney } from "./charts";
import {
  ChartCard,
  DataTable,
  SERIES_COLORS,
  pct,
  periodLabel,
  statusLabels,
  useLabels,
  type TableData,
} from "./shared";
import { Panel } from "@/components/app/ui-bits";
import type { AnalysisContext } from "./types";

type Dimension = "category" | "trade" | "pot" | "status";

export function ExpensesSection({ ctx }: { ctx: AnalysisContext }) {
  const { ws, ledger, filters, today } = ctx;
  const labels = useLabels(ws);
  const status = statusLabels();
  const [dimension, setDimension] = useState<Dimension>("category");

  const keyOf = (entry: LedgerEntry): string | null =>
    dimension === "category"
      ? entry.category
      : dimension === "trade"
        ? entry.tradeId
        : dimension === "pot"
          ? entry.potId
          : entry.status;
  const nameOf = (key: string) =>
    key === "__other"
      ? tr("analysis.other")
      : dimension === "category"
        ? labels.category(key)
        : dimension === "trade"
          ? labels.trade(key)
          : dimension === "pot"
            ? labels.pot(key)
            : (status[key] ?? key);

  const series = seriesByPeriod(ledger, filters.granularity, keyOf);
  const seriesChart: Record<string, string | number>[] = series.rows.map((row) => ({
    ...row,
    label: periodLabel(String(row["period"]), filters.granularity),
  }));
  const seriesNames = Object.fromEntries(series.keys.map((key) => [key, nameOf(key)]));
  const seriesTable: TableData = {
    columns: [
      { key: "label", label: tr("analysis.period") },
      ...series.keys.map((key) => ({ key, label: nameOf(key), kind: "eur" as const })),
      { key: "total", label: tr("shared.total"), kind: "eur" as const },
    ],
    rows: seriesChart.map(
      (row) =>
        ({ ...row, total: series.keys.reduce((sum, key) => sum + Number(row[key]), 0) }) as Record<
          string,
          string | number
        >,
    ),
  };

  const total = ledgerTotals(ledger);
  const byPot = groupSum(ledger, (entry) => entry.potId).map((group) => ({
    name: labels.pot(group.key),
    value: group.amount,
    count: group.count,
  }));
  const potTable: TableData = {
    columns: [
      { key: "name", label: tr("shared.paid_2") },
      { key: "value", label: tr("shared.amount"), kind: "eur" },
      { key: "count", label: tr("analysis.count"), kind: "int" },
      { key: "share", label: tr("analysis.share"), kind: "pct" },
    ],
    rows: byPot.map((row) => ({ ...row, share: total.total ? row.value / total.total : 0 })),
  };
  const byStatus = groupSum(ledger, (entry) => entry.status).map((group) => ({
    key: group.key,
    name: status[group.key] ?? group.key,
    value: group.amount,
    count: group.count,
  }));
  const statusColors: Record<string, string> = {
    offen: "var(--warning)",
    bezahlt: "var(--success)",
    eingereicht: "var(--info)",
    erstattet: "var(--chart-5)",
    abgelehnt: "var(--destructive)",
  };
  const statusTable: TableData = {
    columns: [
      { key: "name", label: tr("shared.status") },
      { key: "value", label: tr("shared.amount"), kind: "eur" },
      { key: "count", label: tr("analysis.count"), kind: "int" },
      { key: "share", label: tr("analysis.share"), kind: "pct" },
    ],
    rows: byStatus.map((row) => ({ ...row, share: total.total ? row.value / total.total : 0 })),
  };

  const funnel = reimbursementFunnel(ledger);
  const funnelData = [
    { key: "pending", name: status["eingereicht"]!, value: funnel.pending, color: "var(--info)" },
    {
      key: "reimbursed",
      name: status["erstattet"]!,
      value: funnel.reimbursed,
      color: "var(--chart-5)",
    },
    {
      key: "rejected",
      name: status["abgelehnt"]!,
      value: funnel.rejected,
      color: "var(--destructive)",
    },
  ];
  const funnelTable: TableData = {
    columns: [
      { key: "name", label: tr("shared.status") },
      { key: "value", label: tr("shared.amount"), kind: "eur" },
    ],
    rows: funnelData.every((row) => row.value === 0)
      ? []
      : [
          ...funnelData.map((row) => ({ name: row.name, value: row.value })),
          { name: tr("analysis.reimbursement_rate"), value: pct(funnel.rate) },
        ],
  };

  const vendors = groupSum(ledger, (entry) =>
    entry.contactId ? `c:${entry.contactId}` : entry.vendor?.trim() || null,
  )
    .slice(0, 8)
    .map((group) => ({
      name:
        group.key === NONE
          ? tr("analysis.none")
          : group.key.startsWith("c:")
            ? labels.contact(group.key.slice(2))
            : group.key,
      value: group.amount,
      count: group.count,
    }));
  const vendorTable: TableData = {
    columns: [
      { key: "name", label: tr("analysis.vendor") },
      { key: "value", label: tr("shared.amount"), kind: "eur" },
      { key: "count", label: tr("analysis.count"), kind: "int" },
    ],
    rows: vendors,
  };

  const due = dueBuckets(ledger, today);
  const dueData = [
    {
      key: "overdue",
      name: tr("analysis.due_overdue"),
      value: due.overdue,
      color: "var(--destructive)",
    },
    { key: "week", name: tr("analysis.due_week"), value: due.week, color: "var(--warning)" },
    { key: "month", name: tr("analysis.due_month"), value: due.month, color: "var(--chart-3)" },
    {
      key: "later",
      name: tr("analysis.due_later"),
      value: due.later,
      color: "var(--finance-budget)",
    },
    {
      key: "undated",
      name: tr("analysis.due_undated"),
      value: due.undated,
      color: "var(--muted-foreground)",
    },
  ];
  const dueTable: TableData = {
    columns: [
      { key: "name", label: tr("analysis.due") },
      { key: "value", label: tr("shared.amount"), kind: "eur" },
    ],
    rows: dueData.every((row) => row.value === 0)
      ? []
      : dueData.map((row) => ({ name: row.name, value: row.value })),
  };

  const largest: TableData = {
    columns: [
      { key: "date", label: tr("shared.date") },
      { key: "title", label: tr("shared.description") },
      { key: "vendor", label: tr("analysis.vendor") },
      { key: "pot", label: tr("shared.paid_2") },
      { key: "status", label: tr("shared.status") },
      { key: "amount", label: tr("shared.amount"), kind: "eur" },
    ],
    rows: [...ledger]
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 10)
      .map((entry) => ({
        date: fmtDate(entry.date),
        title: entry.title,
        vendor: entry.vendor,
        pot: labels.pot(entry.potId),
        status: status[entry.status] ?? entry.status,
        amount: entry.amount,
      })),
  };

  const dimensions: Dimension[] = ["category", "trade", "pot", "status"];
  const dimensionLabels: Record<Dimension, string> = {
    category: tr("shared.category"),
    trade: tr("shared.trade"),
    pot: tr("shared.paid_2"),
    status: tr("shared.status"),
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ChartCard
        className="lg:col-span-2"
        title={tr("analysis.spend_over_time")}
        description={tr("analysis.spend_over_time_hint", {
          total: eur(total.total),
          count: total.count,
        })}
        exportName="ausgaben-zeitraum"
        table={seriesTable}
        summary={`${eur(total.total)}`}
        controls={
          <Select value={dimension} onValueChange={(value) => setDimension(value as Dimension)}>
            <SelectTrigger className="h-8 w-40" aria-label={tr("analysis.group_by")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {dimensions.map((item) => (
                <SelectItem key={item} value={item}>
                  {dimensionLabels[item]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
        chart={
          <div>
            <ChartBox height={300}>
              <BarChart data={seriesChart} margin={{ left: 8, right: 16 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" tickLine={false} minTickGap={16} />
                <YAxis tickFormatter={axisMoney} width={52} tickLine={false} axisLine={false} />
                <Tooltip
                  cursor={{ fill: "var(--muted)", opacity: 0.4 }}
                  content={<MoneyTooltip names={seriesNames} />}
                />
                {series.keys.map((key, index) => (
                  <Bar
                    isAnimationActive={false}
                    key={key}
                    dataKey={key}
                    stackId="spend"
                    fill={
                      dimension === "status"
                        ? (statusColors[key] ?? SERIES_COLORS[index])
                        : SERIES_COLORS[index % SERIES_COLORS.length]
                    }
                    radius={index === series.keys.length - 1 ? [4, 4, 0, 0] : 0}
                  />
                ))}
              </BarChart>
            </ChartBox>
            <Legend
              items={series.keys.map((key, index) => ({
                label: nameOf(key),
                color:
                  dimension === "status"
                    ? (statusColors[key] ?? SERIES_COLORS[index]!)
                    : SERIES_COLORS[index % SERIES_COLORS.length]!,
              }))}
            />
          </div>
        }
      />

      <ChartCard
        title={tr("analysis.by_source")}
        exportName="finanztoepfe"
        table={potTable}
        summary={byPot.map((row) => `${row.name} ${eur(row.value)}`).join(", ")}
        chart={
          <ChartBox height={Math.max(180, byPot.length * 48)}>
            <BarChart data={byPot} layout="vertical" margin={{ left: 8, right: 24 }}>
              <CartesianGrid horizontal={false} />
              <XAxis type="number" tickFormatter={axisMoney} />
              <YAxis type="category" dataKey="name" width={90} tickLine={false} axisLine={false} />
              <Tooltip
                cursor={{ fill: "var(--muted)", opacity: 0.4 }}
                content={<MoneyTooltip names={{ value: tr("shared.amount") }} />}
              />
              <Bar isAnimationActive={false} dataKey="value" fill="var(--chart-1)" radius={4} />
            </BarChart>
          </ChartBox>
        }
      />

      <ChartCard
        title={tr("analysis.by_status")}
        exportName="status"
        table={statusTable}
        summary={byStatus.map((row) => `${row.name} ${eur(row.value)}`).join(", ")}
        chart={
          <div>
            <ChartBox height={220}>
              <PieChart>
                <Tooltip content={<MoneyTooltip />} />
                <Pie
                  isAnimationActive={false}
                  data={byStatus}
                  dataKey="value"
                  nameKey="name"
                  innerRadius="55%"
                  outerRadius="85%"
                  paddingAngle={2}
                  strokeWidth={0}
                >
                  {byStatus.map((row) => (
                    <Cell key={row.key} fill={statusColors[row.key] ?? "var(--muted-foreground)"} />
                  ))}
                </Pie>
              </PieChart>
            </ChartBox>
            <Legend
              items={byStatus.map((row) => ({
                label: `${row.name} · ${total.total ? Math.round((row.value / total.total) * 100) : 0} %`,
                color: statusColors[row.key] ?? "var(--muted-foreground)",
              }))}
            />
          </div>
        }
      />

      <ChartCard
        title={tr("analysis.reimbursement_funnel")}
        description={tr("analysis.reimbursement_funnel_hint", { rate: pct(funnel.rate) })}
        exportName="erstattungen"
        table={funnelTable}
        summary={funnelData.map((row) => `${row.name} ${eur(row.value)}`).join(", ")}
        chart={
          <ChartBox height={200}>
            <BarChart data={funnelData} layout="vertical" margin={{ left: 8, right: 24 }}>
              <CartesianGrid horizontal={false} />
              <XAxis type="number" tickFormatter={axisMoney} />
              <YAxis type="category" dataKey="name" width={90} tickLine={false} axisLine={false} />
              <Tooltip
                cursor={{ fill: "var(--muted)", opacity: 0.4 }}
                content={<MoneyTooltip names={{ value: tr("shared.amount") }} />}
              />
              <Bar isAnimationActive={false} dataKey="value" radius={4}>
                {funnelData.map((row) => (
                  <Cell key={row.key} fill={row.color} />
                ))}
              </Bar>
            </BarChart>
          </ChartBox>
        }
      />

      <ChartCard
        title={tr("analysis.due_dates")}
        description={tr("analysis.due_dates_hint")}
        exportName="faelligkeiten"
        table={dueTable}
        summary={dueData.map((row) => `${row.name} ${eur(row.value)}`).join(", ")}
        chart={
          <ChartBox height={200}>
            <BarChart data={dueData} margin={{ left: 8, right: 16 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="name" tickLine={false} interval={0} tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={axisMoney} width={52} tickLine={false} axisLine={false} />
              <Tooltip
                cursor={{ fill: "var(--muted)", opacity: 0.4 }}
                content={<MoneyTooltip names={{ value: tr("shared.amount") }} />}
              />
              <Bar isAnimationActive={false} dataKey="value" radius={[4, 4, 0, 0]}>
                {dueData.map((row) => (
                  <Cell key={row.key} fill={row.color} />
                ))}
              </Bar>
            </BarChart>
          </ChartBox>
        }
      />

      <ChartCard
        title={tr("analysis.top_vendors")}
        exportName="firmen"
        table={vendorTable}
        summary={vendors.map((row) => `${row.name} ${eur(row.value)}`).join(", ")}
        chart={
          <ChartBox height={Math.max(180, vendors.length * 40)}>
            <BarChart data={vendors} layout="vertical" margin={{ left: 8, right: 24 }}>
              <CartesianGrid horizontal={false} />
              <XAxis type="number" tickFormatter={axisMoney} />
              <YAxis type="category" dataKey="name" width={110} tickLine={false} axisLine={false} />
              <Tooltip
                cursor={{ fill: "var(--muted)", opacity: 0.4 }}
                content={<MoneyTooltip names={{ value: tr("shared.amount") }} />}
              />
              <Bar isAnimationActive={false} dataKey="value" fill="var(--chart-3)" radius={4} />
            </BarChart>
          </ChartBox>
        }
      />

      <Panel className="lg:col-span-2" title={tr("analysis.largest_expenses")}>
        {largest.rows.length ? (
          <DataTable data={largest} />
        ) : (
          <p className="text-sm text-muted-foreground">{tr("analysis.no_data")}</p>
        )}
      </Panel>
    </div>
  );
}
