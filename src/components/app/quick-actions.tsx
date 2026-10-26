import { tr } from "@/i18n";
import { useRef, useState } from "react";
import { useMutations, useWorkspace } from "@/hooks/use-workspace";
import { costItemOptions, tradeOptions } from "@/lib/options";
import { DOC_CATEGORIES, PHASES } from "@/lib/schema";
import { EntityDialog, type Field } from "./EntityDialog";
import { AssignDialog } from "./AssignDialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Camera } from "lucide-react";

type P = { open: boolean; onOpenChange: (o: boolean) => void; initial?: Record<string, unknown> | undefined; editId?: string | undefined };

export function taskFields(ws: ReturnType<typeof useWorkspace>["ws"]): Field[] {
  return [
    { name: "title", label: tr("Titel"), required: true, full: true },
    { name: "due_date", label: tr("Fällig am"), type: "date" },
    { name: "priority", label: tr("Priorität"), type: "select", required: true, options: [{ value: "niedrig", label: tr("Niedrig") }, { value: "mittel", label: tr("Mittel") }, { value: "hoch", label: tr("Hoch") }] },
    { name: "trade_id", label: tr("Gewerk"), type: "select", options: tradeOptions(ws) },
    { name: "phase", label: tr("Phase"), type: "select", options: PHASES.map((p) => ({ value: p, label: tr(p) })) },
    { name: "status", label: tr("Status"), type: "select", required: true, options: [{ value: "offen", label: tr("Offen") }, { value: "in_arbeit", label: tr("In Arbeit") }, { value: "erledigt", label: tr("Erledigt") }] },
    { name: "cost_item_id", label: tr("Kostenposition"), type: "select", options: costItemOptions(ws) },
    { name: "document_id", label: tr("Dokument"), type: "select", options: ws.documents.map((d) => ({ value: d.id, label: d.name })) },
    { name: "notes", label: tr("Notizen"), type: "textarea" },
  ];
}

export function QuickTask({ open, onOpenChange, initial, editId }: P) {
  const { ws } = useWorkspace();
  const { create, update } = useMutations();
  return (
    <EntityDialog
      open={open}
      onOpenChange={onOpenChange}
      title={editId ? tr("Aufgabe bearbeiten") : tr("Neue Aufgabe")}
      scan={editId ? undefined : "task"}
      fields={taskFields(ws)}
      initial={initial ?? { priority: "mittel", status: "offen" }}
      onSubmit={(v) => (editId ? update.mutateAsync({ table: "tasks", id: editId, patch: v }) : create.mutateAsync({ table: "tasks", row: v }))}
    />
  );
}

export function QuickCost({ open, onOpenChange, initial, editId }: P) {
  const { ws } = useWorkspace();
  const { create, update } = useMutations();
  return (
    <EntityDialog
      open={open}
      onOpenChange={onOpenChange}
      title={editId ? tr("Kostenposition bearbeiten") : tr("Neue Kostenposition")}
      scan={editId ? undefined : "cost"}
      fields={[
        { name: "title", label: tr("Bezeichnung"), required: true, full: true },
        { name: "trade_id", label: tr("Gewerk"), type: "select", options: tradeOptions(ws) },
        { name: "planned", label: tr("Geplante Kosten (€)"), type: "number", required: true },
        { name: "description", label: tr("Beschreibung"), type: "textarea" },
      ]}
      initial={initial}
      onSubmit={(v) => (editId ? update.mutateAsync({ table: "cost_items", id: editId, patch: v }) : create.mutateAsync({ table: "cost_items", row: v }))}
    />
  );
}

export function QuickUpload({ open, onOpenChange, initial }: P) {
  const { ws } = useWorkspace();
  const { upload } = useMutations();
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [assignId, setAssignId] = useState<string | null>(null);
  return (
    <>
    <EntityDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setFileName("");
        onOpenChange(o);
      }}
      title={tr("Dokument hochladen")}
      submitLabel="Hochladen"
      fields={[
        { name: "recognize", label: tr("Inhalt automatisch erkennen und zuordnen (Angebot, Rechnung, Kassenzettel…)"), type: "checkbox", full: true },
        { name: "category", label: tr("Kategorie"), type: "select", required: true, options: DOC_CATEGORIES.map((c) => ({ value: c, label: tr(c) })) },
        { name: "trade_id", label: tr("Gewerk"), type: "select", options: tradeOptions(ws) },
        { name: "cost_item_id", label: tr("Kostenposition"), type: "select", options: costItemOptions(ws) },
        { name: "task_id", label: tr("Aufgabe"), type: "select", options: ws.tasks.map((t) => ({ value: t.id, label: t.title })) },
        { name: "tags", label: tr("Schlagwörter (Komma-getrennt)"), full: true },
        { name: "description", label: tr("Beschreibung"), type: "textarea" },
      ]}
      initial={initial ?? { category: "Sonstiges", recognize: true }}
      extra={
        <div className="grid gap-1.5">
          <Label htmlFor="file">{tr("Datei (max. 25 MB)")}</Label>
          <Button type="button" size="sm" variant="outline" className="justify-self-start" onClick={() => camRef.current?.click()}><Camera className="h-4 w-4" /> {tr("Foto aufnehmen")}</Button>
          <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f && fileRef.current) { const dt = new DataTransfer(); dt.items.add(f); fileRef.current.files = dt.files; setFileName(f.name); } }} />
          <Input id="file" ref={fileRef} type="file" required onChange={(e) => setFileName(e.target.files?.[0]?.name ?? "")} accept="application/pdf,image/*,.doc,.docx,.xls,.xlsx,.dwg,.txt" />
          {fileName && <span className="text-xs text-muted-foreground">{fileName}</span>}
        </div>
      }
      onSubmit={async (v) => {
        const file = fileRef.current?.files?.[0];
        if (!file) throw new Error(tr("Bitte eine Datei wählen"));
        const { recognize, ...meta } = v;
        const res = await upload.mutateAsync({ file, meta });
        const canRead = file.type === "application/pdf" || file.type.startsWith("image/");
        if (recognize && canRead) setAssignId(res.id);
      }}
    />
    <AssignDialog documentId={assignId} onClose={() => setAssignId(null)} />
    </>
  );
}
