import { useEffect, useState } from "react";
import { toast } from "sonner";
import { tr } from "@/i18n";
import { useMutations, useWorkspace } from "@/hooks/use-workspace";
import { splitExpense } from "@/lib/expenses";
import { eur } from "@/lib/format";
import { potName } from "@/lib/options";
import type { Expense, ExpenseStatus } from "@/lib/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const statusLabel = (status: ExpenseStatus) =>
  ({
    offen: tr("shared.open"),
    bezahlt: tr("shared.paid"),
    eingereicht: tr("shared.submitted"),
    erstattet: tr("shared.reimbursed"),
    abgelehnt: tr("shared.rejected"),
  })[status];

const PART_STATUSES: ExpenseStatus[] = ["erstattet", "eingereicht", "abgelehnt", "bezahlt"];

/**
 * Splits one expense into two, e.g. when the bank only reimburses part of a purchase.
 * The remainder keeps the original status and payment source.
 */
export function ExpenseSplitDialog({
  expense,
  onClose,
}: {
  expense: Expense | null;
  onClose: () => void;
}) {
  const { ws } = useWorkspace();
  const { create, update, remove } = useMutations();
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<ExpenseStatus>("erstattet");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setAmount("");
    setStatus("erstattet");
  }, [expense?.id]);

  const split = expense
    ? splitExpense(
        expense,
        Number(amount.replace(",", ".")),
        status,
        `${expense.title} (${statusLabel(status)})`,
        ws,
      )
    : null;
  const partSource = potName(ws, split?.part["budget_pot_id"] as string | null) ?? "–";

  const submit = async () => {
    if (!expense || !split || busy) return;
    setBusy(true);
    let createdId: string | null = null;
    try {
      const created = await create.mutateAsync({ table: "expenses", row: split.part });
      createdId =
        typeof created === "object" && created !== null && "id" in created
          ? String(created.id)
          : null;
      await update.mutateAsync({
        table: "expenses",
        id: expense.id,
        patch: { amount: split.remainder },
      });
      toast.success(tr("expenses.split_done"));
      onClose();
    } catch {
      // Keep the totals consistent: drop the new part when the original could not be reduced.
      if (createdId) await remove.mutateAsync({ table: "expenses", id: createdId }).catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!expense} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tr("expenses.split_title")}</DialogTitle>
          <DialogDescription>
            {tr("expenses.split_hint", {
              title: expense?.title ?? "",
              amount: eur(expense?.amount ?? 0, true),
            })}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="split-amount">{tr("expenses.split_part_amount")}</Label>
            <Input
              id="split-amount"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              aria-invalid={!!amount && !split}
              aria-describedby="split-preview"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="split-status">{tr("expenses.split_part_status")}</Label>
            <Select value={status} onValueChange={(value) => setStatus(value as ExpenseStatus)}>
              <SelectTrigger id="split-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PART_STATUSES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {statusLabel(value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div
            id="split-preview"
            aria-live="polite"
            className="grid gap-1 rounded-lg bg-muted p-3 text-sm tabular"
          >
            {split && expense ? (
              <>
                <p>
                  {tr("expenses.split_part_preview", {
                    amount: eur(split.part["amount"] as number, true),
                    status: statusLabel(status),
                    source: partSource,
                  })}
                </p>
                <p>
                  {tr("expenses.split_remainder_preview", {
                    amount: eur(split.remainder, true),
                    status: statusLabel(expense.status),
                    source: potName(ws, expense.budget_pot_id) ?? "–",
                  })}
                </p>
              </>
            ) : (
              <p className={amount ? "text-destructive" : "text-muted-foreground"}>
                {tr("expenses.split_invalid", { amount: eur(expense?.amount ?? 0, true) })}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              {tr("entity_dialog.cancel")}
            </Button>
            <Button type="submit" disabled={!split || busy}>
              {tr("expenses.split_action")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
