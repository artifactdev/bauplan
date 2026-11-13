import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import { currentLocale, tr } from "@/i18n";
import { useMutations, useWorkspace } from "@/hooks/use-workspace";
import {
  bankFundedPayments,
  calculateCreditCosts,
  creditMonthlyBurden,
  creditTimeline,
  installmentCount,
  suggestedInstallment,
} from "@/lib/calc";
import { eur, fmtDate, todayISO } from "@/lib/format";
import type { CreditTerms } from "@/lib/schema";
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
import { CreditTimeline } from "@/components/app/CreditTimeline";
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
  assumed_full_draw_date: string;
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
  assumed_full_draw_date: "",
  day_basis: "30",
});

/** Installment and count are derived; only keep them in the form when they deviate from the derived values. */
function installmentOverrides(terms: CreditTerms) {
  const rate = Number(terms.annual_rate);
  const total = Number(terms.total_credit);
  const stored = Number(terms.monthly_installment);
  const suggested = suggestedInstallment(total, rate, Number(terms.repayment_rate ?? 0));
  const installmentIsDerived = suggested !== null && Math.abs(suggested - stored) < 0.015;
  const effective = stored > 0 ? stored : (suggested ?? 0);
  const count = Number(terms.repayment_count);
  const countIsDerived = installmentCount(total, rate, effective) === count;
  return {
    monthly_installment: stored > 0 && !installmentIsDerived ? String(stored) : "",
    repayment_count: count > 0 && !countIsDerived ? String(count) : "",
  };
}

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
            ...installmentOverrides(terms),
            first_installment_date: terms.first_installment_date ?? terms.repayment_start ?? "",
            commitment_rate: String(terms.commitment_rate ?? ""),
            commitment_start: terms.commitment_start ?? "",
            assumed_full_draw_date: terms.assumed_full_draw_date ?? "",
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
  const timeline = useMemo(
    () =>
      calculation ? creditTimeline(calculation, todayISO(), terms?.first_installment_date) : [],
    [calculation, terms],
  );
  const check = useMemo(() => {
    const total = Number(draft.total_credit);
    const rate = Number(draft.annual_rate);
    const installment =
      Number(draft.monthly_installment) > 0
        ? Number(draft.monthly_installment)
        : suggestedInstallment(total, rate, Number(draft.repayment_rate));
    if (!(total > 0) || installment === null) return null;
    const drawn = Math.min(
      total,
      payments
        .filter((payment) => payment.actual)
        .reduce((sum, payment) => sum + payment.amount, 0),
    );
    return {
      drawn,
      undrawn: Math.max(0, total - drawn),
      interestNow: (drawn * rate) / 1200,
      installment,
      count:
        Number(draft.repayment_count) > 0
          ? Number(draft.repayment_count)
          : installmentCount(total, rate, installment),
      commitment: (Math.max(0, total - drawn) * Number(draft.commitment_rate || 0)) / 100,
    };
  }, [draft, payments]);
  const undrawn = terms
    ? Number(terms.total_credit) - payments.reduce((sum, payment) => sum + payment.amount, 0)
    : 0;
  const outlook = useMemo(
    () =>
      calculation
        ? {
            ...creditMonthlyBurden(calculation, terms?.first_installment_date, todayISO()),
            first: terms?.first_installment_date ?? null,
          }
        : null,
    [calculation, terms],
  );

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
    const monthlyInstallment =
      Number(draft.monthly_installment) > 0
        ? Number(draft.monthly_installment)
        : (suggestedInstallment(totalCredit, annualRate, Number(draft.repayment_rate)) ?? 0);
    const repaymentCount =
      Number(draft.repayment_count) > 0
        ? Number(draft.repayment_count)
        : (installmentCount(totalCredit, annualRate, monthlyInstallment) ?? 0);
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
      assumed_full_draw_date: draft.assumed_full_draw_date || null,
      commitment_free_end: null,
      repayment_months: repaymentCount,
      day_basis: Number(draft.day_basis),
    };
    if (terms) update.mutate({ table: "credit_terms", id: terms.id, patch: row });
    else create.mutate({ table: "credit_terms", row });
  };

  return (
    <>
      <PageHeader title={tr("shared.loan")} subtitle={tr("shared.keep_track_loan_terms")} />
      <Panel title={tr("credit_calculator.loan_interest_costs")}>
        <p className="mb-4 text-sm text-muted-foreground">
          {tr("credit_calculator.bank_funded_invoices_expenses")}
        </p>
        {!ws.budget_pots.length && (
          <Empty>{tr("credit_calculator.first_create_payment_source")}</Empty>
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
              <h3 className="mb-1 text-sm font-semibold">
                {tr("credit_calculator.form_main_title")}
              </h3>
              <p className="mb-3 text-sm text-muted-foreground">
                {tr("credit_calculator.form_main_hint")}
              </p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <FormField
                  id="credit-total_credit"
                  label={tr("credit_calculator.f_total_credit")}
                  type="number"
                  step="0.01"
                  required
                  value={draft.total_credit}
                  onChange={(value) => setDraft((d) => ({ ...d, total_credit: value }))}
                />
                <FormField
                  id="credit-annual_rate"
                  label={tr("credit_calculator.f_annual_rate")}
                  type="number"
                  step="0.01"
                  required
                  value={draft.annual_rate}
                  onChange={(value) => setDraft((d) => ({ ...d, annual_rate: value }))}
                />
                <FormField
                  id="credit-repayment_rate"
                  label={tr("credit_calculator.f_repayment_rate")}
                  type="number"
                  step="0.01"
                  required
                  value={draft.repayment_rate}
                  onChange={(value) => setDraft((d) => ({ ...d, repayment_rate: value }))}
                />
                <FormField
                  id="credit-commitment-start"
                  label={tr("credit_calculator.f_repayment_free_until")}
                  hint={tr("credit_calculator.f_repayment_free_hint")}
                  type="date"
                  required
                  value={draft.commitment_start}
                  onChange={(value) =>
                    setDraft((d) => ({
                      ...d,
                      commitment_start: value,
                      first_installment_date: value,
                    }))
                  }
                />
                <FormField
                  id="credit-commitment-rate"
                  label={tr("shared.commitment_interest_per_month")}
                  hint={tr("credit_calculator.f_commitment_hint")}
                  type="number"
                  step="0.01"
                  required
                  value={draft.commitment_rate}
                  onChange={(value) => setDraft((d) => ({ ...d, commitment_rate: value }))}
                />
              </div>
            </div>
            {check && (
              <section
                aria-label={tr("credit_calculator.check_title")}
                className="rounded-xl border border-primary/30 bg-accent/20 p-4"
              >
                <h3 className="mb-1 text-sm font-semibold">
                  {tr("credit_calculator.check_title")}
                </h3>
                <p className="mb-3 text-xs text-muted-foreground">
                  {tr("credit_calculator.check_hint")}
                </p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <CreditMetric
                    label={tr("credit_calculator.check_now", { drawn: eur(check.drawn) })}
                    value={eur(check.interestNow, true)}
                  />
                  <CreditMetric
                    label={tr("credit_calculator.check_installment")}
                    value={eur(check.installment, true)}
                  />
                  <CreditMetric
                    label={tr("credit_calculator.check_count")}
                    value={check.count ? String(check.count) : "–"}
                  />
                  <CreditMetric
                    label={tr("credit_calculator.check_commitment", { rest: eur(check.undrawn) })}
                    value={eur(check.commitment, true)}
                  />
                </div>
                {draft.day_basis !== "30" && (
                  <p className="mt-3 text-xs text-warning">
                    {tr("credit_calculator.check_method_note")}
                  </p>
                )}
              </section>
            )}
            <details className="rounded-xl border p-4">
              <summary className="cursor-pointer text-sm font-semibold">
                {tr("credit_calculator.form_more_title")}
              </summary>
              <p className="mb-3 mt-2 text-sm text-muted-foreground">
                {tr("credit_calculator.form_more_hint")}
              </p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <FormField
                  id="credit-assumed-draw"
                  label={tr("credit_calculator.assumed_full_draw_date")}
                  hint={tr("credit_calculator.assumed_full_draw_hint")}
                  type="date"
                  value={draft.assumed_full_draw_date}
                  onChange={(value) => setDraft((d) => ({ ...d, assumed_full_draw_date: value }))}
                />
                <FormField
                  id="credit-effective_rate"
                  label={tr("credit_calculator.f_effective_rate")}
                  type="number"
                  step="0.01"
                  value={draft.effective_rate}
                  onChange={(value) => setDraft((d) => ({ ...d, effective_rate: value }))}
                />
                <FormField
                  id="credit-fixed_rate_end"
                  label={tr("credit_calculator.f_fixed_rate_end")}
                  type="date"
                  value={draft.fixed_rate_end}
                  onChange={(value) => setDraft((d) => ({ ...d, fixed_rate_end: value }))}
                />
                <FormField
                  id="credit-payout_rate"
                  label={tr("credit_calculator.f_payout_rate")}
                  type="number"
                  step="0.01"
                  value={draft.payout_rate}
                  onChange={(value) => setDraft((d) => ({ ...d, payout_rate: value }))}
                />
                <FormField
                  id="credit-monthly_installment"
                  label={tr("credit_calculator.f_installment_override")}
                  hint={tr("credit_calculator.f_override_hint")}
                  type="number"
                  step="0.01"
                  placeholder={check ? String(check.installment) : undefined}
                  value={draft.monthly_installment}
                  onChange={(value) => setDraft((d) => ({ ...d, monthly_installment: value }))}
                />
                <FormField
                  id="credit-repayment_count"
                  label={tr("credit_calculator.f_count_override")}
                  hint={tr("credit_calculator.f_override_hint")}
                  type="number"
                  step="1"
                  placeholder={check?.count ? String(check.count) : undefined}
                  value={draft.repayment_count}
                  onChange={(value) => setDraft((d) => ({ ...d, repayment_count: value }))}
                />
                <div className="grid gap-1.5">
                  <Label htmlFor="credit-day-basis">
                    {tr("credit_calculator.interest_days_per_year")}
                  </Label>
                  <Select
                    value={draft.day_basis}
                    // Radix emits an empty value while items mount; ignore it so the loaded value is kept.
                    onValueChange={(value) =>
                      value && setDraft((d) => ({ ...d, day_basis: value }))
                    }
                  >
                    <SelectTrigger id="credit-day-basis">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="30">{tr("credit_calculator.30_360")}</SelectItem>
                      <SelectItem value="360">
                        {tr("credit_calculator.360_days_act_360")}
                      </SelectItem>
                      <SelectItem value="365">
                        {tr("credit_calculator.365_days_act_365")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </details>
            <p className="text-sm text-muted-foreground">
              {tr("credit_calculator.partial_drawdowns_made_up")}
            </p>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                {tr("credit_calculator.contract_date_includes_that")}
              </p>
              <Button type="submit" disabled={saving}>
                {tr("credit_calculator.save_loan_terms")}
              </Button>
            </div>
          </form>
        )}

        {terms && !calculation && (
          <p className="mt-4 text-sm text-warning">
            {tr("credit_calculator.complete_loan_terms_calculate")}
          </p>
        )}
        {calculation && (
          <div className="mt-6 grid gap-5">
            <div className="grid gap-4 lg:grid-cols-2">
              <section className="rounded-xl border p-4">
                <h3 className="mb-1 text-sm font-semibold">
                  {tr("credit_calculator.actual_date")}
                </h3>
                <p className="mb-3 text-xs text-muted-foreground">
                  {tr("credit_calculator.actual_accrued_hint")}
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <CreditMetric
                    label={tr("credit_calculator.actual_nominal_interest")}
                    value={eur(calculation.actualInterest, true)}
                  />
                  <CreditMetric
                    label={tr("credit_calculator.actual_commitment_interest_2")}
                    value={eur(calculation.actualCommitment, true)}
                  />
                  <CreditMetric
                    label={tr("credit_calculator.actual_total_interest")}
                    value={eur(calculation.actualInterest + calculation.actualCommitment, true)}
                  />
                </div>
              </section>
              <section className="rounded-xl border border-primary/30 bg-accent/20 p-4">
                <h3 className="mb-3 text-sm font-semibold">
                  {tr("credit_calculator.forecast_group")}
                </h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <CreditMetric
                    label={tr("credit_calculator.forecast_nominal_interest")}
                    value={eur(calculation.plannedInterest, true)}
                  />
                  <CreditMetric
                    label={tr("credit_calculator.forecast_commitment_interest_2")}
                    value={eur(calculation.plannedCommitment, true)}
                  />
                  <CreditMetric
                    label={tr("credit_calculator.forecast_total_interest")}
                    value={eur(calculation.plannedInterest + calculation.plannedCommitment, true)}
                  />
                  <CreditMetric
                    label={tr("credit_calculator.balance_repayment_start")}
                    value={eur(calculation.balanceAtRepaymentStart, true)}
                  />
                </div>
              </section>
            </div>
            {terms && !terms.assumed_full_draw_date && undrawn > 0 && (
              <p className="rounded-lg border bg-muted/50 p-3 text-sm text-muted-foreground">
                {tr("credit_calculator.undrawn_warning", { amount: eur(undrawn) })}
              </p>
            )}
            {outlook && (outlook.now || outlook.afterFirstInstallment) && (
              <section className="rounded-xl border p-4">
                <h3 className="mb-1 text-sm font-semibold">
                  {tr("credit_calculator.monthly_burden_title")}
                </h3>
                <p className="mb-3 text-xs text-muted-foreground">
                  {tr("credit_calculator.monthly_burden_hint")}
                </p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {outlook.now && (
                    <CreditMetric
                      label={tr("credit_calculator.burden_now")}
                      value={eur(outlook.now.payment + outlook.now.commitment, true)}
                    />
                  )}
                  {outlook.afterFirstInstallment && (
                    <>
                      <CreditMetric
                        label={tr("credit_calculator.burden_installment", {
                          date: fmtDate(outlook.first),
                        })}
                        value={eur(outlook.afterFirstInstallment.payment, true)}
                      />
                      <CreditMetric
                        label={tr("credit_calculator.burden_commitment_after")}
                        value={eur(outlook.afterFirstInstallment.commitment, true)}
                      />
                      <CreditMetric
                        label={tr("credit_calculator.burden_total_after")}
                        value={eur(
                          outlook.afterFirstInstallment.payment +
                            outlook.afterFirstInstallment.commitment,
                          true,
                        )}
                      />
                    </>
                  )}
                </div>
              </section>
            )}
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
                  <li
                    key={repayment.id}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-lg border p-3 text-sm sm:flex"
                  >
                    <span className="text-xs text-muted-foreground sm:text-sm">
                      {fmtDate(repayment.repayment_date)}
                    </span>
                    <span className="col-start-1 row-start-2 min-w-0 break-words sm:flex-1">
                      {repayment.notes || tr("credit_calculator.repayment")}
                    </span>
                    <span className="col-start-2 row-start-1 text-right font-medium tabular sm:order-3">
                      {eur(repayment.amount, true)}
                    </span>
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

            {timeline.length ? (
              <CreditTimeline rows={timeline} />
            ) : (
              <Empty>{tr("credit_calculator.no_monthly_values_interest")}</Empty>
            )}
          </div>
        )}
      </Panel>
      <EntityDialog
        open={repaymentOpen}
        onOpenChange={setRepaymentOpen}
        title={tr("credit_calculator.record_repayment")}
        fields={[
          {
            name: "amount",
            label: tr("credit_calculator.repayment_amount"),
            type: "number",
            required: true,
          },
          {
            name: "repayment_date",
            label: tr("credit_calculator.repayment_date"),
            type: "date",
            required: true,
          },
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

function FormField({
  id,
  label,
  hint,
  type,
  step,
  required,
  placeholder,
  value,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  type: "number" | "date";
  step?: string;
  required?: boolean;
  placeholder?: string | undefined;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid content-start gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        min={type === "number" ? 0 : undefined}
        step={step}
        required={required}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function CreditMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 font-display text-xl font-semibold tabular">{value}</div>
    </div>
  );
}
