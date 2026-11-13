import { useState, type ReactNode } from "react";
import { Download, Table2, ChartColumnBig } from "lucide-react";
import { currentLocale, tr } from "@/i18n";
import { downloadCsv } from "@/lib/analysis-export";
import { NONE, type Granularity } from "@/lib/analysis";
import { eur, todayISO } from "@/lib/format";
import { contactLabel, potName, tradeName } from "@/lib/options";
import type { Workspace } from "@/lib/schema";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/app/ui-bits";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export const SERIES_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--finance-budget)",
  "var(--muted-foreground)",
];

export type Column = { key: string; label: string; kind?: "eur" | "pct" | "int" | "text" };
export type Cell = string | number | null;
export type TableData = { columns: Column[]; rows: Record<string, Cell>[] };

export function formatCell(kind: Column["kind"], value: Cell) {
  if (value === null || value === undefined || value === "") return "–";
  if (typeof value === "string") return value;
  if (kind === "eur") return eur(value, true);
  if (kind === "pct") return `${Math.round(value * 100)} %`;
  return String(value);
}

export const pct = (value: number | null) =>
  value === null ? "–" : `${Math.round(value * 100)} %`;

/** Display labels for ids used in filters and charts. */
export function useLabels(ws: Workspace) {
  const costItems = new Map(ws.cost_items.map((item) => [item.id, item.title]));
  const contacts = new Map(ws.contacts.map((contact) => [contact.id, contactLabel(contact)]));
  const none = tr("analysis.none");
  return {
    trade: (id: string | null) => (id && id !== NONE ? tradeName(ws, id) : none),
    costItem: (id: string | null) => (id && id !== NONE ? (costItems.get(id) ?? none) : none),
    pot: (id: string | null) => (id && id !== NONE ? (potName(ws, id) ?? none) : none),
    contact: (id: string | null) => (id && id !== NONE ? (contacts.get(id) ?? none) : none),
    category: (value: string | null) => (value && value !== NONE ? tr(value) : none),
    phase: (value: string | null) => (value && value !== NONE ? tr(value) : none),
  };
}

export function statusLabels(): Record<string, string> {
  return {
    offen: tr("shared.open"),
    bezahlt: tr("shared.paid"),
    eingereicht: tr("shared.submitted"),
    erstattet: tr("shared.reimbursed"),
    abgelehnt: tr("shared.rejected"),
  };
}

export function periodLabel(key: string, granularity: Granularity) {
  const locale = currentLocale();
  if (key === "__other") return tr("analysis.other");
  if (granularity === "quarter") return `${key.slice(5)} ${key.slice(2, 4)}`;
  if (granularity === "week") {
    const [y = 0, m = 1, d = 1] = key.split("-").map(Number);
    return new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit" }).format(
      new Date(y, m - 1, d),
    );
  }
  const [y = 0, m = 1] = key.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, { month: "short", year: "2-digit" }).format(
    new Date(y, m - 1, 1),
  );
}

export const compactEur = (value: number) =>
  new Intl.NumberFormat(currentLocale(), { notation: "compact", maximumFractionDigits: 1 }).format(
    value,
  );

export function DataTable({ data }: { data: TableData }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {data.columns.map((column) => (
              <TableHead
                key={column.key}
                className={column.kind && column.kind !== "text" ? "text-right" : ""}
              >
                {column.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody className="tabular">
          {data.rows.map((row, index) => (
            <TableRow key={index}>
              {data.columns.map((column) => (
                <TableCell
                  key={column.key}
                  className={cn(
                    column.kind && column.kind !== "text" ? "text-right" : "",
                    column.key === data.columns[0]?.key && "font-medium",
                  )}
                >
                  {formatCell(column.kind, row[column.key] ?? null)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function exportTable(name: string, data: TableData) {
  downloadCsv(
    `bauplan-${name}-${todayISO()}`,
    [
      data.columns.map((column) => column.label),
      ...data.rows.map((row) => data.columns.map((column) => row[column.key] ?? null)),
    ],
    currentLocale(),
  );
}

/**
 * A chart with an equivalent data table (screen readers, exact values, CSV export).
 * `summary` is the text alternative announced for the chart.
 */
export function ChartCard({
  title,
  description,
  chart,
  table,
  exportName,
  summary,
  controls,
  className,
}: {
  title: string;
  description?: string | undefined;
  chart: ReactNode;
  table: TableData;
  exportName: string;
  summary?: string | undefined;
  controls?: ReactNode;
  className?: string | undefined;
}) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const empty = table.rows.length === 0;
  return (
    <Panel className={className}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-56">
          <h3 className="text-base font-semibold">{title}</h3>
          {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {controls}
          {!empty && (
            <>
              <Button
                size="icon"
                variant="ghost"
                aria-pressed={view === "table"}
                aria-label={
                  view === "chart" ? tr("analysis.show_table") : tr("analysis.show_chart")
                }
                title={view === "chart" ? tr("analysis.show_table") : tr("analysis.show_chart")}
                onClick={() => setView(view === "chart" ? "table" : "chart")}
              >
                {view === "chart" ? (
                  <Table2 className="h-4 w-4" />
                ) : (
                  <ChartColumnBig className="h-4 w-4" />
                )}
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label={tr("analysis.export_csv")}
                title={tr("analysis.export_csv")}
                onClick={() => exportTable(exportName, table)}
              >
                <Download className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      </div>
      {empty ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          {tr("analysis.no_data")}
        </p>
      ) : view === "chart" ? (
        <div role="img" aria-label={`${title}${summary ? `: ${summary}` : ""}`}>
          {chart}
        </div>
      ) : (
        <DataTable data={table} />
      )}
    </Panel>
  );
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="mb-3 mt-2">
      <h2 className="text-lg font-semibold">{children}</h2>
      {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
    </div>
  );
}
