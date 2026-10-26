# Budget logic

Implemented in `src/lib/calc.ts`, covered by `src/lib/calc.test.ts`.

## Terms

| Term          | Meaning                                     |
| ------------- | ------------------------------------------- |
| **Planned**   | Planned amount for the cost item            |
| **Committed** | Sum of **accepted** quotes                  |
| **Invoiced**  | Sum of invoices                             |
| **Expected**  | Best estimate of final costs                |
| **Paid**      | Paid invoices + expenses with status ≠ open |
| **Remaining** | Total budget − Expected                     |

## Rules

1. **No double counting:** per cost item the most informative value is used, in tiers: invoices if they exceed the accepted quote; otherwise the accepted quote; otherwise the planned amount. A quote and an invoice for the same work are never added together.
2. Only **accepted** quotes count. **Requested**, received, and rejected quotes have no effect.
3. Quotes and invoices without a cost item still count and are assigned to their trade.
4. **Expenses** always count as spent. Status "open" = not yet paid; "paid", "submitted", and "reimbursed" = paid.
5. **Reimbursed expenses** remain counted as spent and are not credited back to the budget (they are shown separately).

## Payment sources

Expenses and invoices have a "Paid from" field (e.g. **Bank**, **Private**). Sources are managed in **Settings → Payment sources**, each with a switch "Deduct from total budget". Only items from deducting sources (or with no source) count against the total budget; others (e.g. tools paid privately) still appear in the expenses overview with per-source totals.

## Credit interest calculator

Loan terms, repayments, and the full monthly calculation are managed on the **Credit** page. Enter the contract's loan/net loan amount once, fixed nominal rate, monthly installment, installment count, and the single date by which the loan must be fully drawn. That date is also the start date for commitment interest and the first scheduled full installment. Effective annual rate, fixed-rate end, payout rate, and repayment rate are captured for reference; the nominal rate is used for interest calculations. The dashboard shows the current month's forecast and actual interest-to-date, plus the next month's forecast, once loan terms are configured. The calculator uses the selected payment source as the credit source. Paid invoices and non-open expenses are actual bank-funded drawdowns; unpaid invoices and open expenses are included in the forecast. The planned/actual payment date is preferred; older records fall back to the invoice due date/invoice date or expense date. Add or edit payment dates on invoices and expenses to improve the timeline.

Interest is accrued daily on the outstanding drawn balance. The contract installment is projected monthly from the full-drawdown date; its interest portion is the accrued interest since the previous installment and the remainder reduces principal. The selected 360/365 denominator is used for nominal interest. Commitment interest is prorated by the number of calendar days in each month on the undrawn amount from the contract's commitment-interest date (inclusive). The outstanding balance is capped at the configured total credit and cannot fall below zero.

Actual costs use only payments marked paid; the forecast also includes unpaid entries with a planned date. Manually recorded repayments reduce the balance in both scenarios; the contract installment is projected only in the forecast. These are estimates; confirm day-count, fee and payment-date rules against the loan agreement.

## Tests

Coverage includes: planned amount without orders, no double counting of quote + invoice, rejected and requested quotes ignored, expense statuses, daily credit interest, repayment effects, source-aware actual/forecast payments, and zero-interest annuity calculations.
