import { useEffect, useRef, useState } from "react";
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { tr } from "@/i18n";
import { Button } from "@/components/ui/button";

declare const __PDFJS_ASSET_BASE__: string;
GlobalWorkerOptions.workerSrc = workerUrl;

export default function PdfReader({ url }: { url: string }) {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(0);
  const viewport = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const resize = () => setWidth(Math.max(1, element.clientWidth - 32));
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let active = true;
    setDocument(null);
    setError(false);
    const task = getDocument({
      url,
      cMapUrl: `${__PDFJS_ASSET_BASE__}cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${__PDFJS_ASSET_BASE__}standard_fonts/`,
      wasmUrl: `${__PDFJS_ASSET_BASE__}wasm/`,
      iccUrl: `${__PDFJS_ASSET_BASE__}iccs/`,
    });
    void task.promise.then(
      (pdf) => {
        if (active) setDocument(pdf);
      },
      (reason: unknown) => {
        if (!active) return;
        console.error("Could not load PDF preview", reason);
        setError(true);
      },
    );
    return () => {
      active = false;
      void task
        .destroy()
        .catch((reason: unknown) => console.error("Could not close PDF preview", reason));
    };
  }, [url]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <span className="text-sm" role="status">
          {error
            ? tr("pdf.failed")
            : document
              ? tr("pdf.pages", { count: document.numPages })
              : tr("pdf.loading")}
        </span>
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            aria-label={tr("pdf.zoom_out")}
            disabled={zoom <= 0.5}
            onClick={() => setZoom((v) => Math.max(0.5, v - 0.25))}
          >
            <Minus />
          </Button>
          <span className="min-w-12 text-center text-sm">{Math.round(zoom * 100)}%</span>
          <Button
            size="icon"
            variant="ghost"
            aria-label={tr("pdf.zoom_in")}
            disabled={zoom >= 3}
            onClick={() => setZoom((v) => Math.min(3, v + 0.25))}
          >
            <Plus />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label={tr("pdf.fit_width")}
            onClick={() => setZoom(1)}
          >
            <RotateCcw />
          </Button>
        </div>
      </div>
      <div
        ref={viewport}
        className="min-h-0 flex-1 overflow-auto overscroll-contain bg-muted p-4"
        role="region"
        aria-label={tr("pdf.pages_region")}
        tabIndex={0}
      >
        {error && (
          <p role="alert" className="p-4 text-sm text-destructive">
            {tr("pdf.load_error")}
          </p>
        )}
        {!document && !error && (
          <p className="p-4 text-sm text-muted-foreground">{tr("pdf.loading")}</p>
        )}
        {document && width > 0 && (
          <div className="mx-auto flex flex-col gap-4" style={{ width: width * zoom }}>
            {Array.from({ length: document.numPages }, (_, index) => (
              <PdfPage
                key={index}
                pdf={document}
                number={index + 1}
                width={width * zoom}
                root={viewport.current}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PdfPage({
  pdf,
  number,
  width,
  root,
}: {
  pdf: PDFDocumentProxy;
  number: number;
  width: number;
  root: HTMLDivElement | null;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [ratio, setRatio] = useState(Math.SQRT2);
  const [error, setError] = useState(false);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(!!entry?.isIntersecting), {
      root,
      rootMargin: "600px 0px",
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [root]);

  useEffect(() => {
    if (!visible || !host.current) return;
    const element = host.current;
    const canvas = window.document.createElement("canvas");
    let active = true;
    let rendering:
      ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]> | undefined;
    setError(false);
    void (async () => {
      try {
        const page = await pdf.getPage(number);
        if (!active) return;
        const original = page.getViewport({ scale: 1 });
        setRatio(original.height / original.width);
        // Bound backing-store memory on iOS, independently of CSS zoom.
        const density = Math.min(
          window.devicePixelRatio || 1,
          2,
          Math.sqrt(4_000_000 / ((width * width * original.height) / original.width)),
        );
        const view = page.getViewport({ scale: (width / original.width) * density });
        canvas.width = Math.max(1, Math.floor(view.width));
        canvas.height = Math.max(1, Math.floor(view.height));
        canvas.style.width = "100%";
        canvas.style.height = "100%";
        canvas.setAttribute("role", "img");
        canvas.setAttribute("aria-label", tr("pdf.page", { number }));
        element.append(canvas);
        rendering = page.render({ canvas, viewport: view });
        await rendering.promise;
      } catch (reason) {
        if (!active) return;
        console.error(`Could not render PDF page ${number}`, reason);
        setError(true);
      }
    })();
    return () => {
      active = false;
      rendering?.cancel();
      canvas.remove();
      canvas.width = canvas.height = 0;
    };
  }, [pdf, number, width, visible]);

  return (
    <div className="flex flex-col gap-1">
      <span className="text-center text-xs text-muted-foreground">
        {tr("pdf.page", { number })}
      </span>
      <div
        ref={host}
        className="relative bg-background shadow-sm"
        style={{ height: width * ratio }}
      >
        {error && (
          <p role="alert" className="absolute inset-0 p-4 text-sm text-destructive">
            {tr("pdf.page_error", { number })}
          </p>
        )}
      </div>
    </div>
  );
}
