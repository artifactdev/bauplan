# Budget logic

Implemented in `src/lib/calc.ts`, covered by `src/lib/calc.test.ts`.

## Terms
| Term | Meaning |
| --- | --- |
| **Planned** | Planned amount for the cost item |
| **Committed** | Sum of **accepted** quotes |
| **Invoiced** | Sum of invoices |
| **Expected** | Best estimate of final costs |
| **Paid** | Paid invoices + expenses with status ≠ open |
| **Remaining** | Total budget − Expected |

## Rules
1. **No double counting:** per cost item the most informative value is used, in tiers: invoices if they exceed the accepted quote; otherwise the accepted quote; otherwise the planned amount. A quote and an invoice for the same work are never added together.
2. Only **accepted** quotes count. **Requested**, received, and rejected quotes have no effect.
3. Quotes and invoices without a cost item still count and are assigned to their trade.
4. **Expenses** always count as spent. Status "open" = not yet paid; "paid", "submitted", and "reimbursed" = paid.
5. **Reimbursed expenses** remain counted as spent and are not credited back to the budget (they are shown separately).

## Payment sources
Expenses and invoices have a "Paid from" field (e.g. **Bank**, **Private**). Sources are managed in **Settings → Payment sources**, each with a switch "Deduct from total budget". Only items from deducting sources (or with no source) count against the total budget; others (e.g. tools paid privately) still appear in the expenses overview with per-source totals.

## Tests
Coverage includes: planned amount without orders, no double counting of quote + invoice, rejected and requested quotes ignored, expense statuses.
