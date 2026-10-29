import { tr } from "@/i18n";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { usePaperlessDocuments, usePaperlessSettings } from "@/hooks/use-paperless";
import {
  exportPaperlessDocuments,
  getPaperlessMetadata,
  importPaperlessDocument,
  previewPaperless,
  reconcilePaperlessDocument,
  searchPaperless,
  verifyPaperlessDocuments,
} from "@/lib/data.functions";
import { getOfflineAccount } from "@/lib/offline-store";
import {
  matchesPaperlessPresence,
  visibleSelection,
  type PaperlessPresence,
} from "@/lib/paperless-view";
import type { Extraction } from "@/lib/ocr-parse";
import { PaperlessPicker } from "@/components/app/PaperlessPicker";
import { PaperlessExportDialog } from "@/components/app/PaperlessExportDialog";
import {
  PaperlessDocumentControls,
  PaperlessDocumentStatus,
} from "@/components/app/PaperlessDocumentControls";
import { PaperlessError } from "@/components/app/paperless-ui";
import { Checkbox } from "@/components/ui/checkbox";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import {
  Download,
  ChevronDown,
  ChevronUp,
  Eye,
  LayoutGrid,
  List,
  FileImage,
  FileSpreadsheet,
  FileText,
  File as FileIcon,
  Pencil,
  RefreshCw,
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
import { collectTags, splitTags } from "@/lib/tags";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DocumentPreview } from "@/components/app/DocumentPreview";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
  const { t } = useTranslation("paperless");
  const [view, setView] = useState<"list" | "cards">(() => {
    try {
      return localStorage.getItem("bauplan.documents.view") === "list" ? "list" : "cards";
    } catch (error) {
      console.warn("[documents] Could not restore the preferred view", error);
      return "cards";
    }
  });
  const cards = view === "cards";
  const DocumentsContainer = cards ? "div" : Panel;
  const DocumentSurface = cards ? Panel : "div";
  const client = useQueryClient();
  const account = getOfflineAccount();
  const paperless = usePaperlessSettings();
  useEffect(() => {
    if (paperless.data?.allowed === false || !paperless.data?.enabled) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible")
        void client.invalidateQueries({ queryKey: ["ws"] });
    }, 30_000);
    return () => clearInterval(timer);
  }, [client, paperless.data?.allowed, paperless.data?.enabled]);
  const [paperlessOpen, setPaperlessOpen] = useState(false);
  const paperlessVisible =
    paperless.data?.allowed !== false && !!(paperless.data?.configured || paperless.data?.enabled);
  const paperlessMode = paperlessOpen && paperlessVisible;
  const paperlessStates = usePaperlessDocuments(
    paperlessVisible && (paperless.data?.configured ?? false),
  );
  const stateById = useMemo(
    () => new Map(paperlessStates.data?.map((state) => [state.documentId, state])),
    [paperlessStates.data],
  );
  const [presence, setPresence] = useState<PaperlessPresence>("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [picker, setPicker] = useState<"import" | { documentId: string } | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [imported, setImported] = useState<{
    documentId: string;
    extraction: Extraction | null;
  } | null>(null);
  const metadata = useQuery({
    queryKey: ["paperless", account?.id, paperless.data?.instanceId, "metadata"],
    queryFn: () => getPaperlessMetadata(),
    enabled: paperlessVisible && !!paperless.data?.connected && (picker !== null || exportOpen),
    gcTime: 0,
    staleTime: 0,
    retry: false,
  });
  const refreshPaperless = () => client.invalidateQueries({ queryKey: ["paperless"] });
  const verify = useMutation({
    mutationFn: (documentIds: string[]) => verifyPaperlessDocuments({ data: { documentIds } }),
    onSuccess: async () => {
      await refreshPaperless();
      toast.success(t("verified"));
    },
  });
  const abandon = useMutation({
    mutationFn: (documentId: string) =>
      reconcilePaperlessDocument({
        data: { documentId, action: "abandon", confirmDuplicateRisk: true },
      }),
    onSuccess: async () => {
      await refreshPaperless();
      toast.success(t("reconciled"));
    },
  });
  const checkTransfer = useMutation({
    mutationFn: (documentId: string) =>
      reconcilePaperlessDocument({
        data: { documentId, action: "check", confirmDuplicateRisk: false },
      }),
    onSuccess: async () => {
      await refreshPaperless();
      toast.success(t("reconciled"));
    },
  });
  const { ws } = useWorkspace();
  const { update, remove } = useMutations();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("aktion") === "neu",
  );
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
          !paperlessMode ||
          presence === "all" ||
          (!!paperlessStates.data &&
            matchesPaperlessPresence(presence, !!stateById.get(d.id)?.link)),
      )
      .filter(
        (d) =>
          !s ||
          [d.name, d.tags, d.description, d.category, tradeName(ws, d.trade_id)]
            .join(" ")
            .toLowerCase()
            .includes(s),
      )
      .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  }, [ws, q, cat, presence, paperlessMode, paperlessStates.data, stateById]);
  const visibleIds = docs.map((document) => document.id);
  const selectedIds = visibleSelection(selected, visibleIds);
  const selectedDocs = docs.filter((document) => selectedIds.includes(document.id));
  const exportableDocs = selectedDocs.filter((document) => {
    const state = stateById.get(document.id);
    return !state?.link && (!state?.job || ["failed", "abandoned"].includes(state.job.state));
  });
  const canAct =
    paperlessVisible &&
    !!paperless.data?.enabled &&
    !!paperless.data.connected &&
    !paperlessStates.isError;

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
      {paperlessVisible && (
        <div className="mb-5 overflow-hidden rounded-xl border bg-card">
          <button
            type="button"
            className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
            aria-expanded={paperlessMode}
            aria-controls="paperless-tools"
            onClick={() => {
              setPaperlessOpen(!paperlessMode);
              setSelected([]);
              setPresence("all");
            }}
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
              <RefreshCw className="size-4" aria-hidden="true" />
            </span>
            <span className="text-sm font-semibold">{t("tools")}</span>
            <span className="ml-auto text-xs text-muted-foreground">
              {t(paperlessMode ? "toolsShown" : "toolsHidden")}
            </span>
            {paperlessMode ? (
              <ChevronUp className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            ) : (
              <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            )}
          </button>
          <div
            id="paperless-tools"
            hidden={!paperlessMode}
            className={cn(paperlessMode && "border-t p-4 sm:p-5")}
          >
            {paperlessMode && (
              <PaperlessDocumentControls
                connected={canAct}
                presence={presence}
                onPresence={setPresence}
                selectedCount={selectedIds.length}
                exportCount={exportableDocs.length}
                allSelected={docs.length > 0 && selectedIds.length === docs.length}
                onSelectAll={(checked) =>
                  setSelected((previous) =>
                    checked
                      ? [...new Set([...previous, ...visibleIds])]
                      : previous.filter((id) => !visibleIds.includes(id)),
                  )
                }
                onClear={() => setSelected([])}
                onImport={() => setPicker("import")}
                onExport={() => {
                  if (selectedIds.length > 50) toast.error(t("selectionLimit"));
                  else if (exportableDocs.length) {
                    const skipped = selectedDocs.length - exportableDocs.length;
                    if (skipped) toast.info(t("skipped", { count: skipped }));
                    setExportOpen(true);
                  }
                }}
                onVerify={() => {
                  if (selectedIds.length > 50) toast.error(t("selectionLimit"));
                  else verify.mutate(selectedIds);
                }}
                busy={
                  verify.isPending ||
                  abandon.isPending ||
                  checkTransfer.isPending ||
                  paperlessStates.isPending
                }
              />
            )}
          </div>
        </div>
      )}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex w-full items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder={tr("documents.search_name_tag")}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>
        <div className="flex w-full flex-wrap gap-1">
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
        <ToggleGroup
          type="single"
          variant="outline"
          size="lg"
          value={view}
          aria-label={tr("documents.view")}
          className="ml-auto"
          onValueChange={(value) => {
            if (value !== "list" && value !== "cards") return;
            setView(value);
            try {
              localStorage.setItem("bauplan.documents.view", value);
            } catch (error) {
              console.warn("[documents] Could not save the preferred view", error);
              toast.warning(tr("documents.view_not_saved"));
            }
          }}
        >
          <ToggleGroupItem
            value="list"
            aria-label={tr("documents.list_view")}
            title={tr("documents.list_view")}
          >
            <List aria-hidden="true" />
          </ToggleGroupItem>
          <ToggleGroupItem
            value="cards"
            aria-label={tr("documents.card_view")}
            title={tr("documents.card_view")}
          >
            <LayoutGrid aria-hidden="true" />
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <PaperlessError
        error={
          paperless.error ??
          (paperlessVisible
            ? (paperlessStates.error ?? verify.error ?? abandon.error ?? checkTransfer.error)
            : null)
        }
      />
      {paperlessMode && paperlessStates.isPending && <p role="status">{t("loading")}</p>}
      {(paperless.isError || (paperlessVisible && paperlessStates.isError)) && (
        <Button
          variant="outline"
          onClick={() => {
            void paperless.refetch();
            if (paperlessVisible) void paperlessStates.refetch();
          }}
        >
          {t("retry")}
        </Button>
      )}
      <DocumentsContainer>
        <ul
          aria-label={tr("shared.documents")}
          className={cn(
            cards ? "grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3" : "divide-y",
          )}
        >
          {docs.map((d, index) => {
            const related = links(d);
            return (
              <li key={d.id} className="min-w-0">
                <DocumentSurface
                  className={cn(
                    "grid grid-cols-[2rem_minmax(0,1fr)] items-start gap-x-3 gap-y-3",
                    cards
                      ? "h-full grid-rows-[1fr_auto]"
                      : "py-4 lg:grid-cols-[2rem_minmax(0,1fr)_auto]",
                    !cards && index === 0 && "pt-0",
                    !cards && index === docs.length - 1 && "pb-0",
                  )}
                >
                  <div className="flex flex-col items-center gap-2 pt-1">
                    {paperlessMode && (
                      <Checkbox
                        aria-label={t("select", { name: d.name })}
                        checked={selected.includes(d.id)}
                        onCheckedChange={(checked) =>
                          setSelected((previous) =>
                            checked
                              ? [...new Set([...previous, d.id])]
                              : previous.filter((id) => id !== d.id),
                          )
                        }
                      />
                    )}
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
                        {splitTags(d.tags).map((t) => (
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
                      <p className="mt-2 text-sm text-muted-foreground [overflow-wrap:anywhere]">
                        {d.description}
                      </p>
                    )}
                    {paperlessMode &&
                      (() => {
                        const state = stateById.get(d.id);
                        return (
                          <PaperlessDocumentStatus
                            linked={!!state?.link}
                            state={state?.job?.state ?? null}
                            url={state?.link?.url ?? null}
                            checked={
                              state?.verification?.checkedAt
                                ? fmtDate(state.verification.checkedAt.slice(0, 10))
                                : null
                            }
                            verification={
                              state?.verification
                                ? state.verification.state === "verified"
                                  ? "accessible"
                                  : state.verification.state === "inaccessible"
                                    ? "inaccessible"
                                    : "unverified"
                                : null
                            }
                            canResolve={canAct && !!state?.job?.canResolve && !state.link}
                            canAbandon={!!state?.job?.canAbandon && !state.link}
                            onResolve={() => setPicker({ documentId: d.id })}
                            onAbandon={() =>
                              window.confirm(t("abandonConfirm")) && abandon.mutate(d.id)
                            }
                            onCheck={() => checkTransfer.mutate(d.id)}
                            error={state?.job?.error}
                          />
                        );
                      })()}
                  </div>
                  <div
                    className={cn(
                      "col-span-2 flex w-full items-center gap-2 border-t border-border pt-2",
                      cards
                        ? "justify-end"
                        : "justify-between lg:col-span-1 lg:w-auto lg:justify-end lg:border-0 lg:pt-0",
                    )}
                  >
                    <Button
                      size="sm"
                      variant="outline"
                      className={cn(cards ? "hidden" : "lg:hidden")}
                      onClick={() => open(d, "preview")}
                    >
                      <Eye className="h-4 w-4" /> {tr("documents.preview")}
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          size="sm"
                          variant="outline"
                          className={cn(cards ? "hidden" : "lg:hidden")}
                        >
                          {tr("shared.actions")}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-44 lg:hidden">
                        <DropdownMenuGroup>
                          {(d.mime_type === "application/pdf" ||
                            d.mime_type?.startsWith("image/")) && (
                            <DropdownMenuItem
                              className="min-h-11"
                              onSelect={() => setAssignId(d.id)}
                            >
                              <ScanText /> {tr("documents.recognize_assign_content")}
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            className="min-h-11"
                            onSelect={() => {
                              void open(d, "download");
                            }}
                          >
                            <Download /> {tr("documents.download")}
                          </DropdownMenuItem>
                          <DropdownMenuItem className="min-h-11" onSelect={() => setEdit(d)}>
                            <Pencil /> {tr("shared.edit")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="min-h-11 text-destructive"
                            onSelect={() => {
                              if (confirm(tr("documents.delete_document", { name: d.name })))
                                remove.mutate({ table: "documents", id: d.id });
                            }}
                          >
                            <Trash2 /> {tr("shared.delete")}
                          </DropdownMenuItem>
                        </DropdownMenuGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <div
                      className={cn(
                        "items-center gap-1",
                        cards ? "flex flex-wrap" : "hidden lg:flex",
                      )}
                    >
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
                </DocumentSurface>
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
      </DocumentsContainer>

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
      <AssignDialog
        documentId={assignId}
        onClose={() => {
          setAssignId(null);
          setImported(null);
        }}
        initialExtraction={imported?.documentId === assignId ? imported.extraction : undefined}
      />
      {(picker !== null || exportOpen) && canAct && (
        <>
          <PaperlessError error={metadata.error} />
          {metadata.isPending && <p role="status">{t("loading")}</p>}
          {metadata.isError && (
            <Button variant="outline" onClick={() => metadata.refetch()}>
              {t("retry")}
            </Button>
          )}
          {!metadata.data && (
            <Button
              variant="ghost"
              onClick={() => {
                setPicker(null);
                setExportOpen(false);
              }}
            >
              {t("cancel")}
            </Button>
          )}
        </>
      )}
      {picker !== null && canAct && account && metadata.data && (
        <PaperlessPicker
          key={`${account.id}:${paperless.data?.instanceId}:${typeof picker === "string" ? picker : picker.documentId}`}
          userId={account.id}
          instanceKey={paperless.data?.instanceId ?? ""}
          metadata={metadata.data}
          reconcile={picker !== "import"}
          onClose={() => setPicker(null)}
          search={async (filters) => {
            const result = await searchPaperless({
              data: {
                query: filters.query,
                page: filters.page,
                tags: filters.tag ? [filters.tag] : [],
                ...(filters.documentType ? { documentType: filters.documentType } : {}),
                ...(filters.correspondent ? { correspondent: filters.correspondent } : {}),
                ...(filters.dateFrom ? { dateFrom: filters.dateFrom } : {}),
                ...(filters.dateUntil ? { dateTo: filters.dateUntil } : {}),
              },
            });
            return { ...result, hasNext: result.page * result.pageSize < result.count };
          }}
          preview={async (remoteId) => {
            const result = await previewPaperless({ data: { remoteId } });
            return new Blob(
              [Uint8Array.from(atob(result.base64), (character) => character.charCodeAt(0))],
              { type: result.mime },
            );
          }}
          choose={async (remoteId) => {
            if (picker !== "import") {
              await reconcilePaperlessDocument({
                data: {
                  documentId: picker.documentId,
                  action: "link",
                  remoteId,
                  confirmDuplicateRisk: false,
                },
              });
              toast.success(t("reconciled"));
            } else {
              const result = await importPaperlessDocument({ data: { remoteId } });
              await client.invalidateQueries({ queryKey: ["ws"] });
              toast.success(t(result.duplicate ? "alreadyImported" : "imported"));
              if (!result.duplicate) {
                setImported({ documentId: result.documentId, extraction: result.extraction });
                setAssignId(result.documentId);
                if (result.extractionError) toast.warning(t(`errors.${result.extractionError}`));
              }
            }
            setPicker(null);
            await refreshPaperless();
          }}
        />
      )}
      {exportOpen && canAct && metadata.data && (
        <PaperlessExportDialog
          documents={exportableDocs}
          metadata={metadata.data}
          destination={paperless.data?.browserUrl ?? ""}
          account={account?.email ?? ""}
          onClose={() => setExportOpen(false)}
          onSubmit={async (drafts) => {
            await exportPaperlessDocuments({
              data: {
                documents: drafts.map((draft) => ({
                  documentId: draft.documentId,
                  title: draft.title,
                  documentDate: draft.created ?? null,
                  tags: draft.tags,
                  documentType: draft.documentType ?? null,
                  correspondent: draft.correspondent ?? null,
                })),
              },
            });
            setExportOpen(false);
            setSelected([]);
            await refreshPaperless();
            toast.info(t("submitted"));
          }}
        />
      )}
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
          {
            name: "tags",
            label: tr("documents.tags"),
            type: "tags",
            full: true,
            suggestions: collectTags(ws.documents.map((d) => d.tags)),
          },
          { name: "description", label: tr("shared.description"), type: "textarea" },
        ]}
        initial={edit ? { ...edit } : undefined}
        onSubmit={(v) => update.mutateAsync({ table: "documents", id: edit!.id, patch: v })}
      />
      {preview && (
        <DocumentPreview
          name={preview.doc.name}
          mime={preview.doc.mime_type}
          url={preview.url}
          onClose={() => setPreview(null)}
        />
      )}
    </>
  );
}
