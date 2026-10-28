import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { connectPaperless, disconnectPaperless, savePaperlessSettings } from "@/lib/data.functions";
import { usePaperlessSettings } from "@/hooks/use-paperless";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Panel } from "./ui-bits";
import { PaperlessError } from "./paperless-ui";

export function PaperlessSettings({ admin = false }: { admin?: boolean }) {
  const { t } = useTranslation("paperless");
  const settings = usePaperlessSettings();
  const client = useQueryClient();
  const [token, setToken] = useState("");
  const [draft, setDraft] = useState<{
    enabled: boolean;
    apiUrl: string;
    publicUrl: string;
  } | null>(null);
  const refresh = async () => {
    await client.cancelQueries({ queryKey: ["paperless"] });
    client.removeQueries({ queryKey: ["paperless"] });
    await settings.refetch();
  };
  const connect = useMutation({
    mutationFn: () => connectPaperless({ data: { token } }),
    onSuccess: async () => {
      setToken("");
      await refresh();
      toast.success(t("connected"));
    },
  });
  const disconnect = useMutation({
    mutationFn: () => disconnectPaperless(),
    onSuccess: async () => {
      setToken("");
      await refresh();
      toast.success(t("disconnected"));
    },
  });
  const save = useMutation({
    mutationFn: (data: { enabled: boolean; apiUrl: string; publicUrl: string }) =>
      savePaperlessSettings({ data }),
    onSuccess: async () => {
      setDraft(null);
      setToken("");
      await refresh();
      toast.success(t("saved"));
    },
  });
  const data = settings.data;
  const value = draft ?? data?.config;
  const busy = save.isPending || connect.isPending || disconnect.isPending;
  return (
    <Panel title={t(admin ? "adminTitle" : "personalTitle")}>
      <div className="flex flex-col gap-4">
        <PaperlessError error={settings.error} />
        {settings.isPending && <p role="status">{t("loading")}</p>}
        {settings.isError && (
          <Button variant="outline" onClick={() => settings.refetch()}>
            {t("retry")}
          </Button>
        )}
        {data && (admin || data.enabled) && !data.encryptionReady && (
          <p className="text-sm text-muted-foreground">{t("errors.encryption_key")}</p>
        )}
        {data &&
          (admin ? (
            <form
              className="flex flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (value) save.mutate(value);
              }}
            >
              <div className="flex items-center gap-2">
                <Switch
                  id="paperless-enabled"
                  checked={value?.enabled ?? false}
                  disabled={busy}
                  onCheckedChange={(enabled) => value && setDraft({ ...value, enabled })}
                />
                <Label htmlFor="paperless-enabled">{t("enabled")}</Label>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="paperless-api-url">{t("apiUrl")}</Label>
                <Input
                  id="paperless-api-url"
                  type="url"
                  required={value?.enabled}
                  value={value?.apiUrl ?? ""}
                  disabled={busy}
                  onChange={(event) => value && setDraft({ ...value, apiUrl: event.target.value })}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="paperless-public-url">{t("publicUrl")}</Label>
                <Input
                  id="paperless-public-url"
                  type="url"
                  value={value?.publicUrl ?? ""}
                  disabled={busy}
                  onChange={(event) =>
                    value && setDraft({ ...value, publicUrl: event.target.value })
                  }
                />
              </div>
              <p className="text-xs text-muted-foreground">{t("urlHint")}</p>
              <p className="text-xs text-muted-foreground">{t("instanceWarning")}</p>
              <PaperlessError error={save.error} />
              <Button type="submit" disabled={busy}>
                {t("save")}
              </Button>
            </form>
          ) : data.enabled ? (
            <form
              className="flex flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                connect.mutate();
              }}
            >
              <p className="text-sm text-muted-foreground">{t("sharing")}</p>
              {data.connected && <p role="status">{t("connected")}</p>}
              <div className="flex flex-col gap-2">
                <Label htmlFor="paperless-token">{t("token")}</Label>
                <Input
                  id="paperless-token"
                  type="password"
                  autoComplete="new-password"
                  value={token}
                  required
                  disabled={busy}
                  onChange={(event) => setToken(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">{t("tokenHint")}</p>
              </div>
              <PaperlessError error={connect.error ?? disconnect.error} />
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={busy || !token.trim() || !data.encryptionReady}>
                  {t("connect")}
                </Button>
                {data.connected && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => window.confirm(t("disconnectConfirm")) && disconnect.mutate()}
                  >
                    {t("disconnect")}
                  </Button>
                )}
              </div>
            </form>
          ) : (
            <p className="text-sm text-muted-foreground">{t("disabled")}</p>
          ))}
      </div>
    </Panel>
  );
}
