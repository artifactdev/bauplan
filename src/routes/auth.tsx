import { tr } from "@/i18n";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Hammer, KeyRound } from "lucide-react";
import { z } from "zod";
import { getAuthState, loginLocal } from "@/lib/auth.functions";
import { clearPendingOfflineLogout, hasPendingOfflineLogout } from "@/lib/offline-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/auth")({
  ssr: false,
  validateSearch: z.object({ fehler: z.string().optional() }),
  head: () => ({
    meta: [
      { title: tr("Anmelden – Bauplan") },
      {
        name: "description",
        content: tr("Melde dich an, um dein Renovierungsprojekt zu verwalten."),
      },
      { property: "og:title", content: tr("Anmelden – Bauplan") },
      {
        property: "og:description",
        content: tr("Melde dich an, um dein Renovierungsprojekt zu verwalten."),
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  beforeLoad: async () => {
    if (typeof navigator !== "undefined" && !navigator.onLine)
      return { oidc: { enabled: false, label: "" } };
    if (hasPendingOfflineLogout()) {
      const { logoutLocal } = await import("@/lib/auth.functions");
      await logoutLocal();
      clearPendingOfflineLogout();
    }
    const auth = await getAuthState();
    if (auth.needsSetup) throw redirect({ to: "/setup" });
    if (auth.user) throw redirect({ to: "/" });
    return { oidc: auth.oidc };
  },
  component: AuthPage,
});

function AuthPage() {
  const { oidc } = Route.useRouteContext();
  const { fehler } = Route.useSearch();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await loginLocal({ data: { email, password } });
      window.location.href = "/";
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tr("Fehler bei der Anmeldung"));
      setBusy(false);
    }
  }

  async function sso() {
    window.location.href = "/api/oidc/login";
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-sidebar p-10 text-sidebar-foreground lg:flex">
        <div className="flex items-center gap-2 font-display text-lg font-semibold text-sidebar-accent-foreground">
          <Hammer className="h-5 w-5 text-sidebar-primary" /> {tr("Bauplan")}
        </div>
        <div>
          <h1 className="text-4xl font-semibold leading-tight text-sidebar-accent-foreground">
            {tr("Deine Renovierung.")}
            <br />
            {tr("Klar im Blick.")}
          </h1>
          <p className="mt-4 max-w-md text-sidebar-foreground/80">
            {tr(
              "Budget, Angebote, Rechnungen, Dokumente, Aufgaben und Termine – an einem Ort statt in zehn Tabellen.",
            )}
          </p>
        </div>
        <p className="text-xs text-sidebar-foreground/60">
          {tr("Für private Bauherren und Sanierer.")}
        </p>
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <h2 className="text-2xl font-semibold">{tr("Anmelden")}</h2>
          {fehler && (
            <p className="mt-3 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {fehler}
            </p>
          )}
          {oidc.enabled && (
            <>
              <Button variant="outline" className="mt-6 w-full" onClick={sso}>
                <KeyRound className="h-4 w-4" /> {oidc.label}
              </Button>
              <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
                <div className="h-px flex-1 bg-border" />
                {tr("oder")}
                <div className="h-px flex-1 bg-border" />
              </div>
            </>
          )}
          <form onSubmit={submit} className={`${oidc.enabled ? "" : "mt-6"} grid gap-4`}>
            <div className="grid gap-1.5">
              <Label htmlFor="email">{tr("E-Mail")}</Label>
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pw">{tr("Passwort")}</Label>
              <Input
                id="pw"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={busy}>
              {tr("Anmelden")}
            </Button>
          </form>
          <p className="mt-4 text-sm text-muted-foreground">
            {tr("Noch kein Konto? Bitte den Admin, dich in den Einstellungen anzulegen.")}
          </p>
        </div>
      </div>
    </div>
  );
}
