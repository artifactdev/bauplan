import { useState } from "react";
import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  getOcrSettings,
  resetOcrSettings,
  saveOcrSettings,
  testOcrSettings,
} from "@/lib/data.functions";
import {
  OCR_CAPABILITIES,
  ocrDraftSchema,
  ocrLanguage,
  ocrProvider,
  type OcrDraft,
  type OcrSettingsView,
} from "@/lib/ocr";
import { ocrText as t } from "@/lib/ocr-ui";
import { Panel } from "./ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function OcrSettingsPanel() {
  const qc = useQueryClient();
  const busy = useIsMutating({ mutationKey: ["ocr-settings"] }) > 0;
  const query = useQuery({ queryKey: ["ocr-settings"], queryFn: () => getOcrSettings() });
  const refresh = () => qc.invalidateQueries({ queryKey: ["ocr-settings"] });
  const reset = useMutation({
    mutationKey: ["ocr-settings"],
    mutationFn: () => resetOcrSettings(),
    onSuccess: () => {
      toast.success(t("resetDone"));
      return refresh();
    },
    onError: () => toast.error(t("providerFailure")),
  });
  return (
    <Panel title={t("title")} className="md:col-span-2">
      <p className="mb-3 text-sm text-muted-foreground">{t("intro")}</p>
      {query.isLoading && <p role="status">{t("loading")}</p>}
      {(query.isError || query.data?.error) && (
        <p role="alert" className="mb-3 text-sm text-destructive">
          {t(query.data?.error ?? "providerFailure")}
        </p>
      )}
      {query.data?.data && (
        <OcrForm
          key={JSON.stringify(query.data.data)}
          initial={query.data.data}
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

function OcrForm({
  initial,
  onSaved,
  busy,
}: {
  initial: OcrSettingsView;
  onSaved: () => Promise<unknown>;
  busy: boolean;
}) {
  const [settings, setSettings] = useState<OcrDraft["settings"]>({
    enabled: initial.enabled,
    provider: initial.provider,
    baseUrl: initial.baseUrl,
    language: initial.language,
  });
  const [secretAction, setSecretAction] = useState<OcrDraft["secretAction"]>("keep");
  const [apiKey, setApiKey] = useState("");
  const [testResult, setTestResult] = useState<string | null>(null);
  const mutation = useMutation({
    mutationKey: ["ocr-settings"],
    mutationFn: async (action: "save" | "test") => {
      const parsed = ocrDraftSchema.safeParse({
        settings,
        secretAction,
        ...(secretAction === "replace" ? { apiKey } : {}),
      });
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
        setApiKey("");
        setSecretAction("keep");
        toast.success(t("saveSuccess"));
        await onSaved();
      }
    },
    onError: (error: Error) => {
      setTestResult(null);
      toast.error(error.message);
    },
  });
  const capabilities = OCR_CAPABILITIES[settings.provider];
  const selectClass = "h-10 w-full rounded-md border bg-background px-3 text-sm";
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate("save");
      }}
    >
      <fieldset disabled={busy} className="grid gap-3">
        <p className="text-xs text-muted-foreground">
          {t("source")}: {t(initial.source)}
        </p>
        <Label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(e) => {
              setSettings({ ...settings, enabled: e.target.checked });
              setTestResult(null);
            }}
          />
          {t("enabled")}
        </Label>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="grid gap-1">
            <Label htmlFor="ocr-provider">{t("provider")}</Label>
            <select
              id="ocr-provider"
              className={selectClass}
              value={settings.provider}
              onChange={(e) => {
                setSettings({ ...settings, provider: ocrProvider.parse(e.target.value) });
                setTestResult(null);
              }}
            >
              <option value="tesseract">{t("tesseract")}</option>
              <option value="docling">{t("docling")}</option>
            </select>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="ocr-language">{t("language")}</Label>
            <select
              id="ocr-language"
              className={selectClass}
              value={settings.language}
              onChange={(e) => {
                setSettings({ ...settings, language: ocrLanguage.parse(e.target.value) });
                setTestResult(null);
              }}
            >
              <option value="de">{t("german")}</option>
              <option value="en">{t("english")}</option>
              <option value="de+en">{t("both")}</option>
            </select>
          </div>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="ocr-url">{t("url")}</Label>
          <Input
            id="ocr-url"
            type="url"
            value={settings.baseUrl}
            required={settings.enabled}
            onChange={(e) => {
              setSettings({ ...settings, baseUrl: e.target.value });
              setTestResult(null);
            }}
          />
        </div>
        <p className="text-xs text-muted-foreground">{t("unrestrictedWarning")}</p>
        {settings.baseUrl.trim().toLowerCase().startsWith("http:") && (
          <p role="note" className="text-sm text-destructive">
            {t("httpWarning")}
          </p>
        )}
        <div className="grid gap-1">
          <Label htmlFor="ocr-secret-action">
            {t("apiKey")}: {t(initial.hasApiKey ? "keyPresent" : "keyAbsent")}
          </Label>
          <select
            id="ocr-secret-action"
            className={selectClass}
            value={secretAction}
            onChange={(e) => {
              const value = ocrDraftSchema.shape.secretAction.parse(e.target.value);
              setSecretAction(value);
              setApiKey("");
              setTestResult(null);
            }}
          >
            <option value="keep">{t("keepKey")}</option>
            <option value="replace">{t("replaceKey")}</option>
            <option value="delete">{t("deleteKey")}</option>
          </select>
          {secretAction === "replace" && (
            <Input
              aria-label={t("newKey")}
              type="password"
              autoComplete="new-password"
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                setTestResult(null);
              }}
            />
          )}
          <p className="text-xs text-muted-foreground">{t("keyHelp")}</p>
        </div>
        <p className="text-sm">{t("formats")}</p>
        <p className="text-sm">
          {t("capabilities")}: {t("text")}, {t(capabilities.pages ? "pagesYes" : "pagesNo")},{" "}
          {t(capabilities.tables ? "tablesYes" : "tablesNo")}. {t("noSearchablePdf")}
        </p>
        <p className="text-xs text-muted-foreground">{t("limits")}</p>
        {settings.provider === "docling" && (
          <p className="text-xs text-muted-foreground">{t("doclingHelp")}</p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="submit">{t("save")}</Button>
          <Button
            type="button"
            variant="outline"
            disabled={!settings.enabled}
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
