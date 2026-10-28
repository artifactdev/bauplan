import { useTranslation } from "react-i18next";
import { Archive, Download, RefreshCw } from "lucide-react";
import type { PaperlessPresence } from "@/lib/paperless-view";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

export function PaperlessDocumentControls({
  connected,
  presence,
  onPresence,
  selectedCount,
  allSelected,
  onSelectAll,
  onClear,
  onImport,
  onExport,
  onVerify,
  busy,
  exportCount,
}: {
  connected: boolean;
  presence: PaperlessPresence;
  onPresence: (presence: PaperlessPresence) => void;
  selectedCount: number;
  allSelected: boolean;
  onSelectAll: (checked: boolean) => void;
  onClear: () => void;
  onImport: () => void;
  onExport: () => void;
  onVerify: () => void;
  busy: boolean;
  exportCount?: number;
}) {
  const { t } = useTranslation("paperless");
  return (
    <section aria-label={t("title")} className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 flex-col gap-2 sm:w-72">
          <Label htmlFor="paperless-presence">{t("presence")}</Label>
          <select
            id="paperless-presence"
            className="h-10 min-w-0 max-w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={presence}
            disabled={busy}
            onChange={(event) => {
              const value = event.target.value;
              if (value === "all" || value === "present" || value === "absent") onPresence(value);
            }}
          >
            <option value="all">{t("all")}</option>
            <option value="present">{t("present")}</option>
            <option value="absent">{t("absent")}</option>
          </select>
        </div>
        <Button size="sm" variant="outline" disabled={!connected || busy} onClick={onImport}>
          <Download data-icon="inline-start" />
          {t("import")}
        </Button>
      </div>
      {!connected && <p className="text-sm text-muted-foreground">{t("notConnected")}</p>}
      <div className="flex flex-col gap-4 rounded-lg bg-muted/40 p-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Label className="flex items-center gap-2">
            <Checkbox
              checked={allSelected}
              disabled={busy}
              onCheckedChange={(checked) => onSelectAll(checked === true)}
            />
            {t("selectVisible")}
          </Label>
          <span className="ml-auto text-sm tabular-nums text-muted-foreground" role="status">
            {t("selected", { count: selectedCount })}
          </span>
          {selectedCount > 0 && (
            <Button size="sm" variant="ghost" onClick={onClear}>
              {t("clear")}
            </Button>
          )}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button
            size="sm"
            variant="outline"
            disabled={!connected || !selectedCount || exportCount === 0 || busy}
            onClick={onExport}
          >
            <Archive data-icon="inline-start" />
            {t("export")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!connected || !selectedCount || busy}
            onClick={onVerify}
          >
            <RefreshCw data-icon="inline-start" />
            {t("verify")}
          </Button>
        </div>
      </div>
      <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">
        {t("presenceHint")}
      </p>
    </section>
  );
}

export function PaperlessDocumentStatus({
  linked,
  state,
  url,
  checked,
  verification,
  canResolve,
  canAbandon = false,
  onResolve,
  onAbandon,
  onCheck,
  error,
}: {
  linked: boolean;
  state: string | null;
  url: string | null;
  checked: string | null;
  verification: string | null;
  canResolve: boolean;
  canAbandon?: boolean;
  onResolve: () => void;
  onAbandon: () => void;
  onCheck?: (() => void) | undefined;
  error?: string | null | undefined;
}) {
  const { t } = useTranslation("paperless");
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {linked && <Badge variant="secondary">{t("linked")}</Badge>}
      {!linked && state && (
        <Badge variant={state === "failed" || state === "unknown" ? "destructive" : "outline"}>
          {t(state)}
        </Badge>
      )}
      {error && <span className="text-xs text-destructive">{t(`errors.${error}`)}</span>}
      {url && (
        <a
          className="text-xs underline underline-offset-4"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t("open")}
        </a>
      )}
      {verification && <span className="text-xs text-muted-foreground">{t(verification)}</span>}
      {checked && (
        <span className="text-xs text-muted-foreground">{t("checked", { date: checked })}</span>
      )}
      {(canResolve || canAbandon) && (
        <>
          {canResolve && onCheck && (
            <Button type="button" size="sm" variant="outline" onClick={onCheck}>
              {t("checkTransfer")}
            </Button>
          )}
          {canResolve && (
            <Button type="button" size="sm" variant="outline" onClick={onResolve}>
              {t("reconcile")}
            </Button>
          )}
          {canAbandon && (
            <Button type="button" size="sm" variant="ghost" onClick={onAbandon}>
              {t("abandon")}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
