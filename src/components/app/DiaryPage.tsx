import { useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  CheckCheck,
  ChevronRight,
  Download,
  ImageIcon,
  CloudSun,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Empty, PageHeader } from "@/components/app/ui-bits";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useFileUrl } from "@/components/app/doc-open";
import { useMutations, useWorkspace } from "@/hooks/use-workspace";
import { tr } from "@/i18n";
import { getDiaryWeather } from "@/lib/data.functions";
import {
  parseDiaryIds,
  parseDiarySubtaskLinks,
  diarySubtaskKey,
  diarySubtasks,
  linkedDiarySubtasks,
  type DiarySubtaskLink,
  parseDiaryWeather,
  validateDiaryEntry,
  diaryDaySuggestions,
  refreshDiarySuggestions,
  DIARY_LINK_TABLES,
  type DiarySuggestions,
  diaryConditionKey,
  diaryEntryTrades,
  EMPTY_DIARY_FILTERS,
  filterDiaryEntries,
  MAX_DIARY_LINKS,
  type DiaryWeather,
} from "@/lib/diary";
import { MAX_DIARY_MEDIA_MB } from "@/lib/limits";
import type { DiaryEntry, DiaryMedia } from "@/lib/schema";
import { cn } from "@/lib/utils";
import { eur, fmtDate } from "@/lib/format";
import { normalizeLegacyExpense } from "@/lib/expenses";
import { DiaryTimelineNav } from "./DiaryTimelineNav";
import { ImageGallery } from "./ImageGallery";
import { groupDiaryEntries, nearestDiaryEntry } from "@/lib/diary";

const DIARY_BATCH_SIZE = 40;

type Draft = {
  entry_date: string;
  title: string;
  weather_snapshot: DiaryWeather | null;
  work_done: string;
  progress: string;
  issues: string;
  task_ids: string[];
  subtask_links: DiarySubtaskLink[];
  event_ids: string[];
  trade_ids: string[];
  offer_ids: string[];
  payment_ids: string[];
};
const EMPTY_AUTO_LINKS: DiarySuggestions = {
  task_ids: [],
  subtask_links: [],
  offer_ids: [],
  payment_ids: [],
};

const localDate = () => {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
};

function emptyDraft(): Draft {
  return {
    entry_date: localDate(),
    title: "",
    weather_snapshot: null,
    work_done: "",
    progress: "",
    issues: "",
    task_ids: [],
    subtask_links: [],
    event_ids: [],
    trade_ids: [],
    offer_ids: [],
    payment_ids: [],
  };
}

function draftFromEntry(entry: DiaryEntry): Draft {
  return {
    entry_date: entry.entry_date,
    title: entry.title,
    weather_snapshot: parseDiaryWeather(entry.weather_snapshot),
    work_done: entry.work_done ?? "",
    progress: entry.progress ?? "",
    issues: entry.issues ?? "",
    task_ids: parseDiaryIds(entry.task_ids),
    subtask_links: parseDiarySubtaskLinks(entry.subtask_links),
    event_ids: parseDiaryIds(entry.event_ids),
    trade_ids: parseDiaryIds(entry.trade_ids),
    offer_ids: parseDiaryIds(entry.offer_ids),
    payment_ids: parseDiaryIds(entry.payment_ids),
  };
}

function WeatherSummary({ weather }: { weather: DiaryWeather }) {
  return (
    <div className="rounded-lg bg-muted/60 p-3 text-sm">
      <p className="font-medium">{tr(diaryConditionKey(weather.code), { code: weather.code })}</p>
      {(weather.temperatureMin !== null || weather.temperatureMax !== null) && (
        <p className="text-muted-foreground">
          {tr("diary.temperature_range", {
            min: weather.temperatureMin ?? "–",
            max: weather.temperatureMax ?? "–",
          })}
        </p>
      )}
      {weather.precipitation !== null && (
        <p className="text-muted-foreground">
          {tr("diary.precipitation", { value: weather.precipitation })}
        </p>
      )}
      <p className="mt-2 flex flex-wrap gap-2 text-xs">
        <a href="https://open-meteo.com/" target="_blank" rel="noreferrer" className="underline">
          {tr("diary.weather_attribution")}
        </a>
        <a
          href="https://creativecommons.org/licenses/by/4.0/"
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          {tr("diary.weather_license")}
        </a>
      </p>
    </div>
  );
}

function DiaryMediaItem({
  media,
  onOpen,
  onRemove,
  removing,
}: {
  media: DiaryMedia;
  onOpen: () => void;
  onRemove: () => void;
  removing: boolean;
}) {
  const src = useFileUrl(media.storage_path);
  const pending = media.storage_path?.startsWith("offline:") ?? false;
  const isImage = media.mime_type?.startsWith("image/") ?? false;
  const isVideo = media.mime_type?.startsWith("video/") ?? false;
  return (
    <li className="min-w-0 overflow-hidden rounded-lg border">
      {src && isImage && (
        <Button
          type="button"
          variant="ghost"
          className="block h-auto w-full cursor-zoom-in rounded-none p-0"
          aria-label={tr("diary.open_photo", { name: media.name })}
          onClick={onOpen}
        >
          <img
            src={src}
            alt={media.name}
            className="aspect-[4/3] w-full object-cover"
            loading="lazy"
          />
        </Button>
      )}
      {src && isVideo && (
        <video
          src={src}
          controls
          preload="metadata"
          className="aspect-[4/3] w-full bg-black object-contain"
        />
      )}
      <div className="flex items-center gap-2 p-2">
        {src && !isImage && !isVideo && (
          <a
            href={src}
            target="_blank"
            rel="noreferrer"
            className="min-w-0 flex-1 truncate underline"
          >
            {media.name}
          </a>
        )}
        {(!src || isImage || isVideo) && (
          <span className="min-w-0 flex-1 truncate text-sm">{media.name}</span>
        )}
        {pending && (
          <span className="text-xs text-muted-foreground">{tr("diary.media_pending")}</span>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={removing}
              aria-label={tr("diary.media_remove", { name: media.name })}
              onClick={onRemove}
            >
              <Trash2 aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{tr("diary.media_remove", { name: media.name })}</TooltipContent>
        </Tooltip>
      </div>
    </li>
  );
}

export function DiaryPage() {
  const { i18n } = useTranslation();
  const { ws, projectId, isLoading } = useWorkspace();
  const { create, update, remove, diaryMediaUpload } = useMutations();
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [detailEntryId, setDetailEntryId] = useState<string | null>(null);
  const [wizardStep, setWizardStep] = useState<"report" | "media" | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [deletion, setDeletion] = useState<
    { kind: "entry"; entry: DiaryEntry } | { kind: "media"; media: DiaryMedia } | null
  >(null);
  const [deleting, setDeleting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [autoLinks, setAutoLinks] = useState<DiarySuggestions>(EMPTY_AUTO_LINKS);
  const [filters, setFilters] = useState(EMPTY_DIARY_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [gallery, setGallery] = useState<{
    entryId: string;
    mediaId: string;
    title: string;
  } | null>(null);
  const photoTrigger = useRef<HTMLElement | null>(null);
  const [range, setRange] = useState({ scope: "", start: 0, count: DIARY_BATCH_SIZE });
  const [activeMonth, setActiveMonth] = useState("");
  const [scrollTarget, setScrollTarget] = useState<{ id: string; focus: boolean } | null>(null);
  const chronicle = useRef<HTMLDivElement>(null);
  const loadMore = useRef<HTMLDivElement>(null);
  const editorHeading = useRef<HTMLHeadingElement>(null);
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const editorTrigger = useRef<HTMLButtonElement | null>(null);
  const detailTrigger = useRef<HTMLButtonElement | null>(null);
  const deleteTrigger = useRef<HTMLElement | null>(null);
  const actionOpensDialog = useRef(false);
  const busy = create.isPending || update.isPending || uploading || deleting;

  useEffect(() => {
    setFormOpen(false);
    setEditingId(null);
    setWizardStep(null);
    setDraft(emptyDraft());
    setAutoLinks(EMPTY_AUTO_LINKS);
    setDeletion(null);
    setGallery(null);
    setDetailEntryId(null);
    setFilters(EMPTY_DIARY_FILTERS);
    setFiltersOpen(false);
  }, [projectId]);

  useEffect(() => {
    if (formOpen && wizardStep) stepHeading.current?.focus();
    else if (formOpen) editorHeading.current?.focus();
  }, [formOpen, wizardStep, editingId]);

  const entries = useMemo(() => filterDiaryEntries(ws, filters), [ws, filters]);
  const groups = useMemo(() => groupDiaryEntries(entries), [entries]);
  const scope = JSON.stringify([projectId, filters]);
  const rangeMatches = range.scope === scope && range.start < entries.length;
  const visibleStart = rangeMatches ? range.start : 0;
  const visibleEnd = Math.min(
    entries.length,
    visibleStart + (rangeMatches ? range.count : DIARY_BATCH_SIZE),
  );
  const visibleGroups = useMemo(
    () => groupDiaryEntries(entries.slice(visibleStart, visibleEnd)),
    [entries, visibleStart, visibleEnd],
  );
  const visibleMonths = visibleGroups.map((group) => group.month).join(",");
  const currentMonth = groups.some((group) => group.month === activeMonth)
    ? activeMonth
    : (groups[0]?.month ?? "");

  useEffect(() => {
    setRange((current) =>
      current.scope !== scope || current.start >= entries.length
        ? { scope, start: 0, count: DIARY_BATCH_SIZE }
        : current,
    );
  }, [scope, entries.length]);
  const filtersActive = Object.values(filters).some(Boolean);
  const dateFormat = new Intl.DateTimeFormat(i18n.language, { dateStyle: "long" });
  const monthLabel = (month: string) =>
    new Intl.DateTimeFormat(i18n.language, { month: "long", year: "numeric" }).format(
      new Date(`${month}-01T00:00:00`),
    );
  const suggestions = diaryDaySuggestions(ws, draft.entry_date);
  const subtasks = diarySubtasks(ws.tasks);
  const suggestedSubtaskIds = new Set(suggestions.subtask_links.map(diarySubtaskKey));
  const subtaskGroups = subtasks.reduce<RecordPickerGroup[]>((groups, item) => {
    const row = {
      id: item.id,
      label: item.title,
      suggested: suggestedSubtaskIds.has(item.id),
    };
    const parent = groups.at(-1);
    if (parent?.id === item.link.task_id) parent.rows.push(row);
    else groups.push({ id: item.link.task_id, label: item.taskTitle, rows: [row] });
    return groups;
  }, []);
  const suggestionCount =
    suggestions.task_ids.length +
    suggestions.subtask_links.length +
    suggestions.offer_ids.length +
    suggestions.payment_ids.length;
  const tooManyLinks =
    draft.subtask_links.length > MAX_DIARY_LINKS ||
    Object.keys(DIARY_LINK_TABLES).some(
      (key) => draft[key as keyof typeof DIARY_LINK_TABLES].length > MAX_DIARY_LINKS,
    );
  const subtaskLabel = (item: (typeof subtasks)[number]) =>
    tr("diary.subtask_label", { task: item.taskTitle, title: item.title });
  const galleryImages = ws.diary_media.flatMap((media) =>
    gallery?.entryId === media.diary_entry_id &&
    media.mime_type?.startsWith("image/") &&
    media.storage_path
      ? [{ id: media.id, path: media.storage_path, name: media.name }]
      : [],
  );
  const openPhoto = (media: DiaryMedia, title: string) => {
    photoTrigger.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setGallery({ entryId: media.diary_entry_id, mediaId: media.id, title });
  };

  const jumpToEntry = (entry: DiaryEntry, focus = false) => {
    const index = entries.findIndex((item) => item.id === entry.id);
    if (index < 0) {
      toast.error(tr("diary.jump_failed"));
      return;
    }
    if (index < visibleStart || index >= visibleEnd)
      setRange({ scope, start: index, count: DIARY_BATCH_SIZE });
    setActiveMonth(entry.entry_date.slice(0, 7));
    setScrollTarget({ id: entry.id, focus });
  };

  useEffect(() => {
    if (!scrollTarget) return;
    const target = document.getElementById(`diary-entry-${scrollTarget.id}`);
    if (!target) {
      toast.error(tr("diary.jump_failed"));
      return;
    }
    target.scrollIntoView({ block: "start" });
    if (scrollTarget.focus) target.focus({ preventScroll: true });
  }, [scrollTarget]);

  useEffect(() => {
    let frame = 0;
    const updatePosition = () => {
      if (!chronicle.current?.getBoundingClientRect().height) return;
      const sections = chronicle.current?.querySelectorAll<HTMLElement>("[data-diary-month]");
      if (!sections?.length) return;
      const current =
        [...sections].find((section) => section.getBoundingClientRect().bottom > 112) ??
        sections[sections.length - 1]!;
      setActiveMonth(current.dataset["diaryMonth"]!);
    };
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(updatePosition);
    };
    updatePosition();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [visibleMonths, scope]);

  useEffect(() => {
    if (
      !loadMore.current ||
      visibleEnd >= entries.length ||
      typeof IntersectionObserver === "undefined"
    )
      return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting)
          setRange((current) =>
            current.scope === scope &&
            current.start === visibleStart &&
            Math.min(entries.length, current.start + current.count) === visibleEnd
              ? { scope, start: visibleStart, count: visibleEnd - visibleStart + DIARY_BATCH_SIZE }
              : current,
          );
      },
      { rootMargin: "400px" },
    );
    observer.observe(loadMore.current);
    return () => observer.disconnect();
  }, [entries.length, scope, visibleStart, visibleEnd]);

  const edit = (entry: DiaryEntry) => {
    setDraft(draftFromEntry(entry));
    setEditingId(entry.id);
    setWizardStep(null);
    setFormOpen(true);
  };

  const save = async () => {
    if (busy) return;
    const row = {
      ...draft,
      weather_snapshot: draft.weather_snapshot ? JSON.stringify(draft.weather_snapshot) : null,
      task_ids: draft.task_ids,
      event_ids: draft.event_ids,
      trade_ids: draft.trade_ids,
    };
    try {
      validateDiaryEntry(row);
    } catch (error) {
      toast.error(error instanceof Error ? tr(error.message) : tr("diary.save_failed"));
      return;
    }
    if (editingId) {
      try {
        await update.mutateAsync({ table: "diary_entries", id: editingId, patch: row });
        toast.success(tr("diary.saved"));
        if (wizardStep) setWizardStep("media");
      } catch {
        return;
      }
    } else {
      try {
        const result = await create.mutateAsync({ table: "diary_entries", row });
        if (!("id" in result) || typeof result.id !== "string") {
          toast.error(tr("diary.save_failed"));
          return;
        }
        setEditingId(result.id);
        setWizardStep("media");
        toast.success(tr("diary.saved"));
      } catch {
        return;
      }
    }
  };

  const confirmDelete = async () => {
    if (!deletion || busy) return;
    setDeleting(true);
    try {
      if (deletion.kind === "entry") {
        const entry = deletion.entry;
        for (const media of ws.diary_media.filter((item) => item.diary_entry_id === entry.id))
          await remove.mutateAsync({ table: "diary_media", id: media.id });
        await remove.mutateAsync({ table: "diary_entries", id: entry.id });
        if (editingId === entry.id) {
          setEditingId(null);
          setFormOpen(false);
        }
      } else {
        await remove.mutateAsync({ table: "diary_media", id: deletion.media.id });
      }
      setDeletion(null);
    } catch {
      return;
    } finally {
      setDeleting(false);
    }
  };

  const loadWeather = async () => {
    if (!projectId) return;
    setWeatherLoading(true);
    try {
      const weather = await getDiaryWeather({ data: { projectId, date: draft.entry_date } });
      if (!weather) {
        toast.error(tr("diary.weather_location_required"));
        return;
      }
      setDraft((current) => ({ ...current, weather_snapshot: weather }));
    } catch (error) {
      toast.error(error instanceof Error ? tr(error.message) : tr("diary.weather_unavailable"));
    } finally {
      setWeatherLoading(false);
    }
  };

  const uploadMedia = async (files: FileList | null) => {
    if (!editingId || !files) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        await diaryMediaUpload.mutateAsync({ file, diaryEntryId: editingId });
      }
    } catch {
      return;
    } finally {
      setUploading(false);
    }
  };

  const requestMediaDelete = (media: DiaryMedia) => {
    deleteTrigger.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setDeletion({ kind: "media", media });
  };

  const changeIds = (key: keyof typeof DIARY_LINK_TABLES, values: string[]) => {
    setDraft((current) => ({ ...current, [key]: values }));
  };

  const changeDate = (date: string) => {
    const suggested = diaryDaySuggestions(ws, date);
    setDraft((current) => ({
      ...current,
      entry_date: date,
      weather_snapshot: date === current.entry_date ? current.weather_snapshot : null,
      task_ids: !editingId
        ? refreshDiarySuggestions(current.task_ids, autoLinks.task_ids, suggested.task_ids)
        : current.task_ids,
      subtask_links: !editingId
        ? refreshDiarySuggestions(
            current.subtask_links,
            autoLinks.subtask_links,
            suggested.subtask_links,
          )
        : current.subtask_links,
      offer_ids: !editingId
        ? refreshDiarySuggestions(current.offer_ids, autoLinks.offer_ids, suggested.offer_ids)
        : current.offer_ids,
      payment_ids: !editingId
        ? refreshDiarySuggestions(current.payment_ids, autoLinks.payment_ids, suggested.payment_ids)
        : current.payment_ids,
    }));
    if (!editingId) setAutoLinks(suggested);
  };

  const exportPdf = async (filtered: boolean) => {
    if (!project || exporting) return;
    setExporting(true);
    try {
      const { downloadDiaryPdf } = await import("@/lib/diary-pdf");
      const omitted = await downloadDiaryPdf(
        ws,
        project,
        filtered ? entries : ws.diary_entries,
        i18n.language,
      );
      if (omitted.length) toast.warning(tr("diary.pdf_omitted", { names: omitted.join(", ") }));
    } catch (error) {
      toast.error(error instanceof Error ? tr(error.message) : tr("diary.pdf_failed"));
    } finally {
      setExporting(false);
    }
  };

  const mediaInputId = "diary-media-upload";
  const project = ws.projects.find((item) => item.id === projectId);
  const mediaForEntry = (entryId: string) =>
    ws.diary_media.filter((media) => media.diary_entry_id === entryId);
  const detailEntry = detailEntryId
    ? (ws.diary_entries.find((entry) => entry.id === detailEntryId) ?? null)
    : null;
  const renderEntryDetails = (entry: DiaryEntry) => {
    const weather = parseDiaryWeather(entry.weather_snapshot);
    const taskIds = parseDiaryIds(entry.task_ids);
    const selectedSubtasks = linkedDiarySubtasks(entry, ws.tasks);
    const eventIds = parseDiaryIds(entry.event_ids);
    const tradeIds = parseDiaryIds(entry.trade_ids);
    const offerIds = parseDiaryIds(entry.offer_ids);
    const paymentIds = parseDiaryIds(entry.payment_ids);
    const media = mediaForEntry(entry.id);

    return (
      <div className="grid gap-5">
        <div className="grid gap-4 md:grid-cols-2">
          {entry.work_done && <EntryText label={tr("diary.work_done")} text={entry.work_done} />}
          {entry.progress && <EntryText label={tr("diary.progress")} text={entry.progress} />}
          {entry.issues && <EntryText label={tr("diary.issues")} text={entry.issues} />}
          {weather && <WeatherSummary weather={weather} />}
        </div>
        {offerIds.length > 0 && (
          <section className="grid gap-2">
            <h4 className="text-sm font-medium">{tr("diary.offers")}</h4>
            <ul className="grid gap-2 text-sm">
              {ws.offers
                .filter((offer) => offerIds.includes(offer.id))
                .map((offer) => (
                  <li key={offer.id}>
                    <Link
                      to="/angebote"
                      search={{ eintrag: offer.id }}
                      className="font-medium underline underline-offset-4"
                    >
                      {offer.title || offer.contractor}
                    </Link>
                    <p className="mt-1 text-muted-foreground">
                      {tr("diary.offer_on", { date: fmtDate(offer.offer_date) })} ·{" "}
                      {offer.contractor} · {eur(offer.amount, true)}
                    </p>
                  </li>
                ))}
            </ul>
          </section>
        )}
        {paymentIds.length > 0 && (
          <section className="grid gap-2">
            <h4 className="text-sm font-medium">{tr("diary.payments")}</h4>
            <ul className="grid gap-2 text-sm">
              {ws.expenses
                .filter((expense) => paymentIds.includes(expense.id))
                .map((expense) => (
                  <li key={expense.id}>
                    <Link
                      to="/ausgaben"
                      search={{ eintrag: expense.id }}
                      className="font-medium underline underline-offset-4"
                    >
                      {expense.title}
                    </Link>
                    <p className="mt-1 text-muted-foreground">
                      {tr("diary.payment_on", { date: fmtDate(expense.payment_date) })}
                      {expense.vendor ? ` · ${expense.vendor}` : ""} · {eur(expense.amount, true)}
                    </p>
                  </li>
                ))}
            </ul>
          </section>
        )}
        {(taskIds.length > 0 ||
          selectedSubtasks.length > 0 ||
          eventIds.length > 0 ||
          tradeIds.length > 0) && (
          <div className="flex flex-wrap gap-2 text-xs">
            {taskIds.map((id) => {
              const task = ws.tasks.find((item) => item.id === id);
              return task ? (
                <span key={id} className="rounded-full bg-muted px-2 py-1">
                  {task.title}
                </span>
              ) : null;
            })}
            {selectedSubtasks.map((item) => (
              <span key={item.id} className="rounded-full bg-muted px-2 py-1">
                {subtaskLabel(item)}
              </span>
            ))}
            {eventIds.map((id) => {
              const event = ws.events.find((item) => item.id === id);
              return event ? (
                <span key={id} className="rounded-full bg-muted px-2 py-1">
                  {event.title}
                </span>
              ) : null;
            })}
            {tradeIds.map((id) => {
              const trade = ws.trades.find((item) => item.id === id);
              return trade ? (
                <span key={id} className="rounded-full bg-muted px-2 py-1">
                  {trade.name}
                </span>
              ) : null;
            })}
          </div>
        )}
        {media.length > 0 && (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {media.map((item) => (
              <DiaryMediaItem
                key={item.id}
                media={item}
                onOpen={() => openPhoto(item, entry.title)}
                removing={busy}
                onRemove={() => requestMediaDelete(item)}
              />
            ))}
          </ul>
        )}
      </div>
    );
  };

  if (isLoading) return <p className="text-sm text-muted-foreground">{tr("shared.loading")}</p>;

  return (
    <TooltipProvider>
      <div className="flex items-start gap-1 sm:gap-5">
        <div className="min-w-0 flex-1 [&>div:first-child]:mb-4">
          <PageHeader
            title={tr("diary.title")}
            subtitle={tr("diary.subtitle")}
            actions={
              <>
                <Button
                  id="diary-new-entry"
                  size="sm"
                  disabled={busy}
                  onClick={(event) => {
                    editorTrigger.current = event.currentTarget;
                    const next = emptyDraft();
                    const suggested = diaryDaySuggestions(ws, next.entry_date);
                    setDraft({ ...next, ...suggested });
                    setAutoLinks(suggested);
                    setEditingId(null);
                    setWizardStep("report");
                    setFormOpen(true);
                  }}
                >
                  <Plus data-icon="inline-start" />
                  {tr("diary.new_entry")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={exporting || !ws.diary_entries.length}
                  onClick={() => void exportPdf(false)}
                  aria-label={exporting ? tr("diary.pdf_exporting") : tr("diary.pdf_export")}
                >
                  <Download data-icon="inline-start" />
                  <span className="hidden sm:inline">
                    {exporting ? tr("diary.pdf_exporting") : tr("diary.pdf_export")}
                  </span>
                  <span className="sm:hidden">
                    {exporting ? tr("shared.loading") : tr("diary.pdf_short")}
                  </span>
                </Button>
              </>
            }
          />
          <Dialog
            open={formOpen}
            onOpenChange={(open) => {
              if (!busy) setFormOpen(open);
            }}
          >
            <DialogContent
              className="flex max-h-[calc(100dvh-2rem)] max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl"
              closeLabel={tr("diary.close_form")}
              closeDisabled={busy}
              onInteractOutside={(event) => event.preventDefault()}
              onOpenAutoFocus={(event) => {
                event.preventDefault();
                if (wizardStep) stepHeading.current?.focus();
                else editorHeading.current?.focus();
              }}
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                editorTrigger.current?.focus();
              }}
            >
              <DialogHeader className="shrink-0 border-b px-5 py-5 pr-12 text-left">
                <DialogTitle ref={editorHeading} tabIndex={-1}>
                  {wizardStep ? tr("diary.new_entry") : tr("diary.edit_entry")}
                </DialogTitle>
                <DialogDescription>{tr("diary.editor_help")}</DialogDescription>
              </DialogHeader>
              <div className="min-h-0 overflow-y-auto p-5">
                {wizardStep && (
                  <ol className="mb-4 flex flex-wrap gap-2 text-sm">
                    {(["report", "media"] as const).map((step, index) => (
                      <li
                        key={step}
                        aria-current={wizardStep === step ? "step" : undefined}
                        className={cn(
                          "rounded-md px-3 py-2",
                          wizardStep === step ? "bg-muted font-medium" : "text-muted-foreground",
                        )}
                      >
                        {index + 1}. {tr(`diary.step_${step}`)}
                      </li>
                    ))}
                  </ol>
                )}
                {wizardStep && (
                  <h3 ref={stepHeading} tabIndex={-1} className="mb-3 font-medium">
                    {tr(`diary.step_${wizardStep}`)}
                  </h3>
                )}
                <form
                  id="diary-entry-form"
                  className="grid gap-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (wizardStep !== "media") void save();
                  }}
                >
                  {wizardStep !== "media" && (
                    <>
                      <div className="grid w-full max-w-48 gap-1.5">
                        <Label htmlFor="diary-entry-date">{tr("diary.entry_date")}</Label>
                        <Input
                          id="diary-entry-date"
                          type="date"
                          required
                          value={draft.entry_date}
                          onChange={(event) => changeDate(event.target.value)}
                        />
                      </div>
                      <div className="grid gap-1.5">
                        <Label htmlFor="diary-entry-title">{tr("diary.entry_title")}</Label>
                        <Input
                          id="diary-entry-title"
                          maxLength={160}
                          required
                          value={draft.title}
                          onChange={(event) =>
                            setDraft((current) => ({ ...current, title: event.target.value }))
                          }
                        />
                      </div>
                      <div className="grid gap-1.5">
                        <Label htmlFor="diary-work-done">{tr("diary.work_done")}</Label>
                        <Textarea
                          id="diary-work-done"
                          rows={3}
                          maxLength={10_000}
                          value={draft.work_done}
                          onChange={(event) =>
                            setDraft((current) => ({ ...current, work_done: event.target.value }))
                          }
                        />
                      </div>
                      <div className="grid gap-1.5">
                        <Label htmlFor="diary-progress">{tr("diary.progress")}</Label>
                        <Textarea
                          id="diary-progress"
                          rows={2}
                          maxLength={10_000}
                          value={draft.progress}
                          onChange={(event) =>
                            setDraft((current) => ({ ...current, progress: event.target.value }))
                          }
                        />
                      </div>
                      <div className="grid gap-1.5">
                        <Label htmlFor="diary-issues">{tr("diary.issues")}</Label>
                        <Textarea
                          id="diary-issues"
                          rows={2}
                          maxLength={10_000}
                          value={draft.issues}
                          onChange={(event) =>
                            setDraft((current) => ({ ...current, issues: event.target.value }))
                          }
                        />
                      </div>
                      <Alert role="status">
                        <CheckCheck className="size-4" />
                        <AlertDescription>
                          <p>
                            {tr("diary.day_suggestions", {
                              tasks: suggestions.task_ids.length,
                              subtasks: suggestions.subtask_links.length,
                              offers: suggestions.offer_ids.length,
                              payments: suggestions.payment_ids.length,
                            })}
                          </p>
                          <p className="mt-1 text-muted-foreground">
                            {tr("diary.day_suggestions_help")}
                          </p>
                          {editingId && suggestionCount > 0 && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="mt-2"
                              onClick={() =>
                                setDraft((current) => ({
                                  ...current,
                                  task_ids: [
                                    ...new Set([...current.task_ids, ...suggestions.task_ids]),
                                  ],
                                  subtask_links: refreshDiarySuggestions(
                                    current.subtask_links,
                                    [],
                                    suggestions.subtask_links,
                                  ),
                                  offer_ids: [
                                    ...new Set([...current.offer_ids, ...suggestions.offer_ids]),
                                  ],
                                  payment_ids: [
                                    ...new Set([
                                      ...current.payment_ids,
                                      ...suggestions.payment_ids,
                                    ]),
                                  ],
                                }))
                              }
                            >
                              {tr("diary.apply_day_suggestions")}
                            </Button>
                          )}
                        </AlertDescription>
                      </Alert>
                      {tooManyLinks && (
                        <Alert variant="destructive">
                          <AlertDescription>{tr("diary.too_many_links")}</AlertDescription>
                        </Alert>
                      )}
                      <section className="grid items-start gap-3 md:grid-cols-3">
                        <RecordPicker
                          id="diary-task-links"
                          label={tr("diary.tasks")}
                          values={draft.task_ids}
                          rows={ws.tasks.map((item) => ({
                            id: item.id,
                            label: item.title,
                            suggested: suggestions.task_ids.includes(item.id),
                          }))}
                          onChange={(values) => changeIds("task_ids", values)}
                        />
                        <RecordPicker
                          id="diary-subtask-links"
                          label={tr("diary.subtasks")}
                          description={tr("diary.subtasks_help")}
                          values={draft.subtask_links.map(diarySubtaskKey)}
                          groups={subtaskGroups}
                          onChange={(values) =>
                            setDraft((current) => ({
                              ...current,
                              subtask_links: subtasks
                                .filter((item) => values.includes(item.id))
                                .map((item) => item.link),
                            }))
                          }
                        />
                        <RecordPicker
                          id="diary-offer-links"
                          label={tr("diary.offers")}
                          values={draft.offer_ids}
                          rows={ws.offers.map((item) => ({
                            id: item.id,
                            label: `${item.title || item.contractor} · ${fmtDate(item.offer_date)} · ${eur(item.amount, true)}`,
                            suggested: suggestions.offer_ids.includes(item.id),
                          }))}
                          onChange={(values) => changeIds("offer_ids", values)}
                        />
                        <RecordPicker
                          id="diary-payment-links"
                          label={tr("diary.payments")}
                          values={draft.payment_ids}
                          rows={ws.expenses
                            .filter(
                              (item) =>
                                normalizeLegacyExpense(item).status === "bezahlt" ||
                                draft.payment_ids.includes(item.id),
                            )
                            .map((item) => ({
                              id: item.id,
                              label: `${item.title} · ${fmtDate(item.payment_date)} · ${eur(item.amount, true)}`,
                              suggested: suggestions.payment_ids.includes(item.id),
                            }))}
                          onChange={(values) => changeIds("payment_ids", values)}
                        />
                        <RecordPicker
                          id="diary-event-links"
                          label={tr("diary.events")}
                          values={draft.event_ids}
                          rows={ws.events.map((item) => ({
                            id: item.id,
                            label: `${item.event_date} · ${item.title}`,
                          }))}
                          onChange={(values) => changeIds("event_ids", values)}
                        />
                        <RecordPicker
                          id="diary-trade-links"
                          label={tr("diary.trades")}
                          values={draft.trade_ids}
                          rows={ws.trades.map((item) => ({ id: item.id, label: item.name }))}
                          onChange={(values) => changeIds("trade_ids", values)}
                        />
                      </section>
                      <section className="grid gap-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <Label>{tr("diary.weather")}</Label>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={weatherLoading || !projectId}
                            onClick={() => void loadWeather()}
                          >
                            <CloudSun data-icon="inline-start" />
                            {weatherLoading
                              ? tr("diary.weather_fetching")
                              : tr("diary.weather_load")}
                          </Button>
                        </div>
                        {draft.weather_snapshot && (
                          <WeatherSummary weather={draft.weather_snapshot} />
                        )}
                        {!draft.weather_snapshot &&
                          (project?.weather_latitude == null ||
                          project.weather_longitude == null ? (
                            <Link
                              to="/einstellungen"
                              className="text-xs text-muted-foreground underline"
                            >
                              {tr("diary.weather_location_required")}
                            </Link>
                          ) : (
                            <p className="text-xs text-muted-foreground">
                              {tr("diary.weather_no_data")}
                            </p>
                          ))}
                      </section>
                    </>
                  )}
                  {wizardStep === "media" && (
                    <Alert role="status">
                      <AlertDescription>{tr("diary.report_saved")}</AlertDescription>
                    </Alert>
                  )}
                  {editingId && (wizardStep === null || wizardStep === "media") && (
                    <section className="grid gap-3">
                      <div>
                        <Label htmlFor={mediaInputId}>{tr("diary.media")}</Label>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {tr("diary.media_help", { max: MAX_DIARY_MEDIA_MB })}
                        </p>
                      </div>
                      <Input
                        id={mediaInputId}
                        type="file"
                        multiple
                        accept="image/jpeg,image/png,image/webp,image/gif,image/avif,image/heic,image/heif,video/mp4,video/webm,video/quicktime"
                        disabled={busy}
                        onChange={(event) => {
                          void uploadMedia(event.currentTarget.files);
                          event.currentTarget.value = "";
                        }}
                      />
                      {uploading && (
                        <p role="status" className="text-sm text-muted-foreground">
                          {tr("diary.media_uploading")}
                        </p>
                      )}
                      {mediaForEntry(editingId).length > 0 && (
                        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                          {mediaForEntry(editingId).map((media) => (
                            <DiaryMediaItem
                              key={media.id}
                              media={media}
                              onOpen={() => openPhoto(media, draft.title)}
                              removing={busy}
                              onRemove={() => requestMediaDelete(media)}
                            />
                          ))}
                        </ul>
                      )}
                    </section>
                  )}
                </form>
              </div>
              <DialogFooter className="shrink-0 justify-end border-t px-5 py-4">
                {wizardStep === "media" ? (
                  <>
                    <Button
                      key="back-to-report"
                      type="button"
                      variant="outline"
                      disabled={busy}
                      onClick={() => setWizardStep("report")}
                    >
                      {tr("diary.back_to_report")}
                    </Button>
                    <Button type="button" disabled={busy} onClick={() => setFormOpen(false)}>
                      {tr(
                        editingId && mediaForEntry(editingId).length === 0
                          ? "diary.finish_without_media"
                          : "diary.finish",
                      )}
                    </Button>
                  </>
                ) : (
                  <Button
                    key="save-report"
                    type="submit"
                    form="diary-entry-form"
                    disabled={busy || tooManyLinks}
                  >
                    {wizardStep ? tr("diary.save_and_continue") : tr("diary.update_entry")}
                  </Button>
                )}
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog
            open={detailEntry !== null}
            onOpenChange={(open) => {
              if (!open) setDetailEntryId(null);
            }}
          >
            {detailEntry && (
              <DialogContent
                className="flex h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-3xl flex-col gap-0 overflow-hidden p-0 sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:w-[calc(100vw-2rem)]"
                onCloseAutoFocus={(event) => {
                  event.preventDefault();
                  if (detailTrigger.current?.isConnected) detailTrigger.current.focus();
                  else document.getElementById("diary-new-entry")?.focus();
                }}
              >
                <DialogHeader className="shrink-0 border-b px-4 py-4 pr-12 text-left sm:px-6 sm:py-5">
                  <DialogTitle className="leading-snug">{detailEntry.title}</DialogTitle>
                  <DialogDescription>
                    {dateFormat.format(new Date(`${detailEntry.entry_date}T00:00:00`))}
                  </DialogDescription>
                </DialogHeader>
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-6">
                  {renderEntryDetails(detailEntry)}
                </div>
              </DialogContent>
            )}
          </Dialog>
          <AlertDialog
            open={deletion !== null}
            onOpenChange={(open) => {
              if (!open && !deleting) setDeletion(null);
            }}
          >
            <AlertDialogContent
              className="max-w-[calc(100%-2rem)] sm:max-w-lg"
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                if (deleteTrigger.current?.isConnected) deleteTrigger.current.focus();
                else if (formOpen) editorHeading.current?.focus();
                else document.getElementById("diary-new-entry")?.focus();
              }}
            >
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {tr(
                    deletion?.kind === "media"
                      ? "diary.delete_media_title"
                      : "diary.delete_entry_title",
                  )}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {deletion?.kind === "media"
                    ? tr("diary.delete_media_description", { name: deletion.media.name })
                    : tr("diary.delete_entry_description", { title: deletion?.entry.title ?? "" })}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={deleting}>
                  {tr("entity_dialog.cancel")}
                </AlertDialogCancel>
                <AlertDialogAction
                  className={buttonVariants({ variant: "destructive" })}
                  disabled={deleting}
                  onClick={(event) => {
                    event.preventDefault();
                    void confirmDelete();
                  }}
                >
                  {tr(deleting ? "shared.loading" : "shared.delete")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          {ws.diary_entries.length > 0 && (
            <section
              aria-label={tr("diary.filters")}
              className="mb-6 grid gap-4 rounded-xl bg-card p-4 sm:p-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 font-semibold">
                  <BookOpen className="size-4" />
                  {tr("diary.chronicle")}
                </h2>
                <p role="status" className="text-sm text-muted-foreground">
                  {tr("diary.entry_count", {
                    count: entries.length,
                    total: ws.diary_entries.length,
                  })}
                </p>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3 lg:grid-cols-[minmax(0,2fr)_3fr]">
                <div className="grid gap-1.5 md:col-span-2 lg:col-span-1">
                  <Label htmlFor="diary-search">{tr("diary.search")}</Label>
                  <Input
                    id="diary-search"
                    type="search"
                    value={filters.search}
                    placeholder={tr("diary.search_placeholder")}
                    onChange={(event) => setFilters({ ...filters, search: event.target.value })}
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="md:hidden"
                  aria-expanded={filtersOpen}
                  aria-controls="diary-advanced-filters"
                  onClick={() => setFiltersOpen(!filtersOpen)}
                >
                  {tr("diary.more_filters")}
                  {(filters.from || filters.to || filters.tradeId) && (
                    <span aria-hidden="true">•</span>
                  )}
                </Button>
                <div
                  id="diary-advanced-filters"
                  className={cn(
                    "col-span-2 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:col-span-1",
                    !filtersOpen && "hidden md:grid",
                  )}
                >
                  <div className="grid gap-1.5">
                    <Label htmlFor="diary-from">{tr("diary.from")}</Label>
                    <Input
                      id="diary-from"
                      type="date"
                      value={filters.from}
                      max={filters.to || undefined}
                      onChange={(event) => setFilters({ ...filters, from: event.target.value })}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="diary-to">{tr("diary.to")}</Label>
                    <Input
                      id="diary-to"
                      type="date"
                      value={filters.to}
                      min={filters.from || undefined}
                      onChange={(event) => setFilters({ ...filters, to: event.target.value })}
                    />
                  </div>
                  <div className="col-span-2 grid gap-1.5 sm:col-span-1">
                    <Label htmlFor="diary-filter-trade">{tr("diary.filter_trade")}</Label>
                    <select
                      id="diary-filter-trade"
                      className="h-9 min-w-0 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      value={filters.tradeId}
                      onChange={(event) => setFilters({ ...filters, tradeId: event.target.value })}
                    >
                      <option value="">{tr("diary.all_trades")}</option>
                      {ws.trades.map((trade) => (
                        <option key={trade.id} value={trade.id}>
                          {trade.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
              {filtersActive && (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setFilters(EMPTY_DIARY_FILTERS)}
                  >
                    {tr("diary.reset_filters")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={exporting || entries.length === 0}
                    onClick={() => void exportPdf(true)}
                  >
                    <Download data-icon="inline-start" />
                    {tr("diary.pdf_filtered")}
                  </Button>
                </div>
              )}
            </section>
          )}
          {ws.diary_entries.length === 0 ? (
            <Empty>{tr("diary.empty")}</Empty>
          ) : entries.length === 0 ? (
            <Empty>{tr("diary.no_matches")}</Empty>
          ) : (
            <div ref={chronicle} className="grid min-w-0 flex-1 gap-7">
              <p role="status" className="text-xs tabular-nums text-muted-foreground">
                {tr("diary.displayed_range", {
                  from: visibleStart + 1,
                  to: visibleEnd,
                  total: entries.length,
                })}
              </p>
              {visibleStart > 0 && (
                <Button
                  variant="outline"
                  onClick={() => {
                    const start = Math.max(0, visibleStart - DIARY_BATCH_SIZE);
                    setRange({ scope, start, count: visibleEnd - start });
                    setScrollTarget({ id: entries[start]!.id, focus: true });
                  }}
                >
                  {tr("diary.load_newer")}
                </Button>
              )}
              {visibleGroups.map(({ month, entries: reports }) => (
                <section
                  key={month}
                  id={`diary-month-${month}`}
                  data-diary-month={month}
                  className="scroll-mt-24"
                >
                  <h2 className="mb-4 text-lg font-semibold">{monthLabel(month)}</h2>
                  <ol className="grid gap-4">
                    {reports.map((entry) => {
                      const taskIds = parseDiaryIds(entry.task_ids);
                      const offerIds = parseDiaryIds(entry.offer_ids);
                      const paymentIds = parseDiaryIds(entry.payment_ids);
                      const media = mediaForEntry(entry.id);
                      const linkedTrades = diaryEntryTrades(entry, ws);
                      return (
                        <li key={entry.id} className="min-w-0">
                          <article
                            className="min-w-0 cursor-pointer rounded-xl bg-card p-4 sm:p-5"
                            onClick={(event) => {
                              if (
                                event.target instanceof Element &&
                                event.target.closest("button, a, [role='button']")
                              ) {
                                return;
                              }
                              detailTrigger.current =
                                event.currentTarget.querySelector<HTMLButtonElement>(
                                  '[aria-haspopup="dialog"]',
                                );
                              setDetailEntryId(entry.id);
                            }}
                          >
                            <div className="mb-1 flex items-center justify-between gap-3">
                              <p className="text-xs font-medium tabular-nums text-muted-foreground">
                                <time dateTime={entry.entry_date}>
                                  {dateFormat.format(new Date(`${entry.entry_date}T00:00:00`))}
                                </time>
                              </p>
                              <DropdownMenu
                                onOpenChange={(open) => {
                                  if (open) actionOpensDialog.current = false;
                                }}
                              >
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    disabled={busy}
                                    aria-label={tr("diary.entry_actions", { title: entry.title })}
                                    onPointerDown={(event) => {
                                      editorTrigger.current = event.currentTarget;
                                    }}
                                    onKeyDown={(event) => {
                                      editorTrigger.current = event.currentTarget;
                                    }}
                                  >
                                    <MoreHorizontal aria-hidden="true" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent
                                  align="end"
                                  onClick={(event) => event.stopPropagation()}
                                  onCloseAutoFocus={(event) => {
                                    if (actionOpensDialog.current) event.preventDefault();
                                  }}
                                >
                                  <DropdownMenuGroup>
                                    <DropdownMenuItem
                                      className="min-h-11"
                                      onSelect={() => {
                                        actionOpensDialog.current = true;
                                        edit(entry);
                                      }}
                                    >
                                      <Pencil aria-hidden="true" />
                                      {tr("diary.edit_entry")}
                                    </DropdownMenuItem>
                                  </DropdownMenuGroup>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuGroup>
                                    <DropdownMenuItem
                                      className="min-h-11 text-destructive focus:text-destructive"
                                      onSelect={() => {
                                        actionOpensDialog.current = true;
                                        deleteTrigger.current = editorTrigger.current;
                                        setDeletion({ kind: "entry", entry });
                                      }}
                                    >
                                      <Trash2 aria-hidden="true" />
                                      {tr("diary.delete_entry")}
                                    </DropdownMenuItem>
                                  </DropdownMenuGroup>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                            <h3 className="text-base font-semibold">
                              <button
                                id={`diary-entry-${entry.id}`}
                                type="button"
                                className="flex w-full scroll-mt-28 items-start justify-between gap-3 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                aria-haspopup="dialog"
                                onClick={(event) => {
                                  detailTrigger.current = event.currentTarget;
                                  setDetailEntryId(entry.id);
                                }}
                              >
                                {entry.title}
                                <ChevronRight className="mt-0.5 size-4 shrink-0" />
                              </button>
                            </h3>
                            {(entry.work_done || entry.progress) && (
                              <p className="mt-2 line-clamp-2 max-w-prose text-sm text-muted-foreground">
                                {entry.work_done || entry.progress}
                              </p>
                            )}
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              {ws.trades
                                .filter((trade) => linkedTrades.has(trade.id))
                                .map((trade) => (
                                  <Badge key={trade.id} variant="secondary">
                                    {trade.name}
                                  </Badge>
                                ))}
                              {taskIds.length > 0 && (
                                <span className="text-xs text-muted-foreground">
                                  {tr("diary.linked_tasks", { count: taskIds.length })}
                                </span>
                              )}
                              {offerIds.length + paymentIds.length > 0 && (
                                <span className="text-xs text-muted-foreground">
                                  {tr("diary.financial_count", {
                                    count: offerIds.length + paymentIds.length,
                                  })}
                                </span>
                              )}
                              {media.length > 0 && (
                                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                  <ImageIcon className="size-3.5" />
                                  {tr("diary.media_count", { count: media.length })}
                                </span>
                              )}
                              {entry.issues && (
                                <Badge variant="outline">{tr("diary.has_issues")}</Badge>
                              )}
                            </div>
                          </article>
                        </li>
                      );
                    })}
                  </ol>
                </section>
              ))}
              {visibleEnd < entries.length && (
                <div ref={loadMore}>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => {
                      setRange({
                        scope,
                        start: visibleStart,
                        count: visibleEnd - visibleStart + DIARY_BATCH_SIZE,
                      });
                      setScrollTarget({ id: entries[visibleEnd]!.id, focus: true });
                    }}
                  >
                    {tr("diary.load_older")}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
        {entries.length > 0 && (
          <DiaryTimelineNav
            key={scope}
            months={groups}
            activeMonth={currentMonth}
            onMonth={(month) =>
              jumpToEntry(groups.find((group) => group.month === month)!.entries[0]!)
            }
            onDate={(date) => {
              try {
                const entry = nearestDiaryEntry(entries, date);
                if (!entry) {
                  toast.error(tr("diary.no_matches"));
                  return;
                }
                jumpToEntry(entry, true);
                if (entry.entry_date !== date)
                  toast.success(tr("diary.jumped_to", { date: fmtDate(entry.entry_date) }));
              } catch (error) {
                toast.error(error instanceof Error ? tr(error.message) : tr("diary.jump_failed"));
              }
            }}
          />
        )}
      </div>
      {gallery && galleryImages.length > 0 && (
        <ImageGallery
          key={gallery.mediaId}
          images={galleryImages}
          title={gallery.title}
          startIndex={Math.max(
            0,
            galleryImages.findIndex((image) => image.id === gallery.mediaId),
          )}
          open
          onOpenChange={(open) => {
            if (!open) setGallery(null);
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            photoTrigger.current?.focus();
          }}
        />
      )}
    </TooltipProvider>
  );
}

type RecordPickerRow = { id: string; label: string; suggested?: boolean };
type RecordPickerGroup = { id: string; label: string; rows: RecordPickerRow[] };

function RecordPicker({
  id,
  label,
  description,
  values,
  rows = [],
  groups,
  onChange,
}: {
  id: string;
  label: string;
  description?: string;
  values: string[];
  rows?: RecordPickerRow[];
  groups?: RecordPickerGroup[];
  onChange: (values: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const sortSuggestions = (left: RecordPickerRow, right: RecordPickerRow) =>
    Number(!!right.suggested) - Number(!!left.suggested);
  const visibleRows = rows
    .filter((row) => row.label.toLocaleLowerCase().includes(normalizedQuery))
    .sort(sortSuggestions);
  const visibleGroups = groups?.flatMap((group) => {
    const groupRows = group.rows
      .filter((row) => `${group.label} ${row.label}`.toLocaleLowerCase().includes(normalizedQuery))
      .sort(sortSuggestions);
    return groupRows.length ? [{ ...group, rows: groupRows }] : [];
  });
  const hasRows = groups ? groups.some((group) => group.rows.length > 0) : rows.length > 0;
  const renderRow = (row: RecordPickerRow, groupLabel?: string) => (
    <label
      key={row.id}
      className="flex cursor-pointer items-start gap-2 rounded-md p-2 text-sm hover:bg-muted"
    >
      <Checkbox
        className="mt-0.5"
        aria-label={
          groupLabel ? tr("diary.subtask_label", { task: groupLabel, title: row.label }) : undefined
        }
        checked={values.includes(row.id)}
        disabled={!values.includes(row.id) && values.length >= MAX_DIARY_LINKS}
        onCheckedChange={(checked) =>
          onChange(checked ? [...values, row.id] : values.filter((value) => value !== row.id))
        }
      />
      <span className="min-w-0">
        {row.label}
        {row.suggested && (
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {tr("diary.matches_day")}
          </span>
        )}
      </span>
    </label>
  );
  return (
    <details className="min-w-0 rounded-lg border p-3">
      <summary className="cursor-pointer rounded-sm text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {label} <span className="ml-1 text-muted-foreground">({values.length})</span>
      </summary>
      {description && <p className="mt-2 text-xs text-muted-foreground">{description}</p>}
      {values.length >= MAX_DIARY_LINKS && (
        <p className="mt-2 text-xs text-muted-foreground">{tr("diary.too_many_links")}</p>
      )}
      <div className="mt-3 grid gap-2">
        <Label className="sr-only" htmlFor={`${id}-search`}>
          {tr("diary.search_links", { label })}
        </Label>
        <Input
          id={`${id}-search`}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={tr("diary.search")}
        />
        {groups ? (
          <div className="grid max-h-48 gap-3 overflow-y-auto">
            {visibleGroups?.map((group) => (
              <fieldset key={group.id} className="grid gap-1 border-l-2 border-border pl-3">
                <legend className="px-1 text-sm font-medium">{group.label}</legend>
                {group.rows.map((row) => renderRow(row, group.label))}
              </fieldset>
            ))}
            {!visibleGroups?.length && (
              <p className="py-2 text-xs text-muted-foreground">
                {hasRows ? tr("diary.no_links") : tr("diary.no_subtasks")}
              </p>
            )}
          </div>
        ) : (
          <fieldset className="grid max-h-48 gap-1 overflow-y-auto">
            <legend className="sr-only">{label}</legend>
            {visibleRows.map((row) => renderRow(row))}
            {!visibleRows.length && (
              <p className="py-2 text-xs text-muted-foreground">{tr("diary.no_links")}</p>
            )}
          </fieldset>
        )}
      </div>
    </details>
  );
}

function EntryText({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <h3 className="text-sm font-medium">{label}</h3>
      <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{text}</p>
    </div>
  );
}
