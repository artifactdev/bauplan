import type { BudgetPot } from "./schema";

export function validateFundingEntry(
  values: Record<string, unknown>,
  pots: Pick<BudgetPot, "id" | "deducts_from_budget">[],
) {
  const amount = Number(values["amount"]);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("funding.invalid_amount");
  const date = values["received_date"];
  if (
    typeof date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(new Date(date).getTime()) ||
    new Date(date).toISOString().slice(0, 10) !== date
  )
    throw new Error("funding.invalid_date");
  const source = pots.find((pot) => pot.id === values["budget_pot_id"]);
  if (!source?.deducts_from_budget) throw new Error("funding.invalid_source");
}
