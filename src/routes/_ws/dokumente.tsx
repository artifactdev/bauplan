import { tr } from "@/i18n";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Download, Eye, FileImage, FileSpreadsheet, FileText, File as FileIcon, Pencil, ScanText, Search, Trash2, Upload } from "lucide-react";
import { useMutations, useWorkspace } from "@/hooks/use-workspace";
import { fileSize, fmtDate } from "@/lib/format";
import { costItemOptions, taskOptions, tradeName, tradeOptions } from "@/lib/options";
import { DOC_CATEGORIES, type Doc } from "@/lib/schema";
import { Empty, PageHeader, Panel, Pill } from "@/components/app/ui-bits";
import { EntityDialog } from "@/components/app/EntityDialog";
import { QuickUpload } from "@/components/app/quick-actions";
import { resolveFileUrl } from "@/components/app/doc-open";
import { AssignDialog } from "@/components/app/AssignDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export const Route = createFileRoute("/_ws/dokumente")({
  head: () => ({
    meta: [
      { title: tr("Dokumente – Bauplan") },
      { name: "description", content: tr("Pläne, Verträge, Datenblätter, Fotos und Belege zentral ablegen und durchsuchen.") },
      { property: "og:title", content: tr("Dokumente – Bauplan") },
      { property: "og:description", content: tr("Alle Unterlagen deiner Renovierung an einem Ort.") },
    ],
  }),
  component: DocsPage,
});

function DocIcon({ mime }: { mime: string | null }) {
  const cls = "h-8 w-8 shrink-0";
  if (mime?.startsWith("image/")) return <FileImage className={`${cls} text-chart-2`} />;
  if (mime === "application/pdf") return <FileText className={`${cls} text-destructive`} />;
  if (mime?.includes("sheet") || mime?.includes("excel")) return <FileSpreadsheet className={`${cls} text-success`} />;
  return <FileIcon className={`${cls} text-muted-foreground`} />;
}

function DocsPage() {
  const { ws } = useWorkspace();
  const { update, remove } = useMutations();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [edit, setEdit] = useState<Doc | null>(null);
  const [assignId, setAssignId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ doc: Doc; url: string } | null>(null);

  const docs = useMemo(() => {
    const s = q.trim().toLowerCase();
    return ws.documents
      .filter((d) => !cat || d.category === cat)
      .filter((d) => !s || [d.name, d.tags, d.description, d.category, tradeName(ws, d.trade_id)].join(" ").toLowerCase().includes(s))
      .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  }, [ws, q, cat]);

  const open = async (d: Doc, mode: "preview" | "download") => {
    const url = await resolveFileUrl(d.storage_path);
    if (!url) return;
    if (mode === "preview" && (d.mime_type?.startsWith("image/") || d.mime_type === "application/pdf")) setPreview({ doc: d, url });
    else window.open(url, "_blank");
  };

  const links = (d: Doc) => {
    const out: string[] = [];
    if (d.trade_id) out.push(tradeName(ws, d.trade_id));
    const c = ws.cost_items.find((x) => x.id === d.cost_item_id);
    if (c) out.push(c.title);
    const t = ws.tasks.find((x) => x.id === d.task_id);
    if (t) out.push(`Aufgabe: ${t.title}`);
    ws.offers.filter((o) => o.document_id === d.id).forEach((o) => out.push(`Angebot ${o.contractor}`));
    ws.invoices.filter((o) => o.document_id === d.id).forEach((o) => out.push(`Rechnung ${o.contractor}`));
    ws.expenses.filter((o) => o.document_id === d.id).forEach((o) => out.push(`Ausgabe ${o.vendor ?? o.title}`));
    return out;
  };

  return (
    <>
      <PageHeader title={tr("Dokumente")} subtitle={`${ws.documents.length} Dateien`} actions={<Button size="sm" onClick={() => setUploadOpen(true)}><Upload className="h-4 w-4" /> {tr("Hochladen")}</Button>} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder={tr("Suchen nach Name, Schlagwort…")} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-1">
          <Button size="sm" variant={cat === null ? "secondary" : "ghost"} onClick={() => setCat(null)}>{tr("Alle")}</Button>
          {DOC_CATEGORIES.map((c) => (
            <Button key={c} size="sm" variant={cat === c ? "secondary" : "ghost"} onClick={() => setCat(c)}>{tr(c)}</Button>
          ))}
        </div>
      </div>

      <Panel>
        <ul className="divide-y">
          {docs.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-3 py-3">
              <DocIcon mime={d.mime_type} />
              <div className="min-w-0 flex-1">
                <button className="block max-w-full truncate text-left font-medium hover:underline" onClick={() => open(d, "preview")}>{d.name}</button>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <Pill tone="primary">{d.category ? tr(d.category) : ""}</Pill>
                  <span>{fileSize(d.size)}</span>
                  <span>· {fmtDate(d.created_at ?? null)}</span>
                  {links(d).map((l) => <span key={l}>· {l}</span>)}
                </div>
                {d.tags && <div className="mt-1 flex flex-wrap gap-1">{d.tags.split(",").map((t) => t.trim()).filter(Boolean).map((t) => <Pill key={t}>#{t}</Pill>)}</div>}
                {d.description && <p className="mt-1 text-xs text-muted-foreground">{d.description}</p>}
              </div>
              <div className="flex">
                {(d.mime_type === "application/pdf" || d.mime_type?.startsWith("image/")) && (
                  <Button size="icon" variant="ghost" aria-label={tr("Inhalt erkennen und zuordnen")} title={tr("Inhalt erkennen und zuordnen")} onClick={() => setAssignId(d.id)}><ScanText className="h-4 w-4" /></Button>
                )}
                <Button size="icon" variant="ghost" aria-label={tr("Vorschau")} onClick={() => open(d, "preview")}><Eye className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" aria-label={tr("Herunterladen")} onClick={() => open(d, "download")}><Download className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" aria-label={tr("Bearbeiten")} onClick={() => setEdit(d)}><Pencil className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" aria-label={tr("Löschen")} onClick={() => confirm(`„${d.name}“ löschen?`) && remove.mutate({ table: "documents", id: d.id })}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </li>
          ))}
        </ul>
        {!docs.length && <Empty>{ws.documents.length ? tr("Keine Treffer.") : tr("Noch keine Dokumente – lade Angebote, Pläne oder Fotos hoch.")}</Empty>}
      </Panel>

      <QuickUpload open={uploadOpen} onOpenChange={setUploadOpen} />
      <AssignDialog documentId={assignId} onClose={() => setAssignId(null)} />
      <EntityDialog
        open={!!edit}
        onOpenChange={(o) => !o && setEdit(null)}
        title={tr("Dokument bearbeiten")}
        fields={[
          { name: "name", label: tr("Name"), required: true, full: true },
          { name: "category", label: tr("Kategorie"), type: "select", required: true, options: DOC_CATEGORIES.map((c) => ({ value: c, label: tr(c) })) },
          { name: "trade_id", label: tr("Gewerk"), type: "select", options: tradeOptions(ws) },
          { name: "cost_item_id", label: tr("Kostenposition"), type: "select", options: costItemOptions(ws) },
          { name: "task_id", label: tr("Aufgabe"), type: "select", options: taskOptions(ws) },
          { name: "tags", label: tr("Schlagwörter"), full: true },
          { name: "description", label: tr("Beschreibung"), type: "textarea" },
        ]}
        initial={edit ? { ...edit } : undefined}
        onSubmit={(v) => update.mutateAsync({ table: "documents", id: edit!.id, patch: v })}
      />
      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader><DialogTitle className="truncate pr-6">{preview?.doc.name}</DialogTitle></DialogHeader>
          {preview && (preview.doc.mime_type === "application/pdf" ? (
            <iframe src={preview.url} title={preview.doc.name} className="h-[75vh] w-full rounded-md border" />
          ) : (
            <img src={preview.url} alt={preview.doc.name} className="max-h-[75vh] w-full rounded-md object-contain" />
          ))}
        </DialogContent>
      </Dialog>
    </>
  );
}
