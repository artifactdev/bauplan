import { Bar, BarChart, CartesianGrid, Cell, Tooltip, XAxis, YAxis } from "recharts";
import { tr } from "@/i18n";
import { expiringOffers, offerComparison, offerPipeline } from "@/lib/analysis";
import { eur, fmtDate } from "@/lib/format";
import { Panel } from "@/components/app/ui-bits";
import { ChartBox, Legend, MoneyTooltip, axisMoney } from "./charts";
import { ChartCard, DataTable, useLabels, type TableData } from "./shared";
import type { AnalysisContext } from "./types";

export function OffersSection({ ctx }: { ctx: AnalysisContext }) {
  const { ws, offers, today } = ctx;
  const labels = useLabels(ws);
  const comparison = offerComparison(offers);
  const comparisonChart = comparison.slice(0, 10).map((row) => ({
    name: labels.costItem(row.costItemId),
    min: row.min,
    accepted: row.accepted ?? 0,
    max: row.max,
  }));
  const comparisonTable: TableData = {
    columns: [
      { key: "name", label: tr("shared.cost_item") },
      { key: "count", label: tr("analysis.count"), kind: "int" },
      { key: "min", label: tr("analysis.cheapest"), kind: "eur" },
      { key: "max", label: tr("analysis.most_expensive"), kind: "eur" },
      { key: "accepted", label: tr("shared.accepted"), kind: "eur" },
      { key: "saving", label: tr("analysis.saving"), kind: "eur" },
    ],
    rows: comparison.map((row) => ({
      name: labels.costItem(row.costItemId),
      count: row.count,
      min: row.min,
      max: row.max,
      accepted: row.accepted,
      saving: row.saving,
    })),
  };
  const saved = comparison.reduce((sum, row) => sum + row.saving, 0);

  const pipelineLabels = {
    requested: tr("shared.requested"),
    received: tr("shared.received"),
    accepted: tr("shared.accepted"),
    rejected: tr("shared.rejected"),
  };
  const pipelineColors = {
    requested: "var(--warning)",
    received: "var(--info)",
    accepted: "var(--success)",
    rejected: "var(--muted-foreground)",
  };
  const pipeline = offerPipeline(offers).map((row) => ({
    ...row,
    name: pipelineLabels[row.status],
    color: pipelineColors[row.status],
  }));
  const pipelineTable: TableData = {
    columns: [
      { key: "name", label: tr("shared.status") },
      { key: "count", label: tr("analysis.count"), kind: "int" },
      { key: "amount", label: tr("shared.amount"), kind: "eur" },
    ],
    rows: pipeline.map((row) => ({
      name: row.name,
      count: row.count,
      amount: row.status === "requested" ? null : row.amount,
    })),
  };

  const expiring = expiringOffers(offers, today, 30);
  const expiringTable: TableData = {
    columns: [
      { key: "valid", label: tr("analysis.valid_until") },
      { key: "contractor", label: tr("analysis.vendor") },
      { key: "title", label: tr("shared.description") },
      { key: "amount", label: tr("shared.amount"), kind: "eur" },
    ],
    rows: expiring.map((offer) => ({
      valid: fmtDate(offer.valid_until),
      contractor: offer.contractor,
      title: offer.title,
      amount: Number(offer.amount),
    })),
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ChartCard
        className="lg:col-span-2"
        title={tr("analysis.offer_comparison")}
        description={tr("analysis.offer_comparison_hint", { saving: eur(saved) })}
        exportName="angebotsvergleich"
        table={comparisonTable}
        summary={comparison
          .map((row) => `${labels.costItem(row.costItemId)}: ${eur(row.min)} – ${eur(row.max)}`)
          .join("; ")}
        chart={
          <div>
            <ChartBox height={Math.max(220, comparisonChart.length * 56)}>
              <BarChart data={comparisonChart} layout="vertical" margin={{ left: 8, right: 24 }}>
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
                      names={{
                        min: tr("analysis.cheapest"),
                        accepted: tr("shared.accepted"),
                        max: tr("analysis.most_expensive"),
                      }}
                    />
                  }
                />
                <Bar isAnimationActive={false} dataKey="min" fill="var(--chart-1)" radius={4} />
                <Bar
                  isAnimationActive={false}
                  dataKey="accepted"
                  fill="var(--success)"
                  radius={4}
                />
                <Bar isAnimationActive={false} dataKey="max" fill="var(--chart-4)" radius={4} />
              </BarChart>
            </ChartBox>
            <Legend
              items={[
                { label: tr("analysis.cheapest"), color: "var(--chart-1)" },
                { label: tr("shared.accepted"), color: "var(--success)" },
                { label: tr("analysis.most_expensive"), color: "var(--chart-4)" },
              ]}
            />
          </div>
        }
      />

      <ChartCard
        title={tr("analysis.offer_pipeline")}
        exportName="angebote-status"
        table={pipelineTable}
        summary={pipeline.map((row) => `${row.name}: ${row.count}`).join(", ")}
        chart={
          <ChartBox height={220}>
            <BarChart data={pipeline} margin={{ left: 8, right: 16 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="name" tickLine={false} interval={0} />
              <YAxis allowDecimals={false} width={32} tickLine={false} axisLine={false} />
              <Tooltip
                cursor={{ fill: "var(--muted)", opacity: 0.4 }}
                content={
                  <MoneyTooltip
                    format={(value) => String(value)}
                    names={{ count: tr("analysis.count") }}
                  />
                }
              />
              <Bar isAnimationActive={false} dataKey="count" radius={[4, 4, 0, 0]}>
                {pipeline.map((row) => (
                  <Cell key={row.status} fill={row.color} />
                ))}
              </Bar>
            </BarChart>
          </ChartBox>
        }
      />

      <Panel title={tr("analysis.expiring_offers")}>
        {expiring.length ? (
          <DataTable data={expiringTable} />
        ) : (
          <p className="text-sm text-muted-foreground">{tr("analysis.no_expiring_offers")}</p>
        )}
      </Panel>
    </div>
  );
}
