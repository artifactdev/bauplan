import { tr } from "@/i18n";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Camera,
  Check,
  ImagePlus,
  Loader2,
  Maximize,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Trash2,
} from "lucide-react";
import type { Raster } from "@/lib/doc-scan/cv-ops";
import {
  DETECT_SIDE,
  MAX_SCAN_PAGES,
  MAX_SOURCE_PIXELS,
  MAX_SOURCE_SIDE,
  SCAN_FILTERS,
  fullQuad,
  moveCorner,
  nextRotation,
  type Quad,
  type Rotation,
  type ScanFilter,
} from "@/lib/doc-scan/geometry";
import { decodeImage, encodeJpeg, grabVideoFrame } from "@/lib/doc-scan/image";
import { createScanFile, scanTimestamp } from "@/lib/doc-scan/pdf";
import { detectQuad, disposeScanner, processScan, warmUpScanner } from "@/lib/doc-scan/scan-engine";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from "@/lib/limits";


type Rendered = { blob: Blob; url: string; width: number; height: number };
export type ScanPage = {
  id: string;
  /** Downscaled original photo (JPEG) – kept instead of raw pixels to save memory. */
  source: Blob;
  sourceUrl: string;
  width: number;
  height: number;
  quad: Quad;
  detected: boolean;
  rotation: Rotation;
  filter: ScanFilter;
  result: Rendered;
};

type Draft = { page: ScanPage; replace: number | null; engineFailed?: boolean };
type Step = { kind: "capture"; replace: number | null } | { kind: "edit" } | { kind: "review" };

function releasePage(page: ScanPage | undefined) {
  if (!page) return;
  URL.revokeObjectURL(page.sourceUrl);
  URL.revokeObjectURL(page.result.url);
}

/** Revokes the object URLs of `page` that `keep` does not use (edited copies share them). */
function releaseUnshared(page: ScanPage | undefined, keep: ScanPage | undefined) {
  if (!page) return;
  if (page.sourceUrl !== keep?.sourceUrl) URL.revokeObjectURL(page.sourceUrl);
  if (page.result.url !== keep?.result.url) URL.revokeObjectURL(page.result.url);
}

async function render(page: Omit<ScanPage, "result">, pixels?: Raster): Promise<Rendered> {
  const image = pixels ?? (await decodeImage(page.source, MAX_SOURCE_SIDE, MAX_SOURCE_PIXELS));
  const out = await processScan(image, {
    quad: page.quad,
    rotation: page.rotation,
    filter: page.filter,
  });
  const blob = await encodeJpeg(out, page.filter === "bw" ? 0.8 : 0.85);
  return { blob, url: URL.createObjectURL(blob), width: out.width, height: out.height };
}

/** Builds a page from pixels: stores the original, detects the document and renders the crop. */
async function createPage(pixels: Raster): Promise<{ page: ScanPage; engineFailed: boolean }> {
  const source = await encodeJpeg(pixels, 0.92);
  let quad: Quad | null = null;
  let engineFailed = false;
  try {
    quad = await detectQuad(pixels);
  } catch {
    engineFailed = true;
  }
  const base = {
    id: crypto.randomUUID(),
    source,
    sourceUrl: URL.createObjectURL(source),
    width: pixels.width,
    height: pixels.height,
    quad: quad ?? fullQuad(pixels.width, pixels.height),
    detected: !!quad,
    rotation: 0 as Rotation,
    filter: "color" as ScanFilter,
  };
  if (engineFailed) {
    // Without OpenCV the original photo is kept unprocessed.
    const result = {
      blob: source,
      url: URL.createObjectURL(source),
      width: pixels.width,
      height: pixels.height,
    };
    return { page: { ...base, result }, engineFailed };
  }
  return { page: { ...base, result: await render(base, pixels) }, engineFailed };
}

export type DocumentScannerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Receives the finished multi-page PDF; the caller stores it via the regular upload flow. */
  onComplete: (file: File) => void | Promise<void>;
};

/** Camera/document scanner: capture → detect & crop → review → multi-page PDF. */
export function DocumentScanner(props: DocumentScannerProps) {
  // Mounted only while open, so camera, worker and image memory are released on close.
  return props.open ? <ScannerDialog {...props} /> : null;
}

function ScannerDialog({ onOpenChange, onComplete }: DocumentScannerProps) {
  const [pages, setPages] = useState<ScanPage[]>([]);
  const [step, setStep] = useState<Step>({ kind: "capture", replace: null });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const draftRef = useRef(draft);
  draftRef.current = draft;

  useEffect(
    () => () => {
      const d = draftRef.current;
      if (d)
        releaseUnshared(
          d.page,
          pagesRef.current.find((p) => p.id === d.page.id),
        );
      pagesRef.current.forEach(releasePage);
      disposeScanner();
    },
    [],
  );

  const close = () => {
    if (
      (pagesRef.current.length || draftRef.current) &&
      !window.confirm(tr("scanner.discard_confirm"))
    )
      return;
    onOpenChange(false);
  };

  async function addPixels(images: Raster[], replace: number | null) {
    setBusy(tr("scanner.processing"));
    setError(null);
    try {
      const created: Draft[] = [];
      for (const pixels of images) {
        const { page, engineFailed } = await createPage(pixels);
        created.push({ page, replace: created.length ? null : replace, engineFailed });
      }
      if (created.length === 1) {
        setDraft(created[0]!);
        setStep({ kind: "edit" });
      } else if (created.length > 1) {
        setPages((list) => [...list, ...created.map((c) => c.page)].slice(0, MAX_SCAN_PAGES));
        setStep({ kind: "review" });
      }
    } catch {
      setError(tr("scanner.image_failed"));
    } finally {
      setBusy(null);
    }
  }

  async function importFiles(files: File[], replace: number | null) {
    const room = MAX_SCAN_PAGES - pagesRef.current.length + (replace === null ? 0 : 1);
    const images: Raster[] = [];
    setBusy(tr("scanner.processing"));
    try {
      for (const file of files.slice(0, Math.max(1, room)))
        images.push(await decodeImage(file, MAX_SOURCE_SIDE, MAX_SOURCE_PIXELS));
    } catch {
      setBusy(null);
      setError(tr("scanner.image_failed"));
      return;
    }
    await addPixels(images, replace);
  }

  function commitDraft(next: "capture" | "review") {
    const d = draftRef.current;
    if (!d) return;
    setPages((list) => {
      if (d.replace !== null && list[d.replace]) {
        const copy = [...list];
        releaseUnshared(copy[d.replace], d.page);
        copy[d.replace] = d.page;
        return copy;
      }
      return [...list, d.page];
    });
    setDraft(null);
    const count = pagesRef.current.length + (d.replace === null ? 1 : 0);
    setStep(
      next === "capture" && count < MAX_SCAN_PAGES
        ? { kind: "capture", replace: null }
        : { kind: "review" },
    );
  }

  function discardDraft(): Draft | null {
    const d = draftRef.current;
    if (d)
      releaseUnshared(
        d.page,
        pagesRef.current.find((p) => p.id === d.page.id),
      );
    setDraft(null);
    return d;
  }

  async function save() {
    const list = pagesRef.current;
    if (!list.length) return;
    setBusy(tr("scanner.saving"));
    setError(null);
    try {
      const images = await Promise.all(
        list.map(async (p) => ({
          jpeg: new Uint8Array(await p.result.blob.arrayBuffer()),
          width: p.result.width,
          height: p.result.height,
        })),
      );
      const file = await createScanFile(images, tr("scanner.file_name", { date: scanTimestamp() }));
      if (file.size > MAX_UPLOAD_BYTES) {
        setError(tr("scanner.too_large", { max: MAX_UPLOAD_MB }));
        return;
      }
      await onComplete(file);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : tr("scanner.save_failed"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent
        className="flex h-[100dvh] max-h-[100dvh] w-full max-w-none flex-col gap-3 p-3 sm:h-[92vh] sm:max-w-3xl sm:p-5"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="pr-8 text-left">
          <DialogTitle>{tr("scanner.scan_document")}</DialogTitle>
          <DialogDescription className="text-xs">{tr("scanner.description")}</DialogDescription>
        </DialogHeader>
        {error && (
          <Alert variant="destructive" role="alert">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="relative flex min-h-0 flex-1 flex-col">
          {step.kind === "capture" && (
            <CameraCapture
              busy={!!busy}
              pageCount={pages.length}
              onCapture={(pixels) => addPixels([pixels], step.replace)}
              onImport={(files) => importFiles(files, step.replace)}
              onCancel={pages.length ? () => setStep({ kind: "review" }) : close}
            />
          )}
          {step.kind === "edit" && draft && (
            <PageEditor
              key={draft.page.id}
              draft={draft}
              sharedUrl={pages.find((p) => p.id === draft.page.id)?.result.url}
              busy={!!busy}
              canAddMore={pages.length + (draft.replace === null ? 1 : 0) < MAX_SCAN_PAGES}
              onChange={(page) => setDraft((d) => (d ? { ...d, page } : d))}
              onRetake={() => {
                const d = discardDraft();
                setStep({ kind: "capture", replace: d?.replace ?? null });
              }}
              onAddPage={() => commitDraft("capture")}
              onDone={() => commitDraft("review")}
            />
          )}
          {step.kind === "review" && (
            <PageReview
              pages={pages}
              busy={!!busy}
              onMove={(from, to) =>
                setPages((list) => {
                  const copy = [...list];
                  const [moved] = copy.splice(from, 1);
                  copy.splice(to, 0, moved!);
                  return copy;
                })
              }
              onEdit={(index) => {
                setDraft({ page: pages[index]!, replace: index });
                setStep({ kind: "edit" });
              }}
              onRetake={(index) => setStep({ kind: "capture", replace: index })}
              onRemove={(index) =>
                setPages((list) => {
                  releasePage(list[index]);
                  const next = list.filter((_, i) => i !== index);
                  if (!next.length) setStep({ kind: "capture", replace: null });
                  return next;
                })
              }
              onAddPage={() => setStep({ kind: "capture", replace: null })}
              onSave={save}
            />
          )}
          {busy && (
            <div
              className="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-background/70 text-sm"
              role="status"
              aria-live="polite"
            >
              <Loader2 className="h-4 w-4 animate-spin" /> {busy}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

type CameraState = "starting" | "ready" | "denied" | "missing" | "unavailable" | "failed";

function cameraError(error: unknown): CameraState {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "missing";
  return "failed";
}

const CAMERA_MESSAGES: Partial<Record<CameraState, string>> = {
  denied: "scanner.camera_denied",
  missing: "scanner.camera_missing",
  unavailable: "scanner.camera_unavailable",
  failed: "scanner.camera_failed",
};

function CameraCapture({
  busy,
  pageCount,
  onCapture,
  onImport,
  onCancel,
}: {
  busy: boolean;
  pageCount: number;
  onCapture: (pixels: Raster) => void;
  onImport: (files: File[]) => void;
  onCancel: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [camera, setCamera] = useState<CameraState>("starting");
  const [engineReady, setEngineReady] = useState(false);
  const [live, setLive] = useState<{ quad: Quad; width: number; height: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    warmUpScanner().then(
      () => !cancelled && setEngineReady(true),
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    const video = videoRef.current;
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamera("unavailable");
      return;
    }
    navigator.mediaDevices
      .getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      })
      .then(async (s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        if (!video) return;
        video.srcObject = s;
        await video.play().catch(() => {});
        setCamera("ready");
      })
      .catch((e) => !cancelled && setCamera(cameraError(e)));
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
      if (video) video.srcObject = null;
    };
  }, []);

  // Live contour preview on small frames; one detection at a time.
  useEffect(() => {
    if (camera !== "ready" || !engineReady) return;
    let stopped = false;
    let running = false;
    const timer = window.setInterval(async () => {
      const video = videoRef.current;
      if (running || stopped || !video || document.hidden) return;
      const frame = grabVideoFrame(video, DETECT_SIDE);
      if (!frame) return;
      running = true;
      try {
        const quad = await detectQuad(frame);
        if (!stopped) setLive(quad ? { quad, width: frame.width, height: frame.height } : null);
      } catch {
        if (!stopped) setLive(null);
      } finally {
        running = false;
      }
    }, 350);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [camera, engineReady]);

  const capture = () => {
    const video = videoRef.current;
    const frame = video && grabVideoFrame(video, MAX_SOURCE_SIDE, MAX_SOURCE_PIXELS);
    if (frame) onCapture(frame);
  };

  const message = CAMERA_MESSAGES[camera];
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg bg-black">
        <video
          ref={videoRef}
          className={camera === "ready" ? "h-full w-full object-contain" : "hidden"}
          playsInline
          muted
          autoPlay
          aria-label={tr("scanner.capture")}
        />
        {camera === "ready" && live && (
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full"
            viewBox={`0 0 ${live.width} ${live.height}`}
            preserveAspectRatio="xMidYMid meet"
            aria-hidden
          >
            <polygon
              points={live.quad.map((p) => `${p.x},${p.y}`).join(" ")}
              className="fill-primary/20 stroke-primary"
              strokeWidth={Math.max(live.width, live.height) / 160}
              strokeLinejoin="round"
            />
          </svg>
        )}
        {camera === "starting" && (
          <span className="flex items-center gap-2 text-sm text-white/80">
            <Loader2 className="h-4 w-4 animate-spin" /> {tr("scanner.starting_camera")}
          </span>
        )}
        {message && (
          <p className="max-w-sm p-6 text-center text-sm text-white/90" role="alert">
            {tr(message)}
          </p>
        )}
        {camera === "ready" && (
          <span
            className="absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-xs text-white"
            aria-live="polite"
          >
            {!engineReady
              ? tr("scanner.loading_engine")
              : live
                ? tr("scanner.document_detected")
                : tr("scanner.fit_document")}
          </span>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) onImport(files);
        }}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          {tr("scanner.cancel")}
        </Button>
        {pageCount > 0 && (
          <span className="text-xs text-muted-foreground">
            {tr("scanner.page_total", { count: pageCount })}
          </span>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
          >
            <ImagePlus className="h-4 w-4" /> {tr("scanner.import_image")}
          </Button>
          <Button type="button" onClick={capture} disabled={busy || camera !== "ready"}>
            <Camera className="h-4 w-4" /> {tr("scanner.capture")}
          </Button>
        </div>
      </div>
    </div>
  );
}

const CORNER_LABELS = [
  "scanner.corner_tl",
  "scanner.corner_tr",
  "scanner.corner_br",
  "scanner.corner_bl",
];

/** Original photo with a draggable, keyboard-adjustable document outline. */
export function QuadEditor({
  src,
  width,
  height,
  quad,
  onChange,
}: {
  src: string;
  width: number;
  height: number;
  quad: Quad;
  onChange: (quad: Quad) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const size = Math.max(width, height);

  const toImage = (e: PointerEvent) => {
    const svg = svgRef.current;
    const matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return null;
    const point = new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix.inverse());
    return { x: point.x, y: point.y };
  };

  const onKey = (index: number) => (e: KeyboardEvent) => {
    const step = (e.shiftKey ? 0.05 : 0.005) * size;
    const delta = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }[e.key];
    if (!delta) return;
    e.preventDefault();
    const p = quad[index]!;
    onChange(moveCorner(quad, index, { x: p.x + delta[0]!, y: p.y + delta[1]! }, width, height));
  };

  return (
    <svg
      ref={svgRef}
      className="h-full w-full touch-none select-none"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      onPointerMove={(e) => {
        if (dragging === null) return;
        const p = toImage(e);
        if (p) onChange(moveCorner(quad, dragging, p, width, height));
      }}
      onPointerUp={() => setDragging(null)}
      onPointerCancel={() => setDragging(null)}
    >
      <image href={src} x={0} y={0} width={width} height={height} />
      <polygon
        points={quad.map((p) => `${p.x},${p.y}`).join(" ")}
        className="fill-primary/15 stroke-primary"
        strokeWidth={size / 250}
        strokeLinejoin="round"
      />
      {quad.map((p, index) => (
        <g
          key={index}
          role="button"
          tabIndex={0}
          aria-label={`${tr(CORNER_LABELS[index]!)} (${Math.round((p.x / width) * 100)} %, ${Math.round((p.y / height) * 100)} %)`}
          className="cursor-grab outline-none focus-visible:[&>circle:last-child]:stroke-ring"
          onKeyDown={onKey(index)}
          onPointerDown={(e) => {
            e.preventDefault();
            (e.currentTarget as Element).closest("svg")?.setPointerCapture(e.pointerId);
            setDragging(index);
          }}
        >
          <circle cx={p.x} cy={p.y} r={size / 28} className="fill-transparent" />
          <circle
            cx={p.x}
            cy={p.y}
            r={size / 70}
            className="fill-background/80 stroke-primary"
            strokeWidth={size / 220}
          />
        </g>
      ))}
    </svg>
  );
}

function PageEditor({
  draft,
  sharedUrl,
  busy,
  canAddMore,
  onChange,
  onRetake,
  onAddPage,
  onDone,
}: {
  draft: Draft;
  /** Result URL still displayed in the page list (must not be revoked while editing). */
  sharedUrl?: string | undefined;
  busy: boolean;
  canAddMore: boolean;
  onChange: (page: ScanPage) => void;
  onRetake: () => void;
  onAddPage: () => void;
  onDone: () => void;
}) {
  const { page, engineFailed } = draft;
  const [view, setView] = useState<"result" | "original">(
    page.detected || engineFailed ? "result" : "original",
  );
  const [rendering, setRendering] = useState(false);
  const [settings, setSettings] = useState({
    quad: page.quad,
    rotation: page.rotation,
    filter: page.filter,
  });
  const latest = useRef(page);
  latest.current = page;

  // Re-render the crop shortly after the corners, rotation or filter change.
  useEffect(() => {
    const current = latest.current;
    if (
      engineFailed ||
      (settings.quad === current.quad &&
        settings.rotation === current.rotation &&
        settings.filter === current.filter)
    )
      return;
    let cancelled = false;
    setRendering(true);
    const timer = window.setTimeout(async () => {
      try {
        const next = { ...latest.current, ...settings };
        const result = await render(next);
        if (cancelled) return URL.revokeObjectURL(result.url);
        if (latest.current.result.url !== sharedUrl) URL.revokeObjectURL(latest.current.result.url);
        onChange({ ...next, result });
      } catch {
        /* keep the previous rendering */
      } finally {
        if (!cancelled) setRendering(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, engineFailed]);

  const working = busy || rendering;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {(engineFailed || !page.detected) && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            {tr(engineFailed ? "scanner.engine_failed" : "scanner.not_detected")}
          </AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {!engineFailed && (
          <Tabs value={view} onValueChange={(v) => setView(v as typeof view)}>
            <TabsList>
              <TabsTrigger value="result">{tr("scanner.result")}</TabsTrigger>
              <TabsTrigger value="original">{tr("scanner.original")}</TabsTrigger>
            </TabsList>
          </Tabs>
        )}
        {!engineFailed && (
          <div className="flex items-center gap-1">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={tr("scanner.rotate_left")}
              title={tr("scanner.rotate_left")}
              onClick={() => setSettings((s) => ({ ...s, rotation: nextRotation(s.rotation, -1) }))}
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={tr("scanner.rotate_right")}
              title={tr("scanner.rotate_right")}
              onClick={() => setSettings((s) => ({ ...s, rotation: nextRotation(s.rotation, 1) }))}
            >
              <RotateCw className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg border bg-muted/40 p-2">
        {view === "result" ? (
          <img
            src={page.result.url}
            alt={tr("scanner.result")}
            className="max-h-full max-w-full object-contain shadow-sm"
          />
        ) : (
          <QuadEditor
            src={page.sourceUrl}
            width={page.width}
            height={page.height}
            quad={settings.quad}
            onChange={(quad) => setSettings((s) => ({ ...s, quad }))}
          />
        )}
        {rendering && (
          <span
            className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-background/90 px-2 py-1 text-xs"
            role="status"
          >
            <Loader2 className="h-3 w-3 animate-spin" /> {tr("scanner.processing")}
          </span>
        )}
      </div>
      {view === "original" && !engineFailed && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">{tr("scanner.corner_hint")}</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setSettings((s) => ({ ...s, quad: fullQuad(page.width, page.height) }))}
          >
            <Maximize className="h-4 w-4" /> {tr("scanner.whole_image")}
          </Button>
        </div>
      )}
      {!engineFailed && (
        <ToggleGroup
          type="single"
          value={settings.filter}
          onValueChange={(v) => v && setSettings((s) => ({ ...s, filter: v as ScanFilter }))}
          className="flex-wrap justify-start"
          aria-label={tr("scanner.filter")}
        >
          {SCAN_FILTERS.map((f) => (
            <ToggleGroupItem key={f} value={f} size="sm" variant="outline">
              {tr(`scanner.filter_${f}`)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="ghost" onClick={onRetake} disabled={working}>
          <RefreshCw className="h-4 w-4" /> {tr("scanner.retake")}
        </Button>
        <div className="flex flex-wrap gap-2">
          {canAddMore && (
            <Button type="button" variant="outline" onClick={onAddPage} disabled={working}>
              <Plus className="h-4 w-4" /> {tr("scanner.add_page")}
            </Button>
          )}
          <Button type="button" onClick={onDone} disabled={working}>
            <Check className="h-4 w-4" /> {tr("scanner.done")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function PageReview({
  pages,
  busy,
  onMove,
  onEdit,
  onRetake,
  onRemove,
  onAddPage,
  onSave,
}: {
  pages: ScanPage[];
  busy: boolean;
  onMove: (from: number, to: number) => void;
  onEdit: (index: number) => void;
  onRetake: (index: number) => void;
  onRemove: (index: number) => void;
  onAddPage: () => void;
  onSave: () => void;
}) {
  const full = pages.length >= MAX_SCAN_PAGES;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <ol
        className="grid min-h-0 flex-1 auto-rows-max grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3"
        aria-label={tr("scanner.page_total", { count: pages.length })}
      >
        {pages.map((page, index) => (
          <li key={page.id} className="flex flex-col gap-1 rounded-lg border bg-card p-2">
            <div className="flex aspect-[3/4] items-center justify-center overflow-hidden rounded bg-muted/40">
              <img
                src={page.result.url}
                alt={tr("scanner.page_n", { n: index + 1 })}
                className="max-h-full max-w-full object-contain"
              />
            </div>
            <span className="text-xs font-medium">{tr("scanner.page_n", { n: index + 1 })}</span>
            <div className="flex flex-wrap justify-between">
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                disabled={busy || index === 0}
                aria-label={tr("scanner.move_up")}
                title={tr("scanner.move_up")}
                onClick={() => onMove(index, index - 1)}
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                disabled={busy || index === pages.length - 1}
                aria-label={tr("scanner.move_down")}
                title={tr("scanner.move_down")}
                onClick={() => onMove(index, index + 1)}
              >
                <ArrowDown className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                disabled={busy}
                aria-label={tr("scanner.edit_page")}
                title={tr("scanner.edit_page")}
                onClick={() => onEdit(index)}
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                disabled={busy}
                aria-label={tr("scanner.retake")}
                title={tr("scanner.retake")}
                onClick={() => onRetake(index)}
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-8 w-8 text-destructive"
                disabled={busy}
                aria-label={tr("scanner.remove_page")}
                title={tr("scanner.remove_page")}
                onClick={() => onRemove(index)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </li>
        ))}
      </ol>
      {full && (
        <p className="text-xs text-muted-foreground">
          {tr("scanner.max_pages", { max: MAX_SCAN_PAGES })}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="outline" onClick={onAddPage} disabled={busy || full}>
          <Plus className="h-4 w-4" /> {tr("scanner.add_page")}
        </Button>
        <Button type="button" onClick={onSave} disabled={busy || !pages.length}>
          <Check className="h-4 w-4" /> {tr("scanner.save_pdf")}
        </Button>
      </div>
    </div>
  );
}
