import { tr } from "@/i18n";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  Download,
  Eye,
  FileImage,
  FileSpreadsheet,
  FileText,
  File as FileIcon,
  Pencil,
  ScanLine,
  ScanText,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { useMutations, useWorkspace } from "@/hooks/use-workspace";
import { fileSize, fmtDate } from "@/lib/format";
import { costItemOptions, taskOptions, tradeName, tradeOptions } from "@/lib/options";
import { DOC_CATEGORIES, type Doc } from "@/lib/schema";
import { Empty, PageHeader, Panel, Pill } from "@/components/app/ui-bits";
import { EntityDialog } from "@/components/app/EntityDialog";
import { QuickUpload } from "@/components/app/quick-actions";
import { DocumentScanner } from "@/components/app/DocumentScanner";
import { resolveFileUrl } from "@/components/app/doc-open";
import { AssignDialog } from "@/components/app/AssignDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export const Route = createFileRoute("/_ws/dokumente")({
  head: () => ({
    meta: [
      { title: tr("documents.documents_bauplan") },
      { name: "description", content: tr("documents.store_search_plans_contracts") },
      { property: "og:title", content: tr("documents.documents_bauplan") },
      { property: "og:description", content: tr("documents.all_documents_renovation_one") },
    ],
  }),
  component: DocsPage,
});

function DocIcon({ mime }: { mime: string | null }) {
  const cls = "h-8 w-8 shrink-0";
  if (mime?.startsWith("image/")) return <FileImage className={`${cls} text-chart-2`} />;
  if (mime === "application/pdf") return <FileText className={`${cls} text-destructive`} />;
  if (mime?.includes("sheet") || mime?.includes("excel"))
    return <FileSpreadsheet className={`${cls} text-success`} />;
  return <FileIcon className={`${cls} text-muted-foreground`} />;
}

function DocsPage() {
  const { ws } = useWorkspace();
  const { update, remove } = useMutations();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanned, setScanned] = useState<File | null>(null);
  const [edit, setEdit] = useState<Doc | null>(null);
  const [assignId, setAssignId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ doc: Doc; url: string } | null>(null);

  const docs = useMemo(() => {
    const s = q.trim().toLowerCase();
    return ws.documents
      .filter((d) => !cat || d.category === cat)
      .filter(
        (d) =>
          !s ||
          [d.name, d.tags, d.description, d.category, tradeName(ws, d.trade_id)]
            .join(" ")
            .toLowerCase()
            .includes(s),
      )
      .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  }, [ws, q, cat]);

  const open = async (d: Doc, mode: "preview" | "download") => {
    const url = await resolveFileUrl(d.storage_path);
    if (!url) return;
    if (
      mode === "preview" &&
      (d.mime_type?.startsWith("image/") || d.mime_type === "application/pdf")
    )
      setPreview({ doc: d, url });
    else window.open(url, "_blank");
  };

  const links = (d: Doc) => {
    const out: string[] = [];
    if (d.trade_id) out.push(tradeName(ws, d.trade_id));
    const c = ws.cost_items.find((x) => x.id === d.cost_item_id);
    if (c) out.push(c.title);
    const t = ws.tasks.find((x) => x.id === d.task_id);
    if (t) out.push(tr("documents.related_task", { title: t.title }));
    ws.offers
      .filter((o) => o.document_id === d.id)
      .forEach((o) => out.push(tr("documents.related_offer", { company: o.contractor })));
    ws.expenses
      .filter((o) => o.document_id === d.id)
      .forEach((o) => out.push(tr("documents.related_expense", { title: o.vendor ?? o.title })));
    return out;
  };

  return (
    <>
      <PageHeader
        title={tr("shared.documents")}
        subtitle={tr("documents.file_count", { count: ws.documents.length })}
        actions={
          <>
            <Button size="sm" variant="outline" onClick={() => setScanOpen(true)}>
              <ScanLine className="h-4 w-4" /> {tr("scanner.scan_document")}
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setScanned(null);
                setUploadOpen(true);
              }}
            >
              <Upload className="h-4 w-4" /> {tr("shared.upload")}
            </Button>
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder={tr("documents.search_name_tag")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-1">
          <Button
            size="sm"
            variant={cat === null ? "secondary" : "ghost"}
            onClick={() => setCat(null)}
          >
            {tr("shared.all")}
          </Button>
          {DOC_CATEGORIES.map((c) => (
            <Button
              key={c}
              size="sm"
              variant={cat === c ? "secondary" : "ghost"}
              onClick={() => setCat(c)}
            >
              {tr(c)}
            </Button>
          ))}
        </div>
      </div>

      <Panel>
        <ul className="divide-y">
          {docs.map((d) => {
            const related = links(d);
            return (
              <li
                key={d.id}
                className="grid grid-cols-[2rem_minmax(0,1fr)] items-start gap-x-3 gap-y-3 py-4 first:pt-0 last:pb-0 lg:grid-cols-[2rem_minmax(0,1fr)_auto]"
              >
                <div className="pt-1">
                  <DocIcon mime={d.mime_type} />
                </div>
                <div className="min-w-0">
                  <button
                    className="block max-w-full text-left text-sm font-medium leading-6 [overflow-wrap:anywhere] hover:underline lg:text-base"
                    onClick={() => open(d, "preview")}
                  >
                    {d.name}
                  </button>
                  <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-muted-foreground">
                    <Pill tone="primary">{d.category ? tr(d.category) : ""}</Pill>
                    <span>{fileSize(d.size)}</span>
                    <span>· {fmtDate(d.created_at ?? null)}</span>
                  </div>
                  {related.length > 0 && (
                    <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                      {related.map((l) => (
                        <li key={l} className="[overflow-wrap:anywhere]">
                          {l}
                        </li>
                      ))}
                    </ul>
                  )}
                  {d.tags && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {d.tags
                        .split(",")
                        .map((t) => t.trim())
                        .filter(Boolean)
                        .map((t) => (
                          <span
                            key={t}
                            className="max-w-full rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground [overflow-wrap:anywhere]"
                          >
                            #{t}
                          </span>
                        ))}
                    </div>
                  )}
                  {d.description && (
                    <p className="mt-2 text-sm text-muted-foreground">{d.description}</p>
                  )}
                </div>
                <div className="col-span-2 flex w-full items-center justify-between gap-2 border-t border-border pt-2 lg:col-span-1 lg:w-auto lg:justify-end lg:border-0 lg:pt-0">
                  <Button
                    size="sm"
                    variant="outline"
                    className="lg:hidden"
                    onClick={() => open(d, "preview")}
                  >
                    <Eye className="h-4 w-4" /> {tr("documents.preview")}
                  </Button>
                  <details className="relative lg:hidden">
                    <summary className="flex h-9 cursor-pointer list-none items-center gap-2 rounded-md border px-3 text-sm font-medium hover:bg-accent [&::-webkit-details-marker]:hidden">
                      {tr("shared.actions")}
                    </summary>
                    <div className="absolute right-0 top-full z-10 mt-1 flex min-w-44 flex-col rounded-md border bg-popover p-1 shadow-md">
                      {(d.mime_type === "application/pdf" || d.mime_type?.startsWith("image/")) && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="justify-start"
                          onClick={() => setAssignId(d.id)}
                        >
                          <ScanText className="h-4 w-4" />{" "}
                          {tr("documents.recognize_assign_content")}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="justify-start"
                        onClick={() => open(d, "download")}
                      >
                        <Download className="h-4 w-4" /> {tr("documents.download")}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="justify-start"
                        onClick={() => setEdit(d)}
                      >
                        <Pencil className="h-4 w-4" /> {tr("shared.edit")}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="justify-start text-destructive"
                        onClick={() =>
                          confirm(tr("documents.delete_document", { name: d.name })) &&
                          remove.mutate({ table: "documents", id: d.id })
                        }
                      >
                        <Trash2 className="h-4 w-4" /> {tr("shared.delete")}
                      </Button>
                    </div>
                  </details>
                  <div className="hidden items-center gap-1 lg:flex">
                    {(d.mime_type === "application/pdf" || d.mime_type?.startsWith("image/")) && (
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={tr("documents.recognize_assign_content")}
                        title={tr("documents.recognize_assign_content")}
                        onClick={() => setAssignId(d.id)}
                      >
                        <ScanText className="h-4 w-4" />
                      </Button>
                    )}
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={tr("documents.preview")}
                      onClick={() => open(d, "preview")}
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={tr("documents.download")}
                      onClick={() => open(d, "download")}
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={tr("shared.edit")}
                      onClick={() => setEdit(d)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={tr("shared.delete")}
                      onClick={() =>
                        confirm(tr("documents.delete_document", { name: d.name })) &&
                        remove.mutate({ table: "documents", id: d.id })
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
        {!docs.length && (
          <Empty>
            {ws.documents.length
              ? tr("shared.no_results")
              : tr("documents.no_documents_yet_upload")}
          </Empty>
        )}
      </Panel>

      <QuickUpload open={uploadOpen} onOpenChange={setUploadOpen} initialFile={scanned} />
      {/* Scan first, then choose category and links in the regular upload form. */}
      <DocumentScanner
        open={scanOpen}
        onOpenChange={setScanOpen}
        onComplete={(file) => {
          setScanned(file);
          setUploadOpen(true);
        }}
      />
      <AssignDialog documentId={assignId} onClose={() => setAssignId(null)} />
      <EntityDialog
        open={!!edit}
        onOpenChange={(o) => !o && setEdit(null)}
        title={tr("documents.edit_document")}
        fields={[
          { name: "name", label: tr("shared.name"), required: true, full: true },
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
          { name: "task_id", label: tr("shared.task"), type: "select", options: taskOptions(ws) },
          { name: "tags", label: tr("documents.tags"), full: true },
          { name: "description", label: tr("shared.description"), type: "textarea" },
        ]}
        initial={edit ? { ...edit } : undefined}
        onSubmit={(v) => update.mutateAsync({ table: "documents", id: edit!.id, patch: v })}
      />
      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle className="truncate pr-6">{preview?.doc.name}</DialogTitle>
          </DialogHeader>
          {preview &&
            (preview.doc.mime_type === "application/pdf" ? (
              <iframe
                src={preview.url}
                title={preview.doc.name}
                className="h-[75vh] w-full rounded-md border"
              />
            ) : (
              <img
                src={preview.url}
                alt={preview.doc.name}
                className="max-h-[75vh] w-full rounded-md object-contain"
              />
            ))}
        </DialogContent>
      </Dialog>
    </>
  );
}
