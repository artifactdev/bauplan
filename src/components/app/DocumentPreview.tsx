import { lazy, Suspense, useState } from "react";
import { Download, Maximize, Minimize } from "lucide-react";
import { tr } from "@/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const PdfReader = lazy(() => import("./PdfReader"));

export function DocumentPreview({
  name,
  mime,
  url,
  onClose,
}: {
  name: string;
  mime: string | null;
  url: string;
  onClose: () => void;
}) {
  const [fullscreen, setFullscreen] = useState(false);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        aria-describedby={undefined}
        className={cn(
          "flex h-[90dvh] w-[calc(100%-1rem)] max-w-4xl flex-col gap-0 overflow-hidden p-0",
          fullscreen &&
            "h-dvh w-screen max-w-none rounded-none border-0 pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] pt-[env(safe-area-inset-top)] sm:rounded-none [&>button]:right-[calc(1rem+env(safe-area-inset-right))] [&>button]:top-[calc(1rem+env(safe-area-inset-top))]",
        )}
      >
        <DialogHeader className="shrink-0 border-b py-3 pl-4 pr-12">
          <div className="flex min-w-0 items-center gap-2">
            <DialogTitle className="min-w-0 flex-1 truncate text-left">{name}</DialogTitle>
            <Button size="icon" variant="ghost" asChild>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={tr("pdf.open_original")}
              >
                <Download />
              </a>
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setFullscreen((value) => !value)}
              aria-label={tr(fullscreen ? "pdf.exit_fullscreen" : "pdf.fullscreen")}
              aria-pressed={fullscreen}
            >
              {fullscreen ? <Minimize /> : <Maximize />}
            </Button>
          </div>
        </DialogHeader>
        {mime === "application/pdf" ? (
          <Suspense
            fallback={
              <p role="status" className="p-4 text-sm">
                {tr("pdf.loading")}
              </p>
            }
          >
            <PdfReader url={url} />
          </Suspense>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto p-4">
            <img src={url} alt={name} className="h-full w-full object-contain" />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
