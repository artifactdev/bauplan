import type {
  BudgetPot,
  CreditRepayment,
  CreditTerms,
  Expense,
  Invoice,
  Workspace,
} from "./schema";
import { todayISO } from "./format";

export type ItemSummary = {
  id: string;
  title: string;
  trade_id: string | null;
  planned: number; // entered plan, falling back to accepted offers where no plan exists
  committed: number; // accepted offers
  invoiced: number; // all invoices
  paid: number; // paid invoices
  expected: number; // best estimate of final cost, no double counting
};

/**
 * Expected cost per item = the most concrete figure known:
 * invoices if they exceed the accepted offer, otherwise the accepted offer,
 * otherwise the planned amount. Offers and invoices for the same item are
 * never added together.
 */
export function expectedCost(planned: number, committed: number, invoiced: number) {
  if (invoiced > 0 || committed > 0) return Math.max(committed, invoiced);
  return planned;
}

/** Expenses (receipts, general bills) always count as spent money. Only status "offen" is unpaid. */
const expPaid = (e: Expense) => e.status !== "offen";

export type PotSummary = BudgetPot & { spent: number; paid: number };

/** Totals per payment source (expenses + invoices). */
export function summarizePots(
  pots: BudgetPot[],
  expenses: Expense[],
  invoices: Invoice[],
): PotSummary[] {
  return pots.map((p) => {
    const ex = expenses.filter((e) => e.budget_pot_id === p.id);
    const inv = invoices.filter((i) => i.budget_pot_id === p.id);
    const spent =
      ex.reduce((s, e) => s + Number(e.amount), 0) + inv.reduce((s, i) => s + Number(i.amount), 0);
    const paid =
      ex.filter(expPaid).reduce((s, e) => s + Number(e.amount), 0) +
      inv.filter((i) => i.paid).reduce((s, i) => s + Number(i.amount), 0);
    return { ...p, spent, paid };
  });
}

/** True when an item counts against the total budget: no source, or a source flagged deducts_from_budget. */
export function countsTowardBudget(potId: string | null | undefined, pots: BudgetPot[]) {
  if (!potId) return true;
  const p = pots.find((x) => x.id === potId);
  return !p || p.deducts_from_budget;
}

export function summarize(
  wsIn: Pick<Workspace, "cost_items" | "offers" | "invoices" | "projects"> & {
    expenses?: Expense[];
    budget_pots?: BudgetPot[];
  },
) {
  // Only transactions assigned to a cost item and a budget-counting source
  // participate in the project budget.
  const potList = wsIn.budget_pots ?? [];
  const costItemIds = new Set(wsIn.cost_items.map((item) => item.id));
  const invoices = wsIn.invoices.filter(
    (invoice) =>
      invoice.cost_item_id &&
      costItemIds.has(invoice.cost_item_id) &&
      countsTowardBudget(invoice.budget_pot_id, potList),
  );
  const allExpenses = wsIn.expenses ?? [];
  const expenses = allExpenses.filter(
    (expense) =>
      expense.cost_item_id &&
      costItemIds.has(expense.cost_item_id) &&
      countsTowardBudget(expense.budget_pot_id, potList),
  );
  const pots = summarizePots(potList, allExpenses, wsIn.invoices);
  const items: ItemSummary[] = wsIn.cost_items.map((c) => {
    const committed = wsIn.offers
      .filter((o) => o.cost_item_id === c.id && o.status === "accepted")
      .reduce((s, o) => s + Number(o.amount), 0);
    const inv = invoices.filter((i) => i.cost_item_id === c.id);
    const ex = expenses.filter((e) => e.cost_item_id === c.id);
    const invoiced =
      inv.reduce((s, i) => s + Number(i.amount), 0) + ex.reduce((s, e) => s + Number(e.amount), 0);
    const paid =
      inv.filter((i) => i.paid).reduce((s, i) => s + Number(i.amount), 0) +
      ex.filter(expPaid).reduce((s, e) => s + Number(e.amount), 0);
    const enteredPlan = Number(c.planned);
    const planned = enteredPlan > 0 ? enteredPlan : committed;
    return {
      id: c.id,
      title: c.title,
      trade_id: c.trade_id,
      planned,
      committed,
      invoiced,
      paid,
      expected: expectedCost(planned, committed, invoiced),
    };
  });
  const sum = (k: keyof ItemSummary) => items.reduce((s, i) => s + (i[k] as number), 0);

  const budget = Number(wsIn.projects[0]?.total_budget ?? 0);
  const planned = sum("planned");
  const committed = sum("committed");
  const invoiced = sum("invoiced");
  const paid = sum("paid");
  const expected = sum("expected");
  const expensesTotal = expenses.reduce((s, e) => s + Number(e.amount), 0);
  const reimbursed = expenses
    .filter((e) => e.status === "erstattet")
    .reduce((s, e) => s + Number(e.amount), 0);

  return {
    items,
    budget,
    planned,
    committed,
    invoiced,
    paid,
    open: invoiced - paid,
    expected,
    remaining: budget - expected,
    expensesTotal,
    reimbursed,
    pots,
  };
}

export function isOverdue(due: string | null, done: boolean, today = todayISO()) {
  return !!due && !done && due < today;
}

export type CreditPayment = {
  amount: number;
  date: string;
  actual: boolean;
};

export type CreditMonth = {
  month: string;
  actualDraws: number;
  plannedDraws: number;
  actualBalance: number;
  plannedBalance: number;
  actualInterest: number;
  actualCommitment: number;
  plannedInterest: number;
  plannedCommitment: number;
  actualCumulative: number;
  plannedCumulative: number;
};

export type CreditSummary = {
  months: CreditMonth[];
  actualInterest: number;
  actualCommitment: number;
  plannedInterest: number;
  plannedCommitment: number;
  actualBalance: number;
  plannedBalance: number;
  annuity: number | null;
};

function validISODate(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function shiftISODate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function monthStart(value: string) {
  return `${value.slice(0, 7)}-01`;
}

function nextMonth(value: string) {
  const date = new Date(`${monthStart(value)}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  return date.toISOString().slice(0, 10);
}

function dayCountMonth(value: string) {
  return (
    (Date.parse(`${nextMonth(value)}T00:00:00Z`) - Date.parse(`${monthStart(value)}T00:00:00Z`)) /
    86_400_000
  );
}

export function annuityPayment(balance: number, annualRate: number, months: number): number | null {
  if (
    balance <= 0 ||
    !Number.isFinite(balance) ||
    !Number.isFinite(annualRate) ||
    !Number.isInteger(months) ||
    months <= 0
  )
    return null;
  const monthlyRate = annualRate / 100 / 12;
  if (monthlyRate === 0) return balance / months;
  const growth = (1 + monthlyRate) ** months;
  return (balance * monthlyRate * growth) / (growth - 1);
}

/**
 * Calculates actual costs from paid bank-funded records and a forecast from
 * those records plus unpaid planned bank-funded records. Dates are treated as
 * inclusive for interest accrual; the loan repayment date ends the calculation.
 */
export function calculateCreditCosts(
  terms: CreditTerms,
  payments: CreditPayment[],
  repayments: CreditRepayment[],
  today = todayISO(),
): CreditSummary | null {
  const {
    total_credit: principal,
    annual_rate: annualRate,
    commitment_rate: commitmentRate,
    day_basis: dayBasis,
    interest_free_start: start,
    interest_free_end: graceEnd,
    repayment_start: repaymentStart,
    commitment_free_end: commitmentFreeEnd,
  } = terms;
  if (
    !Number.isFinite(principal) ||
    principal <= 0 ||
    !Number.isFinite(annualRate) ||
    annualRate < 0 ||
    !Number.isFinite(commitmentRate) ||
    commitmentRate < 0 ||
    ![360, 365].includes(dayBasis)
  ) {
    return null;
  }

  if (validISODate(terms.first_installment_date)) {
    if (!validISODate(terms.commitment_start ?? terms.commitment_free_end)) return null;
    return calculateContractCreditCosts(terms, payments, repayments, today);
  }

  if (
    !validISODate(start) ||
    !validISODate(graceEnd) ||
    !validISODate(repaymentStart) ||
    !validISODate(commitmentFreeEnd) ||
    repaymentStart < start
  )
    return null;

  const plannedEnd = [repaymentStart, shiftISODate(graceEnd, 1)].sort()[0]!;
  const actualEnd =
    repaymentStart < shiftISODate(today, 1) ? repaymentStart : shiftISODate(today, 1);
  const actualPayments = payments.filter((p) => p.actual && validISODate(p.date) && p.amount > 0);
  const plannedPayments = payments.filter((p) => validISODate(p.date) && p.amount > 0);
  const validRepayments = repayments.filter((r) => validISODate(r.repayment_date) && r.amount > 0);
  const actual = calculateCreditScenario(
    start,
    actualEnd,
    principal,
    annualRate,
    commitmentRate,
    dayBasis,
    commitmentFreeEnd,
    actualPayments,
    validRepayments,
  );
  const planned = calculateCreditScenario(
    start,
    plannedEnd,
    principal,
    annualRate,
    commitmentRate,
    dayBasis,
    commitmentFreeEnd,
    plannedPayments,
    validRepayments,
  );
  const monthKeys = [...new Set([...actual.months.keys(), ...planned.months.keys()])].sort();
  let actualCumulative = 0;
  let plannedCumulative = 0;
  const months = monthKeys.map((month) => {
    const a = actual.months.get(month);
    const p = planned.months.get(month);
    actualCumulative += (a?.interest ?? 0) + (a?.commitment ?? 0);
    plannedCumulative += (p?.interest ?? 0) + (p?.commitment ?? 0);
    return {
      month: month.slice(0, 7),
      actualDraws: a?.draws ?? 0,
      plannedDraws: p?.draws ?? 0,
      actualBalance: a?.balance ?? actual.balance,
      plannedBalance: p?.balance ?? planned.balance,
      actualInterest: a?.interest ?? 0,
      actualCommitment: a?.commitment ?? 0,
      plannedInterest: p?.interest ?? 0,
      plannedCommitment: p?.commitment ?? 0,
      actualCumulative,
      plannedCumulative,
    };
  });
  const actualBalance = actual.balance;
  const plannedBalance = planned.balance;
  return {
    months,
    actualInterest: actual.interest,
    actualCommitment: actual.commitment,
    plannedInterest: planned.interest,
    plannedCommitment: planned.commitment,
    actualBalance,
    plannedBalance,
    annuity: terms.repayment_months
      ? annuityPayment(plannedBalance, annualRate, terms.repayment_months)
      : null,
  };
}

function addMonths(value: string, months: number) {
  const [year = 0, month = 1, day = 1] = value.split("-").map(Number);
  const firstOfMonth = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(firstOfMonth.getUTCFullYear(), firstOfMonth.getUTCMonth() + 1, 0),
  ).getUTCDate();
  firstOfMonth.setUTCDate(Math.min(day, lastDay));
  return firstOfMonth.toISOString().slice(0, 10);
}

function calculateContractCreditCosts(
  terms: CreditTerms,
  payments: CreditPayment[],
  repayments: CreditRepayment[],
  today: string,
): CreditSummary {
  const firstInstallment = terms.first_installment_date!;
  const commitmentStart = validISODate(terms.commitment_start)
    ? terms.commitment_start
    : validISODate(terms.commitment_free_end)
      ? shiftISODate(terms.commitment_free_end, 1)
      : firstInstallment;
  const paymentDates = payments
    .filter((payment) => validISODate(payment.date))
    .map((payment) => payment.date);
  const start = [...paymentDates, commitmentStart, monthStart(today)].sort()[0]!;
  const count =
    Number.isInteger(terms.repayment_count) && Number(terms.repayment_count) > 0
      ? Number(terms.repayment_count)
      : Number.isInteger(terms.repayment_months) && Number(terms.repayment_months) > 0
        ? Number(terms.repayment_months)
        : 360;
  const plannedEnd = shiftISODate(addMonths(firstInstallment, count - 1), 1);
  const actualEnd = [plannedEnd, shiftISODate(today, 1)].sort()[0]!;
  const principal = Number(terms.total_credit);
  const annualRate = Number(terms.annual_rate);
  const commitmentRate = Number(terms.commitment_rate);
  const dayBasis = Number(terms.day_basis);
  const actual = calculateContractScenario(
    start,
    actualEnd,
    principal,
    annualRate,
    commitmentRate,
    dayBasis,
    commitmentStart,
    payments.filter((payment) => payment.actual),
    repayments,
    firstInstallment,
    Number(terms.monthly_installment ?? 0),
    count,
    false,
  );
  const planned = calculateContractScenario(
    start,
    plannedEnd,
    principal,
    annualRate,
    commitmentRate,
    dayBasis,
    commitmentStart,
    payments,
    repayments,
    firstInstallment,
    Number(terms.monthly_installment ?? 0),
    count,
    true,
  );
  const monthKeys = [...new Set([...actual.months.keys(), ...planned.months.keys()])].sort();
  let actualCumulative = 0;
  let plannedCumulative = 0;
  const months = monthKeys.map((month) => {
    const a = actual.months.get(month);
    const p = planned.months.get(month);
    actualCumulative += (a?.interest ?? 0) + (a?.commitment ?? 0);
    plannedCumulative += (p?.interest ?? 0) + (p?.commitment ?? 0);
    return {
      month: month.slice(0, 7),
      actualDraws: a?.draws ?? 0,
      plannedDraws: p?.draws ?? 0,
      actualBalance: a?.balance ?? 0,
      plannedBalance: p?.balance ?? 0,
      actualInterest: a?.interest ?? 0,
      actualCommitment: a?.commitment ?? 0,
      plannedInterest: p?.interest ?? 0,
      plannedCommitment: p?.commitment ?? 0,
      actualCumulative,
      plannedCumulative,
    };
  });
  return {
    months,
    actualInterest: actual.interest,
    actualCommitment: actual.commitment,
    plannedInterest: planned.interest,
    plannedCommitment: planned.commitment,
    actualBalance: actual.balance,
    plannedBalance: planned.balance,
    annuity:
      Number(terms.monthly_installment) > 0
        ? Number(terms.monthly_installment)
        : terms.repayment_months
          ? annuityPayment(planned.balance, annualRate, terms.repayment_months)
          : null,
  };
}

function calculateContractScenario(
  start: string,
  end: string,
  principal: number,
  annualRate: number,
  commitmentRate: number,
  dayBasis: number,
  commitmentStart: string,
  payments: CreditPayment[],
  repayments: CreditRepayment[],
  firstInstallment: string,
  monthlyInstallment: number,
  installmentCount: number,
  applyScheduledInstallments: boolean,
) {
  const movements = new Map<string, { draw: number; repay: number }>();
  const scheduledInstallments = new Set<string>();
  for (let installment = 0; installment < installmentCount; installment += 1) {
    scheduledInstallments.add(addMonths(firstInstallment, installment));
  }
  const addMovement = (date: string, key: "draw" | "repay", amount: number) => {
    if (date < start || date >= end) return;
    const movement = movements.get(date) ?? { draw: 0, repay: 0 };
    movement[key] += amount;
    movements.set(date, movement);
  };
  for (const payment of payments) {
    addMovement(payment.date, "draw", Number(payment.amount));
  }
  for (const repayment of repayments) {
    addMovement(repayment.repayment_date, "repay", Number(repayment.amount));
  }

  const months = new Map<
    string,
    { draws: number; interest: number; commitment: number; balance: number }
  >();
  let balance = 0;
  let interest = 0;
  let commitment = 0;
  let interestSinceInstallment = 0;
  for (let date = start; date < end; date = shiftISODate(date, 1)) {
    const movement = movements.get(date);
    if (movement)
      balance = Math.min(principal, Math.max(0, balance + movement.draw - movement.repay));
    const dayInterest = (balance * annualRate) / 100 / dayBasis;
    const dayCommitment =
      date >= commitmentStart
        ? (Math.max(0, principal - balance) * commitmentRate) / 100 / dayCountMonth(date)
        : 0;
    const month = monthStart(date);
    const row = months.get(month) ?? { draws: 0, interest: 0, commitment: 0, balance: 0 };
    row.draws += movement?.draw ?? 0;
    row.interest += dayInterest;
    row.commitment += dayCommitment;
    interest += dayInterest;
    commitment += dayCommitment;
    interestSinceInstallment += dayInterest;
    if (applyScheduledInstallments && scheduledInstallments.has(date) && balance > 0) {
      const principalRepayment = Math.max(0, monthlyInstallment - interestSinceInstallment);
      balance = Math.max(0, balance - principalRepayment);
      interestSinceInstallment = 0;
    }
    row.balance = balance;
    months.set(month, row);
  }
  return { months, balance, interest, commitment };
}

function calculateCreditScenario(
  start: string,
  end: string,
  principal: number,
  annualRate: number,
  commitmentRate: number,
  dayBasis: number,
  commitmentFreeEnd: string,
  payments: CreditPayment[],
  repayments: CreditRepayment[],
) {
  const movements = new Map<string, { draw: number; repay: number }>();
  const addMovement = (date: string, kind: "draw" | "repay", amount: number) => {
    if (date < start || date >= end) return;
    const movement = movements.get(date) ?? { draw: 0, repay: 0 };
    movement[kind] += amount;
    movements.set(date, movement);
  };
  for (const payment of payments) {
    addMovement(payment.date, "draw", payment.amount);
  }
  for (const repayment of repayments) {
    addMovement(repayment.repayment_date, "repay", Number(repayment.amount));
  }

  const months = new Map<
    string,
    { draws: number; interest: number; commitment: number; balance: number }
  >();
  let balance = 0;
  let interest = 0;
  let commitment = 0;
  for (let date = start; date < end; date = shiftISODate(date, 1)) {
    const movement = movements.get(date);
    if (movement)
      balance = Math.min(principal, Math.max(0, balance + movement.draw - movement.repay));
    const dayInterest = (balance * annualRate) / 100 / dayBasis;
    const dayCommitment =
      date > commitmentFreeEnd
        ? (Math.max(0, principal - balance) * commitmentRate) / 100 / dayCountMonth(date)
        : 0;
    const month = monthStart(date);
    const row = months.get(month) ?? { draws: 0, interest: 0, commitment: 0, balance: 0 };
    row.draws += movement?.draw ?? 0;
    row.interest += dayInterest;
    row.commitment += dayCommitment;
    row.balance = balance;
    months.set(month, row);
    interest += dayInterest;
    commitment += dayCommitment;
  }
  return { months, balance, interest, commitment };
}

export function bankFundedPayments(
  invoices: Invoice[],
  expenses: Expense[],
  bankPotId: string | null,
): CreditPayment[] {
  if (!bankPotId) return [];
  const result: CreditPayment[] = [];
  for (const invoice of invoices) {
    if (invoice.budget_pot_id !== bankPotId) continue;
    const actual = invoice.paid;
    const date = actual
      ? (invoice.payment_date ?? invoice.invoice_date)
      : (invoice.payment_date ?? invoice.due_date ?? invoice.invoice_date);
    if (date) result.push({ amount: Number(invoice.amount), date, actual });
  }
  for (const expense of expenses) {
    if (expense.budget_pot_id !== bankPotId) continue;
    const actual = expense.status !== "offen";
    const date = actual
      ? (expense.payment_date ?? expense.expense_date)
      : (expense.payment_date ?? expense.due_date ?? expense.expense_date);
    if (date) result.push({ amount: Number(expense.amount), date, actual });
  }
  return result;
}
