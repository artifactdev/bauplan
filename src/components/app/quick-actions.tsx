import { tr } from "@/i18n";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMutations, useWorkspace } from "@/hooks/use-workspace";
import { collectTags } from "@/lib/tags";
import { useTaskAssignees } from "@/hooks/use-task-assignees";
import { costItemOptions, tradeOptions } from "@/lib/options";
import { DOC_CATEGORIES, PHASES } from "@/lib/schema";
import { EntityDialog, type Field } from "./EntityDialog";
import { AssignDialog } from "./AssignDialog";
import { DocumentScanner } from "./DocumentScanner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Camera, ScanLine } from "lucide-react";
import { MAX_UPLOAD_MB } from "@/lib/limits";

type P = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial?: Record<string, unknown> | undefined;
  editId?: string | undefined;
};

export function taskFields(
  ws: ReturnType<typeof useWorkspace>["ws"],
  assignees: { id: string; label: string }[] = [],
): Field[] {
  return [
    { name: "title", label: tr("shared.title"), required: true, full: true },
    {
      name: "assignee_id",
      label: tr("tasks.assignee"),
      type: "select",
      options: assignees.map((user) => ({ value: user.id, label: user.label })),
    },
    { name: "start_date", label: tr("tasks.start_date"), type: "date" },
    { name: "due_date", label: tr("quick_actions.due"), type: "date" },
    {
      name: "priority",
      label: tr("quick_actions.priority"),
      type: "select",
      required: true,
      options: [
        { value: "niedrig", label: tr("shared.low") },
        { value: "mittel", label: tr("shared.medium") },
        { value: "hoch", label: tr("shared.high") },
      ],
    },
    { name: "trade_id", label: tr("shared.trade"), type: "select", options: tradeOptions(ws) },
    {
      name: "phase",
      label: tr("quick_actions.phase"),
      type: "select",
      options: PHASES.map((p) => ({ value: p, label: tr(p) })),
    },
    {
      name: "status",
      label: tr("shared.status"),
      type: "select",
      required: true,
      options: [
        { value: "offen", label: tr("shared.open") },
        { value: "in_arbeit", label: tr("shared.progress") },
        { value: "erledigt", label: tr("shared.done") },
      ],
    },
    {
      name: "cost_item_id",
      label: tr("shared.cost_item"),
      type: "select",
      options: costItemOptions(ws),
    },
    {
      name: "document_id",
      label: tr("shared.document"),
      type: "select",
      options: ws.documents.map((d) => ({ value: d.id, label: d.name })),
    },
    { name: "notes", label: tr("shared.notes"), type: "textarea" },
  ];
}

export function QuickTask({ open, onOpenChange, initial, editId }: P) {
  const { ws } = useWorkspace();
  const { create, update } = useMutations();
  const assignees = useTaskAssignees(open);
  return (
    <EntityDialog
      open={open}
      onOpenChange={onOpenChange}
      title={editId ? tr("quick_actions.edit_task") : tr("quick_actions.new_task")}
      scan={editId ? undefined : "task"}
      fields={taskFields(ws, assignees.data)}
      initial={initial ?? { priority: "mittel", status: "offen" }}
      extra={
        assignees.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {tr("tasks.assignees_load_failed")}
          </p>
        ) : undefined
      }
      onSubmit={(v) =>
        editId
          ? update.mutateAsync({ table: "tasks", id: editId, patch: v })
          : create.mutateAsync({ table: "tasks", row: v })
      }
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
      title={editId ? tr("quick_actions.edit_cost_item") : tr("shared.new_cost_item")}
      scan={editId ? undefined : "cost"}
      fields={[
        { name: "title", label: tr("quick_actions.name"), required: true, full: true },
        { name: "trade_id", label: tr("shared.trade"), type: "select", options: tradeOptions(ws) },
        {
          name: "planned",
          label: tr("quick_actions.planned_costs"),
          type: "number",
          required: true,
        },
        { name: "description", label: tr("shared.description"), type: "textarea" },
      ]}
      initial={initial}
      onSubmit={(v) =>
        editId
          ? update.mutateAsync({ table: "cost_items", id: editId, patch: v })
          : create.mutateAsync({ table: "cost_items", row: v })
      }
    />
  );
}

export function QuickUpload({
  open,
  onOpenChange,
  initial,
  initialFile,
  onSaved,
  onRecognitionChange,
}: P & {
  initialFile?: File | null | undefined;
  onSaved?: (() => void) | undefined;
  onRecognitionChange?: ((active: boolean) => void) | undefined;
}) {
  const { ws } = useWorkspace();
  const { upload } = useMutations();
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  // Photo or scan result; kept in state because not every browser can assign files to an input.
  const [picked, setPicked] = useState<File | null>(null);
  const [assignId, setAssignId] = useState<string | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const applyFile = (f: File) => {
    setPicked(f);
    setFileName(f.name);
  };
  useEffect(() => {
    if (open && initialFile) applyFile(initialFile);
  }, [open, initialFile]);
  // Mirror the picked file into the visible input; a callback ref also covers the input mounting later (dialog portal).
  const fileInputRef = useCallback(
    (el: HTMLInputElement | null) => {
      fileRef.current = el;
      if (!el || !picked || typeof DataTransfer === "undefined") return;
      const dt = new DataTransfer();
      dt.items.add(picked);
      el.files = dt.files;
    },
    [picked],
  );
  return (
    <>
      <EntityDialog
        open={open}
        onOpenChange={(o) => {
          if (!o) {
            setFileName("");
            setPicked(null);
          }
          onOpenChange(o);
        }}
        title={tr("quick_actions.upload_document")}
        onSaved={onSaved}
        submitLabel="Hochladen"
        fields={[
          {
            name: "recognize",
            label: tr("quick_actions.recognize_content_automatically_assign"),
            type: "checkbox",
            full: true,
          },
          {
            name: "category",
            label: tr("shared.category"),
            type: "select",
            required: true,
            options: DOC_CATEGORIES.map((c) => ({ value: c, label: tr(c) })),
          },
          {
            name: "trade_id",
            label: tr("shared.trade"),
            type: "select",
            options: tradeOptions(ws),
          },
          {
            name: "cost_item_id",
            label: tr("shared.cost_item"),
            type: "select",
            options: costItemOptions(ws),
          },
          {
            name: "task_id",
            label: tr("shared.task"),
            type: "select",
            options: ws.tasks.map((t) => ({ value: t.id, label: t.title })),
          },
          {
            name: "tags",
            label: tr("documents.tags"),
            type: "tags",
            full: true,
            suggestions: collectTags(ws.documents.map((d) => d.tags)),
          },
          { name: "description", label: tr("shared.description"), type: "textarea" },
        ]}
        initial={initial ?? { category: "Sonstiges", recognize: true }}
        uploadSelection={
          <div className="grid gap-1.5">
            <Label htmlFor="file">{tr("shared.document")}</Label>
            <Input
              id="file"
              ref={fileInputRef}
              type="file"
              required={!picked}
              onChange={(e) => {
                setPicked(null);
                setFileName(e.target.files?.[0]?.name ?? "");
              }}
              accept="application/pdf,image/*,.doc,.docx,.xls,.xlsx,.dwg,.txt"
            />
            <span className="text-xs text-muted-foreground">
              {fileName || tr("quick_actions.file_max_size", { max: MAX_UPLOAD_MB })}
            </span>
          </div>
        }
        uploadOptions={
          <div className="grid gap-2">
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => setScanOpen(true)}>
                <ScanLine data-icon="inline-start" /> {tr("scanner.scan_document")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => camRef.current?.click()}
              >
                <Camera data-icon="inline-start" /> {tr("shared.take_photo")}
              </Button>
            </div>
            <input
              ref={camRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) applyFile(f);
              }}
            />
            <p className="text-xs text-muted-foreground">
              {tr("quick_actions.file_max_size", { max: MAX_UPLOAD_MB })}
            </p>
          </div>
        }
        onSubmit={async (v) => {
          const file = picked ?? fileRef.current?.files?.[0];
          if (!file) throw new Error(tr("quick_actions.choose_file"));
          const { recognize, ...meta } = v;
          const res = await upload.mutateAsync({ file, meta });
          const canRead = file.type === "application/pdf" || file.type.startsWith("image/");
          if (recognize && canRead) {
            onRecognitionChange?.(true);
            setAssignId(res.id);
          }
        }}
      />
      <AssignDialog
        documentId={assignId}
        onClose={() => {
          setAssignId(null);
          onRecognitionChange?.(false);
        }}
        fresh
      />
      <DocumentScanner open={scanOpen} onOpenChange={setScanOpen} onComplete={applyFile} />
    </>
  );
}
