import { tr } from "@/i18n";
import { useEffect, useState, type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { ScanBar } from "./ScanBar";
import type { ScanTarget } from "@/lib/scan-map";
import { ChevronDown, ChevronUp, Loader2, Plus, Upload } from "lucide-react";
import { toast } from "sonner";
import { useMutations } from "@/hooks/use-workspace";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

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
const QUICK_ADD: Record<
  string,
  { table: "trades" | "cost_items" | "contacts" | "budget_pots"; col: string; label: string }
> = {
  trade_id: { table: "trades", col: "name", label: tr("shared.new_trade") },
  cost_item_id: { table: "cost_items", col: "title", label: tr("shared.new_cost_item") },
  contact_id: { table: "contacts", col: "name", label: tr("shared.new_contact") },
  budget_pot_id: { table: "budget_pots", col: "name", label: tr("funding.new_source") },
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
  uploadSelection,
  uploadOptions,
  uploaded,
  onFieldChange,
  preserveOnScan,
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
  uploadSelection?: ReactNode;
  uploadOptions?: ReactNode;
  /** Shows a photo/upload step that pre-fills this form. */
  scan?: ScanTarget | undefined;
  /** Documents stored just for this form; closing without saving asks whether to delete them. */
  uploaded?: { id: string; name: string }[] | undefined;
  onFieldChange?: (field: string, value: unknown) => Record<string, unknown>;
  preserveOnScan?: string[];
}) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState<Record<string, { value: string; label: string }[]>>({});
  const [adding, setAdding] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [shown, setShown] = useState<Set<string>>(new Set());
  const [uploads, setUploads] = useState<{ id: string; name: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [showUploadOptions, setShowUploadOptions] = useState(false);
  const [askDiscard, setAskDiscard] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const { create, remove } = useMutations();
  useEffect(() => {
    if (open) {
      setValues(initial ?? {});
      setAdding(null);
      setNewName("");
      setShown(new Set());
      setShowUploadOptions(false);
    }
  }, [open, initial]);
  // Only on opening: `initial` may change while open (e.g. after a refetch) and must not forget uploads.
  useEffect(() => {
    if (open) {
      setUploads(uploaded ?? []);
      setUploading(false);
      setAskDiscard(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    if (open && uploaded?.length)
      setUploads((u) => [...uploaded, ...u.filter((x) => !uploaded.some((y) => y.id === x.id))]);
  }, [open, uploaded]);
  // Closed while the upload was still running and it then failed: nothing left to ask about.
  useEffect(() => {
    if (askDiscard && !uploading && !uploads.length) {
      setAskDiscard(false);
      onOpenChange(false);
    }
  }, [askDiscard, uploading, uploads.length, onOpenChange]);
  /** Closing without saving: files uploaded from this form would otherwise linger in Documents. */
  const cancel = () => (uploads.length || uploading ? setAskDiscard(true) : onOpenChange(false));
  const discard = async (deleteFiles: boolean) => {
    if (deleteFiles) {
      setDiscarding(true);
      try {
        for (const u of uploads) await remove.mutateAsync({ table: "documents", id: u.id });
      } catch {
        setDiscarding(false);
        return;
      }
      setDiscarding(false);
    }
    // Keep `uploads` until the next open so the alert text doesn't change during its fade-out.
    setAskDiscard(false);
    onOpenChange(false);
  };
  const set = (k: string, v: unknown) =>
    setValues((s) => ({ ...s, [k]: v, ...onFieldChange?.(k, v) }));
  const addNew = async (field: string) => {
    const cfg = QUICK_ADD[field];
    const name = newName.trim();
    if (!cfg || !name) return;
    const row: Record<string, unknown> = { [cfg.col]: name };
    if ((cfg.table === "cost_items" || cfg.table === "contacts") && values["trade_id"])
      row["trade_id"] = values["trade_id"];
    if (cfg.table === "budget_pots") row["deducts_from_budget"] = true;
    const { id } = await create.mutateAsync({ table: cfg.table, row });
    setAdded((a) => ({ ...a, [field]: [...(a[field] ?? []), { value: id, label: name }] }));
    set(field, id);
    setAdding(null);
    setNewName("");
  };
  const documentField = scan
    ? fields.find((field) => field.name === "document_id" && field.type === "select")
    : undefined;
  const renderField = (f: Field) => {
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
      <div key={f.name} className={`grid min-w-0 gap-1.5 ${span}`}>
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor={id}>{f.label}</Label>
          {f.type === "select" && QUICK_ADD[f.name] && adding !== f.name && (
            <button
              type="button"
              className="flex items-center gap-1 text-xs text-primary hover:underline"
              onClick={() => {
                setAdding(f.name);
                setNewName("");
              }}
            >
              <Plus className="h-3 w-3" /> {tr("entity_dialog.new")}
            </button>
          )}
        </div>
        {adding === f.name && QUICK_ADD[f.name] && (
          <div className="flex gap-2">
            <Input
              autoFocus
              placeholder={QUICK_ADD[f.name]!.label}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void addNew(f.name);
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setAdding(null);
                }
              }}
            />
            <Button
              type="button"
              size="sm"
              disabled={!newName.trim() || create.isPending}
              onClick={() => void addNew(f.name)}
            >
              {tr("shared.create")}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(null)}>
              ×
            </Button>
          </div>
        )}
        {f.type === "textarea" ? (
          <Textarea
            id={id}
            value={String(v ?? "")}
            onChange={(e) => set(f.name, e.target.value)}
            rows={3}
          />
        ) : f.type === "select" ? (
          <Select
            value={v ? String(v) : NONE}
            onValueChange={(x) => {
              if (x === "") return;
              set(f.name, x === NONE ? null : x);
            }}
          >
            <SelectTrigger id={id}>
              <SelectValue placeholder="–" />
            </SelectTrigger>
            <SelectContent>
              {!f.required && <SelectItem value={NONE}>–</SelectItem>}
              {[
                ...(f.options ?? []),
                ...(added[f.name] ?? []).filter(
                  (a) => !f.options?.some((o) => o.value === a.value),
                ),
              ].map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (f.type === "date" || f.type === "time") &&
          !f.required &&
          (v === null || v === undefined || v === "") &&
          !shown.has(f.name) ? (
          <Button
            id={id}
            type="button"
            variant="outline"
            className="justify-start font-normal text-muted-foreground"
            onClick={() => setShown((s) => new Set(s).add(f.name))}
          >
            <Plus data-icon="inline-start" />{" "}
            {f.type === "date" ? tr("entity_dialog.add_date") : tr("entity_dialog.add_time")}
          </Button>
        ) : (f.type === "date" || f.type === "time") && !f.required ? (
          <div className="flex gap-1">
            <Input
              id={id}
              type={f.type}
              autoFocus={shown.has(f.name) && !v}
              value={v === null || v === undefined ? "" : String(v)}
              onChange={(e) => set(f.name, e.target.value)}
            />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={tr("entity_dialog.clear")}
              onClick={() => {
                set(f.name, null);
                setShown((s) => {
                  const n = new Set(s);
                  n.delete(f.name);
                  return n;
                });
              }}
            >
              ×
            </Button>
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
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : cancel())}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          {header}
          <form
            className="grid grid-cols-1 gap-4 sm:grid-cols-2"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await onSubmit(values);
                setUploads([]);
                onOpenChange(false);
              } catch (err) {
                toast.error(tr(err instanceof Error ? err.message : String(err)));
              } finally {
                setBusy(false);
              }
            }}
          >
            {(scan || uploadSelection || uploadOptions) && (
              <div
                className={`grid gap-3 sm:col-span-2 ${documentField || uploadSelection ? "sm:grid-cols-2" : ""}`}
              >
                {documentField ? renderField(documentField) : uploadSelection}
                <div className="grid gap-1.5">
                  <div className="text-sm font-medium leading-none">
                    {tr("entity_dialog.upload_source")}
                  </div>
                  <Button
                    id="entity-dialog-upload-toggle"
                    type="button"
                    variant="outline"
                    className="h-9 min-h-9 justify-between px-3 py-2"
                    aria-expanded={showUploadOptions}
                    aria-controls="entity-dialog-upload-options"
                    disabled={uploading}
                    onClick={() => setShowUploadOptions((shown) => !shown)}
                  >
                    <span className="flex items-center gap-2">
                      <Upload data-icon="inline-start" />
                      {tr(
                        showUploadOptions
                          ? "entity_dialog.hide_upload_options"
                          : "entity_dialog.show_upload_options",
                      )}
                    </span>
                    {showUploadOptions ? <ChevronUp /> : <ChevronDown />}
                  </Button>
                </div>
              </div>
            )}
            {showUploadOptions && scan && open && (
              <div id="entity-dialog-upload-options" className="sm:col-span-2">
                <ScanBar
                  target={scan}
                  onFill={(v) =>
                    setValues((s) => ({
                      ...s,
                      ...Object.fromEntries(
                        Object.entries(v).filter(([field]) => !preserveOnScan?.includes(field)),
                      ),
                    }))
                  }
                  onUploaded={(doc) => setUploads((u) => [...u, doc])}
                  onBusyChange={setUploading}
                />
              </div>
            )}
            {showUploadOptions && uploadOptions && (
              <div id="entity-dialog-upload-options" className="sm:col-span-2">
                {uploadOptions}
              </div>
            )}
            {fields.filter((field) => field !== documentField).map(renderField)}
            {fields
              .filter((f) => f.suggestions)
              .map((f) => (
                <datalist key={f.name} id={`f-${f.name}-list`}>
                  {f.suggestions!.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              ))}
            {extra && <div className="sm:col-span-2">{extra}</div>}
            <DialogFooter className="sm:col-span-2">
              <Button type="button" variant="ghost" onClick={cancel}>
                {tr("entity_dialog.cancel")}
              </Button>
              <Button type="submit" disabled={busy || uploading}>
                {submitLabel}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={askDiscard}
        onOpenChange={(o) => !o && !discarding && setAskDiscard(false)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {tr("entity_dialog.discard_upload_title", { count: Math.max(uploads.length, 1) })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {uploading
                ? tr("entity_dialog.discard_upload_pending")
                : tr("entity_dialog.discard_upload_text", {
                    count: uploads.length,
                    names: uploads.map((u) => u.name).join(", "),
                  })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={discarding}>
              {tr("entity_dialog.continue_editing")}
            </AlertDialogCancel>
            <Button
              variant="outline"
              disabled={discarding || uploading}
              onClick={() => void discard(false)}
            >
              {tr("entity_dialog.keep_document")}
            </Button>
            <Button
              variant="destructive"
              disabled={discarding || uploading}
              onClick={() => void discard(true)}
            >
              {(discarding || uploading) && <Loader2 className="h-4 w-4 animate-spin" />}
              {tr("entity_dialog.delete_document", { count: Math.max(uploads.length, 1) })}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
