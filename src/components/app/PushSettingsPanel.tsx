import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Panel } from "./ui-bits";
import { Button } from "@/components/ui/button";
import {
  getPushConfiguration,
  sendTestPush,
  subscribePush,
  unsubscribePush,
} from "@/lib/data.functions";

export function PushSettingsPanel({ userId }: { userId: string }) {
  const { t, i18n } = useTranslation("push");
  const [config, setConfig] = useState<Awaited<ReturnType<typeof getPushConfiguration>> | null>(
    null,
  );
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const supported =
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window &&
    window.isSecureContext;
  const enabled = !!subscription && !!config?.endpoints.includes(subscription.endpoint);
  useEffect(() => {
    if (!supported) return;
    let active = true;
    void (async () => {
      try {
        const [settings, registration] = await Promise.all([
          getPushConfiguration(),
          navigator.serviceWorker.getRegistration(),
        ]);
        const current = registration?.active
          ? await registration.pushManager.getSubscription()
          : null;
        if (active) {
          setConfig(settings);
          setSubscription(current ?? null);
        }
      } catch (reason) {
        if (active) {
          setError(true);
          toast.error(reason instanceof Error ? reason.message : t("failed"));
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [supported, t, userId]);

  const action = async (operation: "enable" | "disable" | "test") => {
    setBusy(true);
    try {
      if (operation === "enable") {
        // Request permission from the explicit user gesture, before any network round trip.
        if ((await Notification.requestPermission()) !== "granted")
          throw new Error(t("permission"));
        const registration = await navigator.serviceWorker.getRegistration();
        if (!registration?.active) throw new Error(t("worker"));
        const settings = await getPushConfiguration();
        if (!settings.publicKey) throw new Error(t("notConfigured"));
        let current = await registration.pushManager.getSubscription();
        const bytes = Uint8Array.from(
          atob(settings.publicKey.replace(/-/g, "+").replace(/_/g, "/")),
          (c) => c.charCodeAt(0),
        );
        if (current) {
          const previous = current.options.applicationServerKey;
          if (
            previous &&
            !bytes.every((value, index) => new Uint8Array(previous)[index] === value)
          ) {
            if (!(await current.unsubscribe())) throw new Error(t("failed"));
            current = null;
          }
        }
        current ??= await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: bytes,
        });
        const value = current.toJSON();
        await subscribePush({
          data: {
            subscription: {
              endpoint: current.endpoint,
              keys: { p256dh: value.keys?.["p256dh"] ?? "", auth: value.keys?.["auth"] ?? "" },
            },
            language: i18n.language.startsWith("en") ? "en" : "de",
          },
        });
        setSubscription(current);
        setConfig({ ...settings, endpoints: [...settings.endpoints, current.endpoint] });
        toast.success(t("enabled"));
      } else if (subscription && operation === "disable") {
        await unsubscribePush({ data: { endpoint: subscription.endpoint } });
        if (!(await subscription.unsubscribe())) throw new Error(t("failed"));
        setSubscription(null);
        toast.success(t("disabled"));
      } else if (subscription) {
        await sendTestPush({ data: { endpoint: subscription.endpoint } });
        toast.success(t("testSent"));
      }
    } catch (reason) {
      toast.error(
        reason instanceof Error ? t(reason.message, { defaultValue: reason.message }) : t("failed"),
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel title={t("settingsTitle")}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">{t("description")}</p>
        <p className="text-sm">{t("rules")}</p>
        <p className="text-xs text-muted-foreground">{t("ios")}</p>
        {!supported ? (
          <p role="status">{t("unsupported")}</p>
        ) : error ? (
          <p role="alert">{t("failed")}</p>
        ) : !config ? (
          <p role="status">{t("loading")}</p>
        ) : !config.publicKey ? (
          <p role="status">{t("notConfigured")}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => void action(enabled ? "disable" : "enable")}>
              {t(enabled ? "disable" : "enable")}
            </Button>
            {enabled && (
              <Button variant="outline" disabled={busy} onClick={() => void action("test")}>
                {t("testButton")}
              </Button>
            )}
          </div>
        )}
        <p className="text-xs text-muted-foreground">{t("privacy")}</p>
      </div>
    </Panel>
  );
}
