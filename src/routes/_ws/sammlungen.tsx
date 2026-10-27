import { tr } from "@/i18n";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, ExternalLink, ImagePlus, Pencil, Plus, Search, Star, Trash2 } from "lucide-react";
import { useMutations, useWorkspace } from "@/hooks/use-workspace";
import { resolveFileUrl } from "@/components/app/doc-open";
import { EntityDialog } from "@/components/app/EntityDialog";
import { Empty, PageHeader } from "@/components/app/ui-bits";
import { tradeName, tradeOptions } from "@/lib/options";
import { eur } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { Idea } from "@/lib/schema";

export const Route = createFileRoute("/_ws/sammlungen")({
  head: () => ({
    meta: [
      { title: tr("collections.collections_bauplan") },
      { name: "description", content: tr("collections.ideas_links_images_floors") },
      { property: "og:title", content: tr("collections.collections_bauplan") },
      { property: "og:description", content: tr("collections.collect_ideas_links_images") },
    ],
  }),
  component: CollectionsPage,
});

const splitTags = (t: string | null) => (t ?? "").split(",").map((x) => x.trim()).filter(Boolean);

function CollectionsPage() {
  const { ws } = useWorkspace();
  const { create, update, remove, upload } = useMutations();
  const [col, setCol] = useState<string | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const [trade, setTrade] = useState("");
  const [q, setQ] = useState("");
  const [favOnly, setFavOnly] = useState(false);
  const [dlg, setDlg] = useState<{ id?: string; initial?: Record<string, unknown> } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");

  const collections = useMemo(() => {
    const m = new Map<string, number>();
    ws.ideas.forEach((i) => m.set(i.collection, (m.get(i.collection) ?? 0) + 1));
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], "de"));
  }, [ws.ideas]);
  const tags = useMemo(() => [...new Set(ws.ideas.flatMap((i) => splitTags(i.tags)))].sort((a, b) => a.localeCompare(b, "de")), [ws.ideas]);

  const list = ws.ideas
    .filter((i) => !col || i.collection === col)
    .filter((i) => !tag || splitTags(i.tags).includes(tag))
    .filter((i) => !trade || i.trade_id === trade)
    .filter((i) => !favOnly || i.favorite)
    .filter((i) => !q || [i.title, i.notes, i.url, i.room, i.tags].join(" ").toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => Number(b.favorite) - Number(a.favorite) || (b.created_at ?? "").localeCompare(a.created_at ?? ""));

  const docPath = (id: string | null) => (id ? ws.documents.find((d) => d.id === id)?.storage_path ?? null : null);

  const pickFile = (f: File | undefined) => {
    if (!f || !fileRef.current) return;
    const dt = new DataTransfer();
    dt.items.add(f);
    fileRef.current.files = dt.files;
    setFileName(f.name);
  };

  return (
    <>
      <PageHeader
        title={tr("shared.collections")}
        subtitle={tr("collections.links_images_ideas_floors")}
        actions={<Button size="sm" onClick={() => setDlg({ initial: { collection: col ?? "" } })}><Plus className="h-4 w-4" /> {tr("collections.idea")}</Button>}
      />

      {ws.ideas.length > 0 && (
        <>
          <div className="mb-3 flex flex-wrap gap-2">
            <Chip active={!col} onClick={() => setCol(null)}>{tr("shared.all")} ({ws.ideas.length})</Chip>
            {collections.map(([c, n]) => <Chip key={c} active={col === c} onClick={() => setCol(col === c ? null : c)}>{c} ({n})</Chip>)}
          </div>
          <div className="mb-5 flex flex-wrap items-center gap-2">
            <div className="relative min-w-52 flex-1">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-9" placeholder={tr("shared.search")} value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <select aria-label={tr("shared.trade")} className="h-9 rounded-md border bg-background px-2 text-sm" value={trade} onChange={(e) => setTrade(e.target.value)}>
              <option value="">{tr("shared.all_trades")}</option>
              {ws.trades.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <Button variant={favOnly ? "default" : "outline"} size="sm" onClick={() => setFavOnly(!favOnly)}><Star className="h-4 w-4" /> {tr("collections.favorites")}</Button>
          </div>
          {tags.length > 0 && (
            <div className="mb-5 flex flex-wrap gap-1.5">
              {tags.map((t) => <Chip key={t} small active={tag === t} onClick={() => setTag(tag === t ? null : t)}>#{t}</Chip>)}
            </div>
          )}
        </>
      )}

      {list.length ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((i) => (
            <IdeaCard
              key={i.id}
              idea={i}
              path={docPath(i.document_id)}
              trade={i.trade_id ? tradeName(ws, i.trade_id) : null}
              onFav={() => update.mutate({ table: "ideas", id: i.id, patch: { favorite: !i.favorite } })}
              onEdit={() => setDlg({ id: i.id, initial: { ...i } })}
              onDelete={() => confirm(tr("collections.delete_idea")) && remove.mutate({ table: "ideas", id: i.id })}
              onTag={setTag}
            />
          ))}
        </div>
      ) : (
        <Empty>{ws.ideas.length ? tr("shared.no_results") : tr("collections.nothing_collected_yet_add")}</Empty>
      )}

      <EntityDialog
        open={!!dlg}
        onOpenChange={(o) => { if (!o) { setDlg(null); setFileName(""); } }}
        title={dlg?.id ? tr("collections.edit_idea") : tr("collections.new_idea")}
        fields={[
          { name: "title", label: tr("shared.title"), required: true, full: true },
          { name: "collection", label: tr("collections.collection"), required: true, suggestions: collections.map(([c]) => c) },
          { name: "room", label: tr("collections.room") },
          { name: "url", label: tr("collections.link"), full: true },
          { name: "trade_id", label: tr("shared.trade"), type: "select", options: tradeOptions(ws) },
          { name: "price", label: tr("collections.price_optional"), type: "number" },
          { name: "tags", label: tr("shared.tags_comma_separated"), full: true, suggestions: tags },
          { name: "favorite", label: tr("collections.favorite"), type: "checkbox", full: true },
          { name: "notes", label: tr("shared.notes"), type: "textarea" },
        ]}
        initial={dlg?.initial}
        extra={
          <div className="grid gap-1.5">
            <Label>{tr(dlg?.initial?.["document_id"] ? "collections.replace_image" : "collections.image_optional")}</Label>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => camRef.current?.click()}><Camera className="h-4 w-4" /> {tr("shared.take_photo")}</Button>
              <Button type="button" size="sm" variant="outline" onClick={() => fileRef.current?.click()}><ImagePlus className="h-4 w-4" /> {tr("collections.choose_image")}</Button>
              {fileName && <span className="self-center text-xs text-muted-foreground">{fileName}</span>}
            </div>
            <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => pickFile(e.target.files?.[0])} />
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => setFileName(e.target.files?.[0]?.name ?? "")} />
          </div>
        }
        onSubmit={async (v) => {
          const file = fileRef.current?.files?.[0];
          const row = { ...v };
          if (file) row["document_id"] = (await upload.mutateAsync({ file, meta: { category: "Foto", tags: String(v["collection"] ?? "") } })).id;
          if (row["url"] && !/^https?:\/\//i.test(String(row["url"]))) row["url"] = `https://${row["url"]}`;
          setFileName("");
          return dlg?.id ? update.mutateAsync({ table: "ideas", id: dlg.id, patch: row }) : create.mutateAsync({ table: "ideas", row });
        }}
      />
    </>
  );
}

function Chip({ active, onClick, children, small }: { active: boolean; onClick: () => void; children: React.ReactNode; small?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("rounded-full border transition-colors", small ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-sm", active ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:border-primary/50")}
    >
      {children}
    </button>
  );
}

function IdeaCard({ idea, path, trade, onFav, onEdit, onDelete, onTag }: {
  idea: Idea; path: string | null; trade: string | null; onFav: () => void; onEdit: () => void; onDelete: () => void; onTag: (t: string) => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (path) resolveFileUrl(path).then((u) => alive && setSrc(u));
    return () => { alive = false; };
  }, [path]);
  const host = idea.url ? (() => { try { return new URL(idea.url).hostname.replace(/^www\./, ""); } catch { return idea.url; } })() : null;

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border bg-card shadow-card">
      {src ? (
        <a href={src} target="_blank" rel="noreferrer"><img src={src} alt={idea.title} className="aspect-[4/3] w-full object-cover" loading="lazy" /></a>
      ) : (
        <div className="flex aspect-[4/3] items-center justify-center bg-muted text-muted-foreground"><ImagePlus className="h-8 w-8 opacity-40" /></div>
      )}
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-xs text-muted-foreground">{idea.collection}{idea.room && ` · ${idea.room}`}{trade && ` · ${trade}`}</div>
            <h3 className="font-semibold leading-snug">{idea.title}</h3>
          </div>
          <button type="button" aria-label={tr("collections.favorite")} onClick={onFav}>
            <Star className={cn("h-5 w-5", idea.favorite ? "fill-warning text-warning" : "text-muted-foreground")} />
          </button>
        </div>
        {idea.price != null && <div className="text-sm font-medium tabular">{eur(idea.price)}</div>}
        {idea.notes && <p className="whitespace-pre-line text-sm text-muted-foreground">{idea.notes}</p>}
        {splitTags(idea.tags).length > 0 && (
          <div className="flex flex-wrap gap-1">
            {splitTags(idea.tags).map((t) => <button key={t} type="button" onClick={() => onTag(t)} className="rounded bg-muted px-1.5 py-0.5 text-xs hover:bg-accent">#{t}</button>)}
          </div>
        )}
        <div className="mt-auto flex items-center gap-1 pt-2">
          {idea.url && (
            <a href={idea.url} target="_blank" rel="noreferrer" className="flex min-w-0 flex-1 items-center gap-1 truncate text-sm text-primary hover:underline">
              <ExternalLink className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{host}</span>
            </a>
          )}
          <span className="ml-auto flex">
            <Button size="icon" variant="ghost" aria-label={tr("shared.edit")} onClick={onEdit}><Pencil className="h-4 w-4" /></Button>
            <Button size="icon" variant="ghost" aria-label={tr("shared.delete")} onClick={onDelete}><Trash2 className="h-4 w-4" /></Button>
          </span>
        </div>
      </div>
    </div>
  );
}
