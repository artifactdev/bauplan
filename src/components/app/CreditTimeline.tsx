import { useState } from "react";
import { tr } from "@/i18n";
import type { CreditTimelineRow } from "@/lib/calc";
import { eur } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/app/ui-bits";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

const MIN_MONTHS_AHEAD = 12;
const MAX_MONTHS_AHEAD = 36;

const monthLabel = (month: string) =>
  new Intl.DateTimeFormat(undefined, { month: "short", year: "numeric" }).format(
    new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1),
  );

/** Months shown by default: everything up to a year ahead, extended to just past the repayment start. */
function defaultTimelineRows(rows: CreditTimelineRow[]) {
  const firstForecast = rows.findIndex((row) => row.kind === "forecast");
  if (firstForecast < 0) return rows;
  const repaymentStart = rows.findIndex((row) => row.repaymentStart);
  const ahead =
    repaymentStart >= firstForecast
      ? Math.min(MAX_MONTHS_AHEAD, Math.max(MIN_MONTHS_AHEAD, repaymentStart - firstForecast + 3))
      : MIN_MONTHS_AHEAD;
  return rows.slice(0, firstForecast + ahead);
}

/** Month-by-month overview: what is paid, how much of it is repayment, and the remaining debt. */
export function CreditTimeline({ rows }: { rows: CreditTimelineRow[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : defaultTimelineRows(rows);
  const hasRepayment = rows.some((row) => (row.repayment ?? 0) > 0);
  return (
    <div>
      <h3 className="mb-1 text-sm font-semibold">{tr("credit_calculator.timeline_title")}</h3>
      <p className="mb-3 text-xs text-muted-foreground">{tr("credit_calculator.timeline_hint")}</p>
      <ul className="grid gap-2 md:hidden">
        {shown.map((row) => (
          <li
            key={row.month}
            className={cn(
              "rounded-lg border p-3",
              row.kind === "actual" && "text-muted-foreground",
              row.repaymentStart && "border-primary/50 bg-accent/40",
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <span className="font-medium">{monthLabel(row.month)}</span>
                <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
                  {row.kind === "actual" && <Pill>{tr("credit_calculator.timeline_actual")}</Pill>}
                  {row.repaymentStart && (
                    <Pill tone="primary">{tr("credit_calculator.timeline_repayment_starts")}</Pill>
                  )}
                </span>
              </div>
              <div className="shrink-0 text-right">
                <div className="font-display text-lg font-semibold tabular">
                  {eur(row.total, true)}
                </div>
                <div className="text-xs text-muted-foreground">
                  {tr("credit_calculator.timeline_total")}
                </div>
              </div>
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs tabular">
              <dt className="text-muted-foreground">{tr("credit_calculator.timeline_payment")}</dt>
              <dd className="text-right">{eur(row.payment, true)}</dd>
              {(row.repayment ?? 0) > 0 && (
                <>
                  <dt className="text-muted-foreground">
                    {tr("credit_calculator.timeline_repayment")}
                  </dt>
                  <dd className="text-right">{eur(row.repayment ?? 0, true)}</dd>
                </>
              )}
              {row.commitment > 0 && (
                <>
                  <dt className="text-muted-foreground">
                    {tr("credit_calculator.timeline_commitment")}
                  </dt>
                  <dd className="text-right">{eur(row.commitment, true)}</dd>
                </>
              )}
              <dt className="text-muted-foreground">{tr("credit_calculator.timeline_balance")}</dt>
              <dd className="text-right">
                {eur(row.balance, true)}
                {row.draws > 0 && (
                  <span className="block text-muted-foreground">
                    {tr("credit_calculator.timeline_drawn", { amount: eur(row.draws) })}
                  </span>
                )}
              </dd>
            </dl>
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto rounded-lg border md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{tr("shared.month_2")}</TableHead>
              <TableHead className="text-right">
                {tr("credit_calculator.timeline_payment")}
              </TableHead>
              {hasRepayment && (
                <TableHead className="text-right">
                  {tr("credit_calculator.timeline_repayment")}
                </TableHead>
              )}
              <TableHead className="text-right">
                {tr("credit_calculator.timeline_commitment")}
              </TableHead>
              <TableHead className="text-right">{tr("credit_calculator.timeline_total")}</TableHead>
              <TableHead className="text-right">
                {tr("credit_calculator.timeline_balance")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="tabular">
            {shown.map((row) => (
              <TableRow
                key={row.month}
                className={cn(
                  row.kind === "actual" && "text-muted-foreground",
                  row.repaymentStart && "bg-accent/40",
                )}
              >
                <TableCell className="whitespace-nowrap">
                  <span className="font-medium">{monthLabel(row.month)}</span>
                  <span className="ml-2 inline-flex gap-1 align-middle">
                    {row.kind === "actual" && (
                      <Pill>{tr("credit_calculator.timeline_actual")}</Pill>
                    )}
                    {row.repaymentStart && (
                      <Pill tone="primary">
                        {tr("credit_calculator.timeline_repayment_starts")}
                      </Pill>
                    )}
                  </span>
                </TableCell>
                <TableCell className="text-right">{eur(row.payment, true)}</TableCell>
                {hasRepayment && (
                  <TableCell className="text-right">
                    {row.repayment ? eur(row.repayment, true) : "–"}
                  </TableCell>
                )}
                <TableCell className="text-right">
                  {row.commitment > 0 ? eur(row.commitment, true) : "–"}
                </TableCell>
                <TableCell className="text-right font-medium">{eur(row.total, true)}</TableCell>
                <TableCell className="text-right">
                  {eur(row.balance, true)}
                  {row.draws > 0 && (
                    <span className="block text-xs text-muted-foreground">
                      {tr("credit_calculator.timeline_drawn", { amount: eur(row.draws) })}
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {rows.length > shown.length || all ? (
        <Button
          variant="ghost"
          size="sm"
          className="mt-2"
          onClick={() => setAll((value) => !value)}
        >
          {all
            ? tr("credit_calculator.timeline_show_less")
            : tr("credit_calculator.timeline_show_all", { count: rows.length })}
        </Button>
      ) : null}
    </div>
  );
}
