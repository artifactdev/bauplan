import { useState } from "react";
import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  deleteOcrModel,
  downloadOcrModel,
  getOcrModels,
  getOcrSettings,
  resetOcrSettings,
  saveOcrSettings,
  testOcrSettings,
} from "@/lib/data.functions";
import {
  OCR_CAPABILITIES,
  ocrDraftSchema,
  ocrLanguage,
  type OcrDraft,
  type OcrLanguage,
  type OcrModelLanguage,
  type OcrModelStatus,
  type OcrSettingsView,
} from "@/lib/ocr";
import { ocrText as t } from "@/lib/ocr-ui";
import { Panel } from "./ui-bits";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export function OcrSettingsPanel() {
  const qc = useQueryClient();
  const busy = useIsMutating({ mutationKey: ["ocr-settings"] }) > 0;
  const query = useQuery({ queryKey: ["ocr-settings"], queryFn: () => getOcrSettings() });
  const models = useQuery({ queryKey: ["ocr-models"], queryFn: () => getOcrModels() });
  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["ocr-settings"] }),
      qc.invalidateQueries({ queryKey: ["ocr-models"] }),
    ]);
  };
  const reset = useMutation({
    mutationKey: ["ocr-settings"],
    mutationFn: () => resetOcrSettings(),
    onSuccess: async () => {
      toast.success(t("resetDone"));
      await refresh();
    },
    onError: () => toast.error(t("requestFailed")),
  });
  const modelMutation = useMutation({
    mutationKey: ["ocr-settings"],
    mutationFn: async ({
      language,
      action,
    }: {
      language: OcrModelLanguage;
      action: "download" | "delete";
    }) => {
      const result =
        action === "download"
          ? await downloadOcrModel({ data: { language } })
          : await deleteOcrModel({ data: { language } });
      if (result.error) throw new Error(t(result.error));
    },
    onSuccess: async () => {
      toast.success(t("modelActionDone"));
      await refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  return (
    <Panel title={t("title")} className="md:col-span-2">
      <p className="mb-3 text-sm text-muted-foreground">{t("intro")}</p>
      {query.isLoading && <p role="status">{t("loading")}</p>}
      {(query.isError || query.data?.error) && (
        <p role="alert" className="mb-3 text-sm text-destructive">
          {t(query.data?.error ?? "requestFailed")}
        </p>
      )}
      {models.isLoading && <p role="status">{t("modelsLoading")}</p>}
      {(models.isError || models.data?.error) && (
        <p role="alert" className="mb-3 text-sm text-destructive">
          {t(models.data?.error ?? "requestFailed")}
        </p>
      )}
      {models.data?.data && (
        <ModelManager models={models.data.data} busy={busy} onAction={modelMutation.mutate} />
      )}
      {query.data?.data && models.data?.data && (
        <OcrForm
          key={JSON.stringify(query.data.data)}
          initial={query.data.data}
          models={models.data.data}
          onSaved={refresh}
          busy={busy}
        />
      )}
      <Button
        className="mt-3"
        variant="ghost"
        disabled={busy || query.isLoading}
        onClick={() => {
          if (window.confirm(t("resetConfirm"))) reset.mutate();
        }}
      >
        {t("reset")}
      </Button>
    </Panel>
  );
}

function ModelManager({
  models,
  busy,
  onAction,
}: {
  models: OcrModelStatus[];
  busy: boolean;
  onAction: (input: { language: OcrModelLanguage; action: "download" | "delete" }) => void;
}) {
  return (
    <section className="mb-4 grid gap-2" aria-labelledby="ocr-models-heading">
      <h3 id="ocr-models-heading" className="text-sm font-medium">
        {t("modelsTitle")}
      </h3>
      <p className="text-xs text-muted-foreground">{t("modelsHelp")}</p>
      <ul className="grid gap-2">
        {models.map((model) => (
          <li key={model.language} className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm">
              {t(model.language === "de" ? "german" : "english")}{" "}
              {model.installed
                ? `${t("modelInstalled")} (${formatBytes(model.size ?? 0)} ${t("mib")})`
                : t("modelMissingStatus")}
            </span>
            <Button
              type="button"
              size="sm"
              variant={model.installed ? "outline" : "default"}
              disabled={busy}
              onClick={() =>
                onAction({
                  language: model.language,
                  action: model.installed ? "delete" : "download",
                })
              }
            >
              {model.installed ? t("modelDelete") : t("modelDownload")}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function formatBytes(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value / 1024 / 1024);
}

function languageInstalled(language: OcrLanguage, models: OcrModelStatus[]): boolean {
  const required = language === "de+en" ? ["de", "en"] : [language];
  return required.every((item) =>
    models.some((model) => model.language === item && model.installed),
  );
}

function OcrForm({
  initial,
  models,
  onSaved,
  busy,
}: {
  initial: OcrSettingsView;
  models: OcrModelStatus[];
  onSaved: () => Promise<unknown>;
  busy: boolean;
}) {
  const [settings, setSettings] = useState<OcrDraft["settings"]>({
    enabled: initial.enabled,
    language: initial.language,
  });
  const [testResult, setTestResult] = useState<string | null>(null);
  const mutation = useMutation({
    mutationKey: ["ocr-settings"],
    mutationFn: async (action: "save" | "test") => {
      const parsed = ocrDraftSchema.safeParse({ settings });
      if (!parsed.success) throw new Error(t("invalidSettings"));
      const result =
        action === "save"
          ? await saveOcrSettings({ data: parsed.data })
          : await testOcrSettings({ data: parsed.data });
      if (result.error) throw new Error(t(result.error));
      if (action === "test") {
        const warnings = typeof result.data === "object" ? result.data.warnings : [];
        setTestResult([t("testSuccess"), ...warnings.map(t)].join(" "));
      } else {
        toast.success(t("saveSuccess"));
        await onSaved();
      }
    },
    onError: (error: Error) => {
      setTestResult(null);
      toast.error(error.message);
    },
  });
  const selectClass = "h-10 w-full rounded-md border bg-background px-3 text-sm";
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate("save");
      }}
    >
      <fieldset disabled={busy} className="grid gap-3">
        <p className="text-xs text-muted-foreground">
          {t("source")}: {t(initial.source)}
        </p>
        {initial.legacySettings && (
          <p role="note" className="text-sm text-muted-foreground">
            {t("legacySettings")}
          </p>
        )}
        <Label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(event) => {
              setSettings({ ...settings, enabled: event.target.checked });
              setTestResult(null);
            }}
          />
          {t("enabled")}
        </Label>
        <div className="grid gap-1">
          <Label htmlFor="ocr-language">{t("language")}</Label>
          <select
            id="ocr-language"
            className={selectClass}
            value={settings.language}
            onChange={(event) => {
              setSettings({ ...settings, language: ocrLanguage.parse(event.target.value) });
              setTestResult(null);
            }}
          >
            {(["de", "en", "de+en"] as const).map((language) => {
              const available = languageInstalled(language, models);
              return (
                <option
                  key={language}
                  value={language}
                  disabled={!available && language !== settings.language}
                >
                  {t(language === "de" ? "german" : language === "en" ? "english" : "both")}
                  {!available ? ` — ${t("modelsRequired")}` : ""}
                </option>
              );
            })}
          </select>
        </div>
        <p className="text-sm">{t("formats")}</p>
        <p className="text-sm">
          {t("capabilities")}: {t("text")}, {t(OCR_CAPABILITIES.pages ? "pagesYes" : "pagesNo")},{" "}
          {t(OCR_CAPABILITIES.tables ? "tablesYes" : "tablesNo")}. {t("noSearchablePdf")}
        </p>
        <p className="text-xs text-muted-foreground">{t("limits")}</p>
        <div className="flex flex-wrap gap-2">
          <Button type="submit">{t("save")}</Button>
          <Button
            type="button"
            variant="outline"
            disabled={!settings.enabled || !languageInstalled(settings.language, models)}
            onClick={() => mutation.mutate("test")}
          >
            {t("test")}
          </Button>
          {mutation.isPending && (
            <span role="status" className="self-center text-sm">
              {t("working")}
            </span>
          )}
        </div>
        {testResult && (
          <p role="status" className="text-sm">
            {testResult}
          </p>
        )}
      </fieldset>
    </form>
  );
}
