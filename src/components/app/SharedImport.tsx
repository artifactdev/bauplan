import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { FileText, Receipt, Upload } from "lucide-react";
import { listSharedFiles, removeSharedFile, type SharedFile } from "@/lib/share-inbox";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { OfferDialog } from "./OfferDialog";
import { ExpenseDialog } from "./ExpenseDialog";
import { QuickUpload } from "./quick-actions";

type Kind = "offer" | "invoice" | "expense" | "document";
const DEFAULTS = {
  offer: { status: "received" },
  invoice: { status: "offen" },
  expense: { status: "bezahlt" },
  document: { category: "Sonstiges", recognize: true },
};

/** Unassigned shares belong to this browser profile; no upload occurs before a type is chosen. */
export function SharedImport() {
  const { t } = useTranslation("share");
  const [files, setFiles] = useState<SharedFile[]>([]);
  const [kind, setKind] = useState<Kind | null>(null);
  const [paused, setPaused] = useState(false);
  const [recognizing, setRecognizing] = useState(false);
  const [completed, setCompleted] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const loadVersion = useRef(0);
  const current = files[0];
  const invalidateLoads = useCallback(() => {
    loadVersion.current++;
  }, []);

  const load = useCallback(async () => {
    if (kind || recognizing || completed || busy) return;
    const version = ++loadVersion.current;
    try {
      const incoming = await listSharedFiles();
      if (version !== loadVersion.current) return;
      // Keep File identities stable: a focus event must not restart OCR.
      setFiles((previous) =>
        incoming.map((item) => previous.find((old) => old.key === item.key) ?? item),
      );
      setError("");
    } catch (cause) {
      console.error("Could not read shared documents", cause);
      if (version === loadVersion.current) setError(t("storage"));
    }
  }, [t, kind, recognizing, completed, busy]);

  useEffect(() => {
    void load();
    window.addEventListener("focus", load);
    const params = new URLSearchParams(window.location.search);
    const shareError = params.get("share_error");
    if (shareError) {
      toast.error(
        t(shareError === "invalid" || shareError === "too_large" ? shareError : "storage"),
      );
    }
    if (shareError || params.has("shared")) {
      params.delete("share_error");
      params.delete("shared");
      const query = params.toString();
      window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
      );
    }
    return () => {
      invalidateLoads();
      window.removeEventListener("focus", load);
    };
  }, [load, t, invalidateLoads]);

  const finish = async (key: string) => {
    invalidateLoads();
    setBusy(true);
    try {
      await removeSharedFile(key);
      setFiles((previous) => previous.filter((file) => file.key !== key));
      setCompleted(null);
      setError("");
    } catch (cause) {
      console.error("Could not remove shared document", cause);
      setCompleted(key);
      setError(t("cleanupFailed"));
    } finally {
      setBusy(false);
    }
  };
  const saved = () => {
    if (!current) return;
    setCompleted(current.key);
    setKind(null);
    void finish(current.key);
  };
  const close = (open: boolean) => {
    if (!open) setKind(null);
  };

  return (
    <>
      {error && (
        <p role="alert" className="mb-4 flex flex-wrap items-center gap-2 text-sm text-destructive">
          {error}
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void (completed ? finish(completed) : load())}
          >
            {t("retry")}
          </Button>
        </p>
      )}
      {paused && files.length > 0 && (
        <Button className="mb-4" variant="outline" onClick={() => setPaused(false)}>
          <Upload data-icon="inline-start" />
          {t("pending", { count: files.length })}
        </Button>
      )}
      <Dialog
        open={!!current && !kind && !paused && !recognizing && !completed && !busy}
        onOpenChange={(open) => !open && setPaused(true)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("description", { count: files.length })}</DialogDescription>
          </DialogHeader>
          <p className="break-words">{current?.file.name}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {(["offer", "invoice", "expense", "document"] as const).map((value) => (
              <Button key={value} variant="outline" onClick={() => setKind(value)}>
                {value === "offer" || value === "document" ? (
                  <FileText data-icon="inline-start" />
                ) : (
                  <Receipt data-icon="inline-start" />
                )}
                {t(value)}
              </Button>
            ))}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPaused(true)}>
              {t("later")}
            </Button>
            <Button variant="outline" onClick={() => current && void finish(current.key)}>
              {t("discard")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {kind === "offer" && current && (
        <OfferDialog
          key={current.key}
          open
          onOpenChange={close}
          initial={DEFAULTS.offer}
          initialFile={current.file}
          onSaved={saved}
        />
      )}
      {(kind === "invoice" || kind === "expense") && current && (
        <ExpenseDialog
          key={current.key}
          open
          onOpenChange={close}
          initial={kind === "invoice" ? DEFAULTS.invoice : DEFAULTS.expense}
          initialFile={current.file}
          preserveStatus
          onSaved={saved}
        />
      )}
      <QuickUpload
        open={kind === "document"}
        onOpenChange={close}
        initial={DEFAULTS.document}
        initialFile={current?.file}
        onSaved={saved}
        onRecognitionChange={setRecognizing}
      />
    </>
  );
}
