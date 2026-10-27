import { Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Panel } from "@/components/app/ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function CalendarSyncPanel({ email }: { email: string }) {
  const { t } = useTranslation("caldav");
  const url = typeof window === "undefined" ? "" : `${window.location.origin}/api/caldav/`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t("copied"));
    } catch {
      toast.error(t("copyFailed"));
    }
  };
  return (
    <Panel title={t("title")}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">{t("description")}</p>
        <dl className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <dt>
              <Label htmlFor="caldav-server">{t("server")}</Label>
            </dt>
            <dd className="flex gap-2">
              <Input
                id="caldav-server"
                readOnly
                value={url}
                onFocus={(event) => event.currentTarget.select()}
              />
              <Button variant="outline" aria-label={t("copy")} onClick={() => void copy()}>
                <Copy data-icon="inline-start" />
              </Button>
            </dd>
          </div>
          <div className="flex flex-col gap-1.5">
            <dt>
              <Label htmlFor="caldav-user">{t("username")}</Label>
            </dt>
            <dd>
              <Input
                id="caldav-user"
                readOnly
                value={email}
                onFocus={(event) => event.currentTarget.select()}
              />
            </dd>
          </div>
        </dl>
        <p className="text-sm">{t("password")}</p>
        <p className="text-sm">{t("setup")}</p>
        <p className="text-xs text-muted-foreground">{t("limits")}</p>
        <p className="text-xs text-muted-foreground">{t("timezone")}</p>
        <p className="text-xs text-muted-foreground">{t("https")}</p>
      </div>
    </Panel>
  );
}
