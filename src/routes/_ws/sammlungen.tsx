import { tr } from "@/i18n";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, ExternalLink, ImagePlus, Images, Pencil, Plus, Search, Star, Trash2, X } from "lucide-react";
import { useMutations, useWorkspace } from "@/hooks/use-workspace";
import { ImageGallery, type GalleryImage } from "@/components/app/ImageGallery";
import { useFileUrl } from "@/components/app/doc-open";
import { ideaImages, type IdeaImageRef } from "@/lib/ideas";
import { collectTags, splitTags } from "@/lib/tags";
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
  const [pending, setPending] = useState<File[]>([]);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [gallery, setGallery] = useState<{ title: string; images: GalleryImage[]; index: number } | null>(null);

  const collections = useMemo(() => {
    const m = new Map<string, number>();
    ws.ideas.forEach((i) => m.set(i.collection, (m.get(i.collection) ?? 0) + 1));
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], "de"));
  }, [ws.ideas]);
  const tags = useMemo(() => collectTags(ws.ideas.map((i) => i.tags)), [ws.ideas]);

  const list = ws.ideas
    .filter((i) => !col || i.collection === col)
    .filter((i) => !tag || splitTags(i.tags).includes(tag))
    .filter((i) => !trade || i.trade_id === trade)
    .filter((i) => !favOnly || i.favorite)
    .filter((i) => !q || [i.title, i.notes, i.url, i.room, i.tags].join(" ").toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => Number(b.favorite) - Number(a.favorite) || (b.created_at ?? "").localeCompare(a.created_at ?? ""));

  const imagesOf = (i: Pick<Idea, "id" | "document_id">) => ideaImages(i, ws.idea_images ?? [], ws.documents);
  const editImages = dlg?.id ? imagesOf({ id: dlg.id, document_id: (dlg.initial?.["document_id"] as string | null) ?? null }) : [];
  const toGallery = (refs: IdeaImageRef[]): GalleryImage[] => refs.map((d) => ({ id: d.id, path: d.storage_path, name: d.name }));

  const addFiles = (files: FileList | null) => {
    if (files?.length) setPending((p) => [...p, ...Array.from(files)]);
  };
  const resetImages = () => {
    setPending([]);
    setRemoved(new Set());
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
              images={imagesOf(i)}
              onOpenImages={(index) => setGallery({ title: i.title, images: toGallery(imagesOf(i)), index })}
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
        onOpenChange={(o) => { if (!o) { setDlg(null); resetImages(); } }}
        title={dlg?.id ? tr("collections.edit_idea") : tr("collections.new_idea")}
        fields={[
          { name: "title", label: tr("shared.title"), required: true, full: true },
          { name: "collection", label: tr("collections.collection"), type: "select", required: true, options: collections.map(([c]) => ({ value: c, label: c })), addLabel: tr("collections.new_collection") },
          { name: "room", label: tr("collections.room") },
          { name: "url", label: tr("collections.link"), full: true },
          { name: "trade_id", label: tr("shared.trade"), type: "select", options: tradeOptions(ws) },
          { name: "price", label: tr("collections.price_optional"), type: "number" },
          { name: "tags", label: tr("documents.tags"), type: "tags", full: true, suggestions: tags },
          { name: "favorite", label: tr("collections.favorite"), type: "checkbox", full: true },
          { name: "notes", label: tr("shared.notes"), type: "textarea" },
        ]}
        initial={dlg?.initial}
        extra={
          <div className="grid gap-1.5">
            <Label>{tr("collections.images_optional")}</Label>
            {(editImages.some((d) => !removed.has(d.id)) || pending.length > 0) && (
              <div className="flex flex-wrap gap-2">
                {editImages.filter((d) => !removed.has(d.id)).map((d) => (
                  <Thumb key={d.id} path={d.storage_path} name={d.name} onRemove={() => setRemoved((r) => new Set(r).add(d.id))} />
                ))}
                {pending.map((f, n) => (
                  <Thumb key={`${f.name}-${n}`} file={f} name={f.name} onRemove={() => setPending((p) => p.filter((_, k) => k !== n))} />
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => camRef.current?.click()}><Camera className="h-4 w-4" /> {tr("shared.take_photo")}</Button>
              <Button type="button" size="sm" variant="outline" onClick={() => fileRef.current?.click()}><ImagePlus className="h-4 w-4" /> {tr("collections.choose_images")}</Button>
            </div>
            <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
            <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
          </div>
        }
        onSubmit={async (v) => {
          const row = { ...v };
          delete row["id"];
          delete row["created_at"];
          delete row["updated_at"];
          if (row["url"] && !/^https?:\/\//i.test(String(row["url"]))) row["url"] = `https://${row["url"]}`;
          const legacy = dlg?.initial?.["document_id"];
          if (typeof legacy === "string" && removed.has(legacy)) row["document_id"] = null;
          let id = dlg?.id;
          if (id) await update.mutateAsync({ table: "ideas", id, patch: row });
          else {
            id = (await create.mutateAsync({ table: "ideas", row })).id;
            // A failed image upload keeps the dialog open; retrying must update, not duplicate, the idea.
            const created = id;
            setDlg((d) => d && { ...d, id: created });
          }
          for (const d of editImages)
            if (removed.has(d.id) && d.source === "image") await remove.mutateAsync({ table: "idea_images", id: d.id });
          for (const file of pending) {
            await upload.mutateAsync({ file, meta: { idea_id: id } });
            setPending((p) => p.filter((f) => f !== file));
          }
          resetImages();
        }}
      />
      {gallery && (
        <ImageGallery open title={gallery.title} images={gallery.images} startIndex={gallery.index} onOpenChange={(o) => !o && setGallery(null)} />
      )}
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

function Thumb({ path, file, name, onRemove }: { path?: string | null; file?: File; name: string; onRemove: () => void }) {
  const remote = useFileUrl(file ? null : path);
  const [local, setLocal] = useState<string | null>(null);
  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setLocal(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const src = local ?? remote;
  return (
    <div className="relative h-20 w-20 overflow-hidden rounded-md border bg-muted">
      {src && <img src={src} alt={name} className="h-full w-full object-cover" />}
      <button
        type="button"
        aria-label={tr("collections.remove_image", { name })}
        onClick={onRemove}
        className="absolute right-1 top-1 rounded-full bg-background/80 p-1 backdrop-blur hover:bg-background"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function IdeaCard({ idea, images, onOpenImages, trade, onFav, onEdit, onDelete, onTag }: {
  idea: Idea; images: IdeaImageRef[]; onOpenImages: (index: number) => void; trade: string | null; onFav: () => void; onEdit: () => void; onDelete: () => void; onTag: (t: string) => void;
}) {
  const src = useFileUrl(images[0]?.storage_path);
  const host = idea.url ? (() => { try { return new URL(idea.url).hostname.replace(/^www\./, ""); } catch { return idea.url; } })() : null;

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border bg-card shadow-card">
      {images.length ? (
        <button type="button" className="relative block" aria-label={tr("collections.show_images", { count: images.length })} onClick={() => onOpenImages(0)}>
          {src ? <img src={src} alt={idea.title} className="aspect-[4/3] w-full object-cover" loading="lazy" /> : <div className="aspect-[4/3] w-full animate-pulse bg-muted" />}
          {images.length > 1 && (
            <span className="absolute bottom-2 right-2 flex items-center gap-1 rounded-full bg-background/80 px-2 py-0.5 text-xs font-medium backdrop-blur">
              <Images className="h-3.5 w-3.5" aria-hidden="true" /> {images.length}
            </span>
          )}
        </button>
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
