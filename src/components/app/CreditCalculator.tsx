import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import { currentLocale, tr } from "@/i18n";
import { useMutations, useWorkspace } from "@/hooks/use-workspace";
import { bankFundedPayments, calculateCreditCosts } from "@/lib/calc";
import { eur, fmtDate, todayISO } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EntityDialog } from "@/components/app/EntityDialog";
import { Empty, PageHeader, Panel } from "@/components/app/ui-bits";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type CreditDraft = {
  budget_pot_id: string;
  total_credit: string;
  annual_rate: string;
  effective_rate: string;
  fixed_rate_end: string;
  payout_rate: string;
  repayment_rate: string;
  monthly_installment: string;
  repayment_count: string;
  first_installment_date: string;
  commitment_rate: string;
  commitment_start: string;
  day_basis: string;
};

const defaultDraft = (principal: number, potId: string): CreditDraft => ({
  budget_pot_id: potId,
  total_credit: principal ? String(principal) : "",
  annual_rate: "",
  effective_rate: "",
  fixed_rate_end: "",
  payout_rate: "",
  repayment_rate: "",
  monthly_installment: "",
  repayment_count: "",
  first_installment_date: "",
  commitment_rate: "",
  commitment_start: "",
  day_basis: "365",
});

const contractFields: {
  key: keyof CreditDraft;
  label: string;
  type: "date" | "number";
  required?: boolean;
  integer?: boolean;
}[] = [
  {
    key: "total_credit",
    label: "Darlehensbetrag / Nettodarlehensbetrag (€)",
    type: "number",
    required: true,
  },
  {
    key: "annual_rate",
    label: "Sollzinssatz gebunden (Nominalzins, % p. a.)",
    type: "number",
    required: true,
  },
  { key: "effective_rate", label: "Effektiver Jahreszins (%)", type: "number" },
  { key: "fixed_rate_end", label: "Zinsfestschreibung bis", type: "date" },
  { key: "payout_rate", label: "Auszahlungskurs (%)", type: "number" },
  { key: "repayment_rate", label: "Tilgungssatz (% p. a.)", type: "number" },
  { key: "monthly_installment", label: "Monatliche Rate (€)", type: "number", required: true },
  {
    key: "repayment_count",
    label: "Anzahl der Raten",
    type: "number",
    required: true,
    integer: true,
  },
];

export function CreditCalculator() {
  const { ws } = useWorkspace();
  const { create, update, remove } = useMutations();
  const terms = ws.credit_terms[0];
  const defaultPotId = ws.budget_pots.find((pot) => /bank/i.test(pot.name))?.id ?? "";
  const [draft, setDraft] = useState<CreditDraft>(() =>
    defaultDraft(ws.projects[0]?.total_budget ?? 0, defaultPotId),
  );
  const [repaymentOpen, setRepaymentOpen] = useState(false);

  useEffect(() => {
    setDraft(
      terms
        ? {
            budget_pot_id: terms.budget_pot_id ?? "",
            total_credit: String(terms.total_credit ?? ""),
            annual_rate: String(terms.annual_rate ?? ""),
            effective_rate: terms.effective_rate ? String(terms.effective_rate) : "",
            fixed_rate_end: terms.fixed_rate_end ?? "",
            payout_rate: terms.payout_rate ? String(terms.payout_rate) : "",
            repayment_rate: terms.repayment_rate ? String(terms.repayment_rate) : "",
            monthly_installment: terms.monthly_installment ? String(terms.monthly_installment) : "",
            repayment_count: terms.repayment_count ? String(terms.repayment_count) : "",
            first_installment_date: terms.first_installment_date ?? terms.repayment_start ?? "",
            commitment_rate: String(terms.commitment_rate ?? ""),
            commitment_start: terms.commitment_start ?? "",
            day_basis: String(terms.day_basis ?? 365),
          }
        : defaultDraft(ws.projects[0]?.total_budget ?? 0, defaultPotId),
    );
  }, [terms, ws.projects, defaultPotId]);

  const repaymentRows = ws.credit_repayments;
  const payments = useMemo(
    () => bankFundedPayments(ws.invoices, ws.expenses, draft.budget_pot_id || null),
    [ws.invoices, ws.expenses, draft.budget_pot_id],
  );
  const calculation = useMemo(
    () => (terms ? calculateCreditCosts(terms, payments, repaymentRows, todayISO()) : null),
    [terms, payments, repaymentRows],
  );
  const saving = create.isPending || update.isPending;

  const saveTerms = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft.budget_pot_id) {
      toast.error(tr("credit_calculator.choose_loan_payment_source"));
      return;
    }
    if (!draft.commitment_start) {
      toast.error(tr("credit_calculator.enter_full_drawdown_deadline"));
      return;
    }
    const totalCredit = Number(draft.total_credit);
    const annualRate = Number(draft.annual_rate);
    const commitmentRate = Number(draft.commitment_rate);
    const monthlyInstallment = Number(draft.monthly_installment);
    const repaymentCount = Number(draft.repayment_count);
    if (
      !(totalCredit > 0) ||
      !(monthlyInstallment > 0) ||
      !Number.isInteger(repaymentCount) ||
      repaymentCount <= 0 ||
      annualRate < 0 ||
      commitmentRate < 0
    ) {
      toast.error(tr("credit_calculator.check_loan_amount_nominal"));
      return;
    }
    const firstInstallmentDate = draft.commitment_start;
    const row = {
      budget_pot_id: draft.budget_pot_id,
      total_credit: totalCredit,
      annual_rate: annualRate,
      effective_rate: draft.effective_rate ? Number(draft.effective_rate) : null,
      fixed_rate_end: draft.fixed_rate_end || null,
      payout_rate: draft.payout_rate ? Number(draft.payout_rate) : null,
      net_credit: totalCredit,
      repayment_rate: draft.repayment_rate ? Number(draft.repayment_rate) : null,
      monthly_installment: monthlyInstallment,
      repayment_count: repaymentCount,
      first_installment_date: firstInstallmentDate,
      interest_free_start: firstInstallmentDate,
      interest_free_end: firstInstallmentDate,
      repayment_start: firstInstallmentDate,
      commitment_rate: commitmentRate,
      commitment_start: draft.commitment_start,
      commitment_free_end: null,
      repayment_months: repaymentCount,
      day_basis: Number(draft.day_basis),
    };
    if (terms) update.mutate({ table: "credit_terms", id: terms.id, patch: row });
    else create.mutate({ table: "credit_terms", row });
  };

  return (
    <>
      <PageHeader
        title={tr("shared.loan")}
        subtitle={tr("shared.keep_track_loan_terms")}
      />
      <Panel title={tr("credit_calculator.loan_interest_costs")}>
        <p className="mb-4 text-sm text-muted-foreground">
          {tr(
            "credit_calculator.bank_funded_invoices_expenses",
          )}
        </p>
        {!ws.budget_pots.length && (
          <Empty>
            {tr("credit_calculator.first_create_payment_source")}
          </Empty>
        )}
        {!!ws.budget_pots.length && (
          <form className="grid gap-4" onSubmit={saveTerms}>
            <div className="grid gap-1.5">
              <Label htmlFor="credit-source">{tr("credit_calculator.loan_payment_source")}</Label>
              <Select
                value={draft.budget_pot_id}
                onValueChange={(value) => setDraft((d) => ({ ...d, budget_pot_id: value }))}
              >
                <SelectTrigger id="credit-source">
                  <SelectValue placeholder={tr("credit_calculator.choose_payment_source")} />
                </SelectTrigger>
                <SelectContent>
                  {ws.budget_pots.map((pot) => (
                    <SelectItem key={pot.id} value={pot.id}>
                      {pot.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <h3 className="mb-3 text-sm font-semibold">
                {tr("credit_calculator.loan_contract_details")}
              </h3>
              <p className="mb-3 text-sm text-muted-foreground">
                {tr(
                  "credit_calculator.fixed_nominal_rate_used",
                )}
              </p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {contractFields.map((field) => (
                  <div key={field.key} className="grid gap-1.5">
                    <Label htmlFor={`credit-${field.key}`}>{tr(field.label)}</Label>
                    <Input
                      id={`credit-${field.key}`}
                      type={field.type}
                      min={field.type === "number" ? 0 : undefined}
                      step={field.integer ? 1 : field.type === "number" ? "0.01" : undefined}
                      required={field.required}
                      value={draft[field.key]}
                      onChange={(event) =>
                        setDraft((d) => ({ ...d, [field.key]: event.target.value }))
                      }
                    />
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h3 className="mb-3 text-sm font-semibold">
                {tr("credit_calculator.other_contract_details")}
              </h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="credit-commitment-rate">
                    {tr("shared.commitment_interest_per_month")}
                  </Label>
                  <Input
                    id="credit-commitment-rate"
                    type="number"
                    min={0}
                    step="0.01"
                    required
                    value={draft.commitment_rate}
                    onChange={(event) =>
                      setDraft((d) => ({ ...d, commitment_rate: event.target.value }))
                    }
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="credit-commitment-start">
                    {tr("credit_calculator.commitment_interest_full_installment")}
                  </Label>
                  <Input
                    id="credit-commitment-start"
                    type="date"
                    required
                    value={draft.commitment_start}
                    onChange={(event) =>
                      setDraft((d) => ({
                        ...d,
                        commitment_start: event.target.value,
                        first_installment_date: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="credit-day-basis">{tr("credit_calculator.interest_days_per_year")}</Label>
                  <Select
                    value={draft.day_basis}
                    onValueChange={(value) => setDraft((d) => ({ ...d, day_basis: value }))}
                  >
                    <SelectTrigger id="credit-day-basis">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="360">{tr("credit_calculator.360_days_act_360")}</SelectItem>
                      <SelectItem value="365">{tr("credit_calculator.365_days_act_365")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              {tr(
                "credit_calculator.partial_drawdowns_made_up",
              )}
            </p>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                {tr(
                  "credit_calculator.contract_date_includes_that",
                )}
              </p>
              <Button type="submit" disabled={saving}>
                {tr("credit_calculator.save_loan_terms")}
              </Button>
            </div>
          </form>
        )}

        {terms && !calculation && (
          <p className="mt-4 text-sm text-warning">
            {tr(
              "credit_calculator.complete_loan_terms_calculate",
            )}
          </p>
        )}
        {calculation && (
          <div className="mt-6 grid gap-5">
            <div className="grid gap-4 lg:grid-cols-2">
              <section className="rounded-xl border p-4">
                <h3 className="mb-3 text-sm font-semibold">{tr("credit_calculator.actual_date")}</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <CreditMetric label={tr("credit_calculator.actual_nominal_interest")} value={eur(calculation.actualInterest, true)} />
                  <CreditMetric label={tr("credit_calculator.actual_commitment_interest_2")} value={eur(calculation.actualCommitment, true)} />
                  <CreditMetric label={tr("credit_calculator.actual_total_interest")} value={eur(calculation.actualInterest + calculation.actualCommitment, true)} />
                </div>
              </section>
              <section className="rounded-xl border border-primary/30 bg-accent/20 p-4">
                <h3 className="mb-3 text-sm font-semibold">{tr("credit_calculator.forecast_group")}</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <CreditMetric label={tr("credit_calculator.forecast_nominal_interest")} value={eur(calculation.plannedInterest, true)} />
                  <CreditMetric label={tr("credit_calculator.forecast_commitment_interest_2")} value={eur(calculation.plannedCommitment, true)} />
                  <CreditMetric label={tr("credit_calculator.forecast_total_interest")} value={eur(calculation.plannedInterest + calculation.plannedCommitment, true)} />
                  <CreditMetric label={tr("credit_calculator.balance_repayment_start")} value={eur(calculation.plannedBalance, true)} />
                </div>
              </section>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">{tr("credit_calculator.repayments")}</h3>
                <p className="text-xs text-muted-foreground">
                  {tr("credit_calculator.repayments_reduce_loan_balance")}
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={() => setRepaymentOpen(true)}>
                <Plus className="h-4 w-4" /> {tr("credit_calculator.record_repayment")}
              </Button>
            </div>
            {repaymentRows.length > 0 && (
              <ul className="grid gap-2">
                {repaymentRows.map((repayment) => (
                  <li key={repayment.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-lg border p-3 text-sm sm:flex">
                    <span className="text-xs text-muted-foreground sm:text-sm">
                      {fmtDate(repayment.repayment_date)}
                    </span>
                    <span className="col-start-1 row-start-2 min-w-0 break-words sm:flex-1">{repayment.notes || tr("credit_calculator.repayment")}</span>
                    <span className="col-start-2 row-start-1 text-right font-medium tabular sm:order-3">{eur(repayment.amount, true)}</span>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="col-start-2 row-start-2 sm:order-4"
                      aria-label={tr("credit_calculator.delete_repayment")}
                      onClick={() =>
                        confirm(tr("credit_calculator.delete_repayment_2")) &&
                        remove.mutate({ table: "credit_repayments", id: repayment.id })
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            {calculation.annuity !== null && (
              <p className="rounded-lg bg-muted/60 p-3 text-sm">
                {tr("credit_calculator.estimated_monthly_payment_repayment")}:{" "}
                <b className="tabular">{eur(calculation.annuity, true)}</b>
                <span className="text-muted-foreground">
                  {" "}
                  · {draft.repayment_count} {tr("credit_calculator.months")}
                </span>
              </p>
            )}
            <div>
              <h3 className="mb-2 text-sm font-semibold">
                {tr("credit_calculator.monthly_history_actual_forecast")}
              </h3>
              {calculation.months.length ? (
                <div className="max-h-96 overflow-auto rounded-lg border">
                  <Table>
                    <TableHeader className="sticky top-0 bg-card">
                      <TableRow>
                        <TableHead>{tr("shared.month_2")}</TableHead>
                        <TableHead className="text-right">{tr("credit_calculator.actual_drawdowns")}</TableHead>
                        <TableHead className="text-right">{tr("credit_calculator.actual_balance")}</TableHead>
                        <TableHead className="text-right">{tr("credit_calculator.actual_nominal_interest_2")}</TableHead>
                        <TableHead className="text-right">{tr("credit_calculator.actual_commitment_interest")}</TableHead>
                        <TableHead className="text-right">{tr("credit_calculator.actual_monthly_burden")}</TableHead>
                        <TableHead className="text-right">{tr("credit_calculator.actual_cumulative")}</TableHead>
                        <TableHead className="text-right">{tr("credit_calculator.forecast_drawdowns")}</TableHead>
                        <TableHead className="text-right">{tr("credit_calculator.forecast_balance")}</TableHead>
                        <TableHead className="text-right">{tr("credit_calculator.forecast_nominal_interest_2")}</TableHead>
                        <TableHead className="text-right">
                          {tr("credit_calculator.forecast_commitment_interest")}
                        </TableHead>
                        <TableHead className="text-right">
                          {tr("credit_calculator.forecast_monthly_burden")}
                        </TableHead>
                        <TableHead className="text-right">{tr("credit_calculator.forecast_cumulative")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody className="tabular">
                      {calculation.months.map((month) => (
                        <TableRow key={month.month}>
                          <TableCell>{month.month}</TableCell>
                          <TableCell className="text-right">
                            {eur(month.actualDraws, true)}
                          </TableCell>
                          <TableCell className="text-right">
                            {eur(month.actualBalance, true)}
                          </TableCell>
                          <TableCell className="text-right">
                            {eur(month.actualInterest, true)}
                          </TableCell>
                          <TableCell className="text-right">
                            {eur(month.actualCommitment, true)}
                          </TableCell>
                          <TableCell className="text-right">
                            {eur(month.actualInterest + month.actualCommitment, true)}
                          </TableCell>
                          <TableCell className="text-right">
                            {eur(month.actualCumulative, true)}
                          </TableCell>
                          <TableCell className="text-right">
                            {eur(month.plannedDraws, true)}
                          </TableCell>
                          <TableCell className="text-right">
                            {eur(month.plannedBalance, true)}
                          </TableCell>
                          <TableCell className="text-right">
                            {eur(month.plannedInterest, true)}
                          </TableCell>
                          <TableCell className="text-right">
                            {eur(month.plannedCommitment, true)}
                          </TableCell>
                          <TableCell className="text-right">
                            {eur(month.plannedInterest + month.plannedCommitment, true)}
                          </TableCell>
                          <TableCell className="text-right">
                            {eur(month.plannedCumulative, true)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <Empty>{tr("credit_calculator.no_monthly_values_interest")}</Empty>
              )}
            </div>
          </div>
        )}
      </Panel>
      <EntityDialog
        open={repaymentOpen}
        onOpenChange={setRepaymentOpen}
        title={tr("credit_calculator.record_repayment")}
        fields={[
          { name: "amount", label: tr("credit_calculator.repayment_amount"), type: "number", required: true },
          { name: "repayment_date", label: tr("credit_calculator.repayment_date"), type: "date", required: true },
          { name: "notes", label: tr("shared.notes"), type: "text", full: true },
        ]}
        initial={{ repayment_date: todayISO() }}
        onSubmit={(values) => create.mutateAsync({ table: "credit_repayments", row: values })}
      />
    </>
  );
}

export function CreditSummaryCard() {
  const { ws } = useWorkspace();
  const terms = ws.credit_terms[0];
  const payments = useMemo(
    () => bankFundedPayments(ws.invoices, ws.expenses, terms?.budget_pot_id ?? null),
    [ws.invoices, ws.expenses, terms?.budget_pot_id],
  );
  const calculation = useMemo(
    () => (terms ? calculateCreditCosts(terms, payments, ws.credit_repayments, todayISO()) : null),
    [terms, payments, ws.credit_repayments],
  );
  if (!terms || !calculation) return null;

  const today = new Date();
  const currentMonth = monthKey(today);
  const nextDate = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  const nextMonth = monthKey(nextDate);
  const current = calculation.months.find((month) => month.month === currentMonth);
  const next = calculation.months.find((month) => month.month === nextMonth);
  const monthLabel = (date: Date) =>
    new Intl.DateTimeFormat(currentLocale(), { month: "long", year: "numeric" }).format(date);

  return (
    <Panel
      title={tr("credit_calculator.loan_interest")}
      className="mt-6"
      action={
        <Link to="/kredit" className="text-sm text-primary hover:underline">
          {tr("credit_calculator.loan_details")}
        </Link>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border p-4">
          <h3 className="mb-3 text-sm font-semibold capitalize">{monthLabel(today)}</h3>
          <InterestMonth
            forecastInterest={(current?.plannedInterest ?? 0) + (current?.plannedCommitment ?? 0)}
            actualInterest={(current?.actualInterest ?? 0) + (current?.actualCommitment ?? 0)}
            sollInterest={current?.plannedInterest ?? 0}
            commitmentInterest={current?.plannedCommitment ?? 0}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            {tr("credit_calculator.actual_date")} · {tr("credit_calculator.forecast_month")}
          </p>
        </div>
        <div className="rounded-lg border p-4">
          <h3 className="mb-3 text-sm font-semibold capitalize">{monthLabel(nextDate)}</h3>
          <InterestMonth
            forecastInterest={(next?.plannedInterest ?? 0) + (next?.plannedCommitment ?? 0)}
            sollInterest={next?.plannedInterest ?? 0}
            commitmentInterest={next?.plannedCommitment ?? 0}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            {tr("credit_calculator.estimated_monthly_interest")}
          </p>
        </div>
      </div>
    </Panel>
  );
}

function InterestMonth({
  forecastInterest,
  actualInterest,
  sollInterest,
  commitmentInterest,
}: {
  forecastInterest: number;
  actualInterest?: number;
  sollInterest: number;
  commitmentInterest: number;
}) {
  return (
    <>
      <div className="font-display text-2xl font-semibold tabular">
        {eur(forecastInterest, true)}
      </div>
      <div className="mt-2 grid gap-1 text-xs text-muted-foreground">
        <div className="flex justify-between gap-2">
          <span>{tr("credit_calculator.nominal_interest")}</span>
          <span className="tabular">{eur(sollInterest, true)}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span>{tr("credit_calculator.commitment_interest")}</span>
          <span className="tabular">{eur(commitmentInterest, true)}</span>
        </div>
        {actualInterest !== undefined && (
          <div className="flex justify-between gap-2 border-t pt-1 font-medium text-foreground">
            <span>{tr("credit_calculator.actual_date")}</span>
            <span className="tabular">{eur(actualInterest, true)}</span>
          </div>
        )}
      </div>
    </>
  );
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function CreditMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 font-display text-xl font-semibold tabular">{value}</div>
    </div>
  );
}
