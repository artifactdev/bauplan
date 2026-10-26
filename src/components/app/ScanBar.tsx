import { tr } from "@/i18n";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Camera, CheckCircle2, Loader2, Upload } from "lucide-react";
import { useMutations, useWorkspace } from "@/hooks/use-workspace";
import { analyzeDocument } from "@/lib/ocr.functions";
import { ocrText } from "@/lib/ocr-ui";
import { LINKS_DOCUMENT, mapExtraction, type ScanTarget } from "@/lib/scan-map";
import { Button } from "@/components/ui/button";

const CATEGORY: Record<ScanTarget, string> = {
  offer: "Angebot", invoice: "Rechnung", expense: "Beleg", task: "Sonstiges", event: "Sonstiges", cost: "Angebot", trade: "Sonstiges",
};

/** Photo/upload step at the top of a create form: stores the file, reads it, pre-fills the form. */
export function ScanBar({ target, onFill }: { target: ScanTarget; onFill: (v: Record<string, unknown>) => void }) {
  const { ws } = useWorkspace();
  const { upload } = useMutations();
  const cam = useRef<HTMLInputElement>(null);
  const pick = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<{ busy: boolean; done?: string }>({ busy: false });

  async function handle(file: File | undefined) {
    if (!file) return;
    setState({ busy: true });
    try {
      const { id } = await upload.mutateAsync({ file, meta: { category: CATEGORY[target] } });
      const canRead = file.type === "application/pdf" || file.type.startsWith("image/");
      const r = canRead ? await analyzeDocument({ data: { documentId: id } }) : { result: null, error: "unsupported", warnings: [] };
      const vals = mapExtraction(target, r.result, file.name, ws.trades);
      onFill(LINKS_DOCUMENT[target] ? { ...vals, document_id: id } : vals);
      if (r.error) toast.info(tr("scan_bar.file_saved_error_fill", { error: ocrText(r.error) }));
      for (const warning of r.warnings) toast.warning(ocrText(warning));
      setState({ busy: false, done: file.name });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tr("scan_bar.upload_failed"));
      setState({ busy: false });
    }
  }

  return (
    <div className="rounded-lg border border-dashed bg-muted/40 p-3">
      <input ref={cam} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { handle(e.target.files?.[0]); e.target.value = ""; }} />
      <input ref={pick} type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => { handle(e.target.files?.[0]); e.target.value = ""; }} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" disabled={state.busy} onClick={() => cam.current?.click()}><Camera className="h-4 w-4" /> {tr("shared.take_photo")}</Button>
        <Button type="button" size="sm" variant="outline" disabled={state.busy} onClick={() => pick.current?.click()}><Upload className="h-4 w-4" /> {tr("scan_bar.upload_file")}</Button>
        {state.busy && <span className="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> {tr("scan_bar.reading")}</span>}
        {state.done && !state.busy && <span className="flex items-center gap-1 text-xs text-muted-foreground"><CheckCircle2 className="h-3 w-3 text-success" /> {state.done}</span>}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{tr("scan_bar.optional_photograph_upload_receipt")}</p>
    </div>
  );
}
