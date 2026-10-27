# Budget logic

Implemented in `src/lib/calc.ts`, covered by `src/lib/calc.test.ts`.

## Terms

| Term          | Meaning                                     |
| ------------- | ------------------------------------------- |
| **Planned**   | Planned amount for the cost item            |
| **Committed** | Sum of **accepted** quotes                  |
| **Invoiced**  | Sum of expenses, including invoice expenses |
| **Expected**  | Best estimate of final costs                |
| **Paid**      | Expenses with status ≠ open                 |
| **Remaining** | Total budget − Expected                     |

## Financing

The project's existing `total_budget` field is now presented as **Initial bank budget**. Its stored value is preserved during upgrades; it is not increased or rewritten when additional funds arrive.

Record received money under **Budget → Additional funding**, with a payment source (for example **Oma**), positive amount, received date, and optional note. The source picker can create a new budget-counting payment source inline. Multiple receipts may belong to the same source.

**Total budget = initial bank budget + all recorded incoming funds.** A received payment is financing, not a negative expense, and does not increase incurred or paid costs. Actual expenses are recorded only once under Expenses, selecting the matching source. For example, €100,000 initial bank budget + €10,000 received − €3,000 eligible expenses leaves €107,000 when there are no other planned/committed costs.

The Budget page shows the bank/additional-funding breakdown, an editable ledger, and received/spent/remaining totals per funded source. Source balances include all assigned expenses (including open expenses and expenses without cost items); project expected/paid totals retain the cost-item rules below. Negative source balances are shown, not silently capped. Editing or deleting a receipt updates the total budget, but never changes existing expenses. A source with recorded incoming funds cannot be deleted or excluded from budget deductions until its entries are moved or removed.

Additional funds do not change the bank loan principal or create bank drawdowns. Credit calculations still include only expenses paid from the configured bank source. Existing projects and workspaces without funding entries behave as before.

## Rules

1. **No double counting:** per cost item use the larger of accepted quotes and incurred expenses when either is present; otherwise use the planned amount. A quote and its expenses are never added together. Multiple partial invoices are separate expenses, optionally linked to the same quote.
2. Only **accepted** quotes count. **Requested**, received, and rejected quotes have no effect.
3. Only records assigned to an existing cost item contribute to the project budget. Trades group cost items; they are not separate budget units.
4. Eligible **expenses** count as incurred costs. Status "open" = not yet paid; "paid", "submitted", and "reimbursed" = paid.
5. **Reimbursed expenses** remain counted as spent and are not credited back to the budget (they are shown separately).

## Payment sources

Expenses have a "Paid from" field (e.g. **Bank**, **Private**). Sources are managed in **Settings → Payment sources**, each with a switch "Deduct from total budget". Only items from deducting sources (or with no source), linked to a valid cost item, count against the total budget; others (e.g. tools paid privately) still appear in the expenses overview with per-source totals.

## Credit interest calculator

Loan terms, repayments, and the full monthly calculation are managed on the **Credit** page. Enter the contract's loan/net loan amount once, fixed nominal rate, monthly installment, installment count, and the single date by which the loan must be fully drawn. That date is also the start date for commitment interest and the first scheduled full installment. Effective annual rate, fixed-rate end, payout rate, and repayment rate are captured for reference; the nominal rate is used for interest calculations. The dashboard shows the current month's forecast and actual interest-to-date, plus the next month's forecast, once loan terms are configured. The calculator uses the selected payment source as the credit source. Non-open expenses are actual bank-funded drawdowns; open expenses are included in the forecast. The planned/actual payment date is preferred. Open expenses fall back to their due date, then expense date; paid expenses fall back directly to their expense date. Migrated invoices retain their original dates and therefore the same drawdown timing.

Interest is accrued daily on the outstanding drawn balance. The contract installment is projected monthly from the full-drawdown date; its interest portion is the accrued interest since the previous installment and the remainder reduces principal. The selected 360/365 denominator is used for nominal interest. Commitment interest is prorated by the number of calendar days in each month on the undrawn amount from the contract's commitment-interest date (inclusive). The outstanding balance is capped at the configured total credit and cannot fall below zero.

Actual costs use only payments marked paid; the forecast also includes unpaid entries with a planned date. Manually recorded repayments reduce the balance in both scenarios; the contract installment is projected only in the forecast. These are estimates; confirm day-count, fee and payment-date rules against the loan agreement.

## Tests

Coverage includes: planned amount without orders, no double counting of quote + invoice, rejected and requested quotes ignored, expense statuses, daily credit interest, repayment effects, source-aware actual/forecast payments, and zero-interest annuity calculations.
