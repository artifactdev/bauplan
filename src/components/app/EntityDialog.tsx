import { tr } from "@/i18n";
import { useEffect, useState, type ReactNode } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { ScanBar } from "./ScanBar";
import type { ScanTarget } from "@/lib/scan-map";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { useMutations } from "@/hooks/use-workspace";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type Field = {
  name: string;
  label: string;
  type?: "text" | "number" | "date" | "time" | "textarea" | "select" | "checkbox";
  options?: { value: string; label: string }[];
  required?: boolean;
  /** Free text with suggestions (datalist). */
  suggestions?: string[];
  full?: boolean;
};

const NONE = "__none";
/** Select fields that allow creating a new entry inline. */
const QUICK_ADD: Record<string, { table: "trades" | "cost_items" | "contacts"; col: string; label: string }> = {
  trade_id: { table: "trades", col: "name", label: tr("shared.new_trade") },
  cost_item_id: { table: "cost_items", col: "title", label: tr("shared.new_cost_item") },
  contact_id: { table: "contacts", col: "name", label: tr("shared.new_contact") },
};

export function EntityDialog({
  open,
  onOpenChange,
  title,
  fields,
  initial,
  onSubmit,
  submitLabel = "Speichern",
  extra,
  header,
  scan,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  fields: Field[];
  initial?: Record<string, unknown> | undefined;
  onSubmit: (values: Record<string, unknown>) => Promise<unknown> | void;
  submitLabel?: string;
  extra?: ReactNode;
  header?: ReactNode;
  /** Shows a photo/upload step that pre-fills this form (create only). */
  scan?: ScanTarget | undefined;
}) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState<Record<string, { value: string; label: string }[]>>({});
  const [adding, setAdding] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [shown, setShown] = useState<Set<string>>(new Set());
  const { create } = useMutations();
  useEffect(() => {
    if (open) { setValues(initial ?? {}); setAdding(null); setNewName(""); setShown(new Set()); }
  }, [open, initial]);
  const set = (k: string, v: unknown) => setValues((s) => ({ ...s, [k]: v }));
  const addNew = async (field: string) => {
    const cfg = QUICK_ADD[field];
    const name = newName.trim();
    if (!cfg || !name) return;
    const row: Record<string, unknown> = { [cfg.col]: name };
    if (cfg.table !== "trades" && values["trade_id"]) row["trade_id"] = values["trade_id"];
    const { id } = await create.mutateAsync({ table: cfg.table, row });
    setAdded((a) => ({ ...a, [field]: [...(a[field] ?? []), { value: id, label: name }] }));
    set(field, id);
    setAdding(null);
    setNewName("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {header}
        {scan && open && <ScanBar target={scan} onFill={(v) => setValues((s) => ({ ...s, ...v }))} />}
        <form
          className="grid grid-cols-1 gap-4 sm:grid-cols-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await onSubmit(values);
              onOpenChange(false);
            } catch (err) {
              toast.error(err instanceof Error ? err.message : String(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          {fields.map((f) => {
            const v = values[f.name];
            const id = `f-${f.name}`;
            const span = f.full || f.type === "textarea" ? "sm:col-span-2" : "";
            if (f.type === "checkbox")
              return (
                <label key={f.name} className={`flex items-center gap-2 text-sm ${span}`}>
                  <Checkbox checked={!!v} onCheckedChange={(c) => set(f.name, !!c)} /> {f.label}
                </label>
              );
            return (
              <div key={f.name} className={`grid gap-1.5 ${span}`}>
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor={id}>{f.label}</Label>
                  {f.type === "select" && QUICK_ADD[f.name] && adding !== f.name && (
                    <button type="button" className="flex items-center gap-1 text-xs text-primary hover:underline" onClick={() => { setAdding(f.name); setNewName(""); }}>
                      <Plus className="h-3 w-3" /> {tr("entity_dialog.new")}
                    </button>
                  )}
                </div>
                {adding === f.name && QUICK_ADD[f.name] && (
                  <div className="flex gap-2">
                    <Input autoFocus placeholder={QUICK_ADD[f.name]!.label} value={newName} onChange={(e) => setNewName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void addNew(f.name); } if (e.key === "Escape") { e.preventDefault(); setAdding(null); } }} />
                    <Button type="button" size="sm" disabled={!newName.trim() || create.isPending} onClick={() => void addNew(f.name)}>{tr("shared.create")}</Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(null)}>×</Button>
                  </div>
                )}
                {f.type === "textarea" ? (
                  <Textarea id={id} value={String(v ?? "")} onChange={(e) => set(f.name, e.target.value)} rows={3} />
                ) : f.type === "select" ? (
                  <Select value={v ? String(v) : NONE} onValueChange={(x) => { if (x === "") return; set(f.name, x === NONE ? null : x); }}>
                    <SelectTrigger id={id}>
                      <SelectValue placeholder="–" />
                    </SelectTrigger>
                    <SelectContent>
                      {!f.required && <SelectItem value={NONE}>–</SelectItem>}
                      {[...(f.options ?? []), ...(added[f.name] ?? []).filter((a) => !f.options?.some((o) => o.value === a.value))].map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (f.type === "date" || f.type === "time") && !f.required && (v === null || v === undefined || v === "") && !shown.has(f.name) ? (
                  // Some browsers (Safari) display today's date/time in an empty field, so optional ones start as a button.
                  <Button id={id} type="button" variant="outline" className="justify-start font-normal text-muted-foreground" onClick={() => setShown((s) => new Set(s).add(f.name))}>
                    <Plus className="h-4 w-4" /> {f.type === "date" ? tr("entity_dialog.add_date") : tr("entity_dialog.add_time")}
                  </Button>
                ) : (f.type === "date" || f.type === "time") && !f.required ? (
                  <div className="flex gap-1">
                    <Input id={id} type={f.type} autoFocus={shown.has(f.name) && !v} value={v === null || v === undefined ? "" : String(v)} onChange={(e) => set(f.name, e.target.value)} />
                    <Button type="button" size="icon" variant="ghost" aria-label={tr("entity_dialog.clear")} onClick={() => { set(f.name, null); setShown((s) => { const n = new Set(s); n.delete(f.name); return n; }); }}>×</Button>
                  </div>
                ) : (
                  <Input
                    id={id}
                    type={f.type ?? "text"}
                    step={f.type === "number" ? "0.01" : undefined}
                    required={f.required}
                    value={v === null || v === undefined ? "" : String(v)}
                    onChange={(e) => set(f.name, e.target.value)}
                    list={f.suggestions ? `${id}-list` : undefined}
                  />
                )}
              </div>
            );
          })}
          {fields.filter((f) => f.suggestions).map((f) => (
            <datalist key={f.name} id={`f-${f.name}-list`}>{f.suggestions!.map((s) => <option key={s} value={s} />)}</datalist>
          ))}
          {extra && <div className="sm:col-span-2">{extra}</div>}
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {tr("entity_dialog.cancel")}
            </Button>
            <Button type="submit" disabled={busy}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
