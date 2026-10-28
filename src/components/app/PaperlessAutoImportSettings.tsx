import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  getPaperlessAutoImport,
  getPaperlessImportTags,
  savePaperlessAutoImport,
} from "@/lib/data.functions";
import { getOfflineAccount } from "@/lib/offline-store";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { PaperlessError, PaperlessSelect } from "./paperless-ui";

export function PaperlessAutoImportSettings({ instanceId }: { instanceId: string | null }) {
  const { t } = useTranslation("paperless");
  const client = useQueryClient();
  const userId = getOfflineAccount()?.id;
  const key = ["paperless", userId, instanceId, "auto-import"];
  const settings = useQuery({
    queryKey: key,
    queryFn: () => getPaperlessAutoImport(),
    gcTime: 0,
    refetchInterval: 15_000,
    retry: false,
  });
  const tags = useQuery({
    queryKey: ["paperless", userId, instanceId, "import-tags"],
    queryFn: () => getPaperlessImportTags(),
    gcTime: 0,
    retry: false,
  });
  const [draft, setDraft] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const tag = draft ?? settings.data?.tagId.toString() ?? "";
  const save = useMutation({
    mutationFn: () =>
      savePaperlessAutoImport({
        data: { tagId: tag ? Number(tag) : null, confirmSharing: consent },
      }),
    onSuccess: async (data) => {
      client.setQueryData(key, data);
      setDraft(null);
      setConsent(false);
      await client.invalidateQueries({ queryKey: ["ws"] });
      toast.success(t("autoSaved"));
    },
  });
  const currentTag = settings.data?.tagId;
  const options = tags.data ?? [];
  const missingTag = currentTag && !options.some((option) => option.id === currentTag);
  return (
    <section aria-label={t("autoTitle")} className="flex flex-col gap-3 border-t pt-4">
      <h3 className="text-sm font-medium">{t("autoTitle")}</h3>
      <p className="text-sm text-muted-foreground">{t("autoHint")}</p>
      <PaperlessError error={settings.error ?? tags.error ?? save.error} />
      {(settings.isError || tags.isError) && (
        <Button
          variant="outline"
          onClick={() => {
            void settings.refetch();
            void tags.refetch();
          }}
        >
          {t("retry")}
        </Button>
      )}
      {settings.isPending && <p role="status">{t("loading")}</p>}
      {!settings.isPending && !settings.isError && (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <PaperlessSelect
            id="paperless-auto-tag"
            label={t("autoTag")}
            options={
              missingTag
                ? [...options, { id: currentTag, name: t("autoMissingTag", { id: currentTag }) }]
                : options
            }
            empty={t("autoOff")}
            value={tag}
            disabled={save.isPending}
            onChange={(event) => {
              setDraft(event.target.value);
              setConsent(false);
            }}
          />
          {tag && (
            <Label className="flex items-start gap-2">
              <Checkbox
                checked={consent}
                disabled={save.isPending}
                onCheckedChange={(checked) => setConsent(checked === true)}
              />
              {t("autoConsent")}
            </Label>
          )}
          <Button
            type="submit"
            disabled={save.isPending || (!!tag && (!consent || tags.isError || tags.isPending))}
          >
            {t("autoSave")}
          </Button>
        </form>
      )}
      {settings.data && (
        <div className="flex flex-col gap-2 text-sm" role="status">
          <p>
            {settings.data.lastRun
              ? t("autoLastRun", { date: new Date(settings.data.lastRun).toLocaleString() })
              : t("autoWaiting")}
          </p>
          {settings.data.lastRun && <p>{t("autoResult", settings.data)}</p>}
          <PaperlessError
            error={
              settings.data.error ? new Error(`paperless.errors.${settings.data.error}`) : null
            }
          />
        </div>
      )}
    </section>
  );
}
