import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { tr } from "@/i18n";
import { useMutations, useWorkspace } from "@/hooks/use-workspace";
import { summarizePots } from "@/lib/calc";
import { eur, fmtDate, todayISO } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { EntityDialog } from "./EntityDialog";
import { Empty, Panel } from "./ui-bits";

export function FundingPanel() {
  const { ws } = useWorkspace();
  const { create, update, remove } = useMutations();
  const [dialog, setDialog] = useState<{ id?: string; initial: Record<string, unknown> } | null>(
    null,
  );
  const entries = [...(ws.funding_entries ?? [])].sort((a, b) =>
    b.received_date.localeCompare(a.received_date),
  );
  const sources = summarizePots(ws.budget_pots, ws.expenses, ws.invoices, entries).filter(
    (pot) => pot.received > 0,
  );

  return (
    <Panel
      title={tr("funding.title")}
      className="my-4"
      action={
        <Button
          size="sm"
          variant="outline"
          onClick={() => setDialog({ initial: { received_date: todayISO() } })}
        >
          <Plus data-icon="inline-start" />
          {tr("funding.add")}
        </Button>
      }
    >
      <p className="mb-4 text-sm text-muted-foreground">{tr("funding.explanation")}</p>
      {sources.length > 0 && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sources.map((source) => (
            <section key={source.id} className="min-w-0 rounded-lg border p-3">
              <h3 className="truncate font-medium" title={source.name}>
                {source.name}
              </h3>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm tabular">
                <dt className="text-muted-foreground">{tr("funding.received")}</dt>
                <dd className="text-right">{eur(source.received)}</dd>
                <dt className="text-muted-foreground">{tr("shared.expenses")}</dt>
                <dd className="text-right">{eur(source.spent)}</dd>
                <dt className="font-medium">{tr("funding.source_remaining")}</dt>
                <dd
                  className={
                    source.remaining < 0
                      ? "text-right font-medium text-destructive"
                      : "text-right font-medium"
                  }
                >
                  {eur(source.remaining)}
                </dd>
              </dl>
            </section>
          ))}
        </div>
      )}
      {entries.length ? (
        <ul className="divide-y">
          {entries.map((entry) => (
            <li key={entry.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1">
                <div className="break-words font-medium">
                  {ws.budget_pots.find((pot) => pot.id === entry.budget_pot_id)?.name ??
                    tr("expenses.no_source")}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {fmtDate(entry.received_date)}
                </div>
                {entry.notes && (
                  <p className="mt-1 break-words text-sm text-muted-foreground">{entry.notes}</p>
                )}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="font-medium tabular">{eur(entry.amount)}</span>
                <div className="flex">
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={tr("funding.edit")}
                    onClick={() => setDialog({ id: entry.id, initial: { ...entry } })}
                  >
                    <Pencil data-icon="inline-start" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={tr("funding.delete")}
                    onClick={() =>
                      confirm(tr("funding.confirm_delete")) &&
                      remove.mutate({ table: "funding_entries", id: entry.id })
                    }
                  >
                    <Trash2 data-icon="inline-start" />
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>{tr("funding.empty")}</Empty>
      )}
      <EntityDialog
        open={!!dialog}
        onOpenChange={(open) => !open && setDialog(null)}
        title={dialog?.id ? tr("funding.edit") : tr("funding.add")}
        fields={[
          {
            name: "budget_pot_id",
            label: tr("funding.source"),
            type: "select",
            required: true,
            options: ws.budget_pots
              .filter((pot) => pot.deducts_from_budget)
              .map((pot) => ({ value: pot.id, label: pot.name })),
            full: true,
          },
          { name: "amount", label: tr("funding.amount"), type: "number", required: true },
          { name: "received_date", label: tr("funding.date"), type: "date", required: true },
          { name: "notes", label: tr("shared.notes"), type: "textarea", full: true },
        ]}
        initial={dialog?.initial}
        onSubmit={(values) => {
          if (!Number.isFinite(Number(values["amount"])) || Number(values["amount"]) <= 0)
            throw new Error(tr("funding.invalid_amount"));
          return dialog?.id
            ? update.mutateAsync({ table: "funding_entries", id: dialog.id, patch: values })
            : create.mutateAsync({ table: "funding_entries", row: values });
        }}
      />
    </Panel>
  );
}
