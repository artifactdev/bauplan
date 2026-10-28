import { tr } from "@/i18n";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { KeyRound, LoaderCircle } from "lucide-react";
import { z } from "zod";
import { getAuthState, loginLocal } from "@/lib/auth.functions";
import { clearPendingOfflineLogout, hasPendingOfflineLogout } from "@/lib/offline-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";

export const Route = createFileRoute("/auth")({
  ssr: false,
  validateSearch: z.object({ fehler: z.string().optional() }),
  head: () => ({
    meta: [
      { title: tr("auth.sign_bauplan") },
      {
        name: "description",
        content: tr("auth.sign_manage_renovation_project"),
      },
      { property: "og:title", content: tr("auth.sign_bauplan") },
      {
        property: "og:description",
        content: tr("auth.sign_manage_renovation_project"),
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
      toast.error(err instanceof Error ? err.message : tr("auth.sign_error"));
      setBusy(false);
    }
  }

  async function sso() {
    window.location.href = "/api/oidc/login";
  }

  return (
    <main className="auth-page">
      <section className="auth-story" aria-labelledby="auth-story-title">
        <div className="auth-brand">
          <img src="/app-icon-192.png" alt="" width={48} height={48} />
          <span>{tr("shared.bauplan")}</span>
        </div>
        <div className="auth-story-copy">
          <h1 id="auth-story-title">
            {tr("auth.renovation")}
            <br />
            {tr("auth.everything_view")}
          </h1>
          <p>{tr("auth.budget_quotes_invoices_documents")}</p>
        </div>
        <footer className="auth-story-footer">
          <p>{tr("auth.private_homeowners_renovators")}</p>
          <a
            href="https://unsplash.com/photos/RqO6kwm4tZY"
            target="_blank"
            rel="noopener noreferrer"
          >
            {tr("auth.photo_credit")}
          </a>
        </footer>
      </section>
      <section className="auth-form-panel" aria-labelledby="auth-form-title">
        <div className="auth-form-content">
          <div className="auth-brand auth-mobile-brand">
            <img src="/app-icon-192.png" alt="" width={56} height={56} />
            <span>{tr("shared.bauplan")}</span>
          </div>
          <header className="flex flex-col gap-2">
            <h2 id="auth-form-title" className="text-3xl font-semibold tracking-tight">
              {tr("auth.sign")}
            </h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {tr("auth.continue_project")}
            </p>
          </header>
          {fehler && (
            <Alert variant="destructive" className="mt-6">
              <AlertDescription>{fehler}</AlertDescription>
            </Alert>
          )}
          {oidc.enabled && (
            <>
              <Button variant="outline" className="mt-8 h-12 w-full" onClick={sso} disabled={busy}>
                <KeyRound data-icon="inline-start" /> {oidc.label}
              </Button>
              <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
                <Separator className="flex-1" />
                {tr("auth.or")}
                <Separator className="flex-1" />
              </div>
            </>
          )}
          <form onSubmit={submit} className="auth-form" data-sso={oidc.enabled} aria-busy={busy}>
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">{tr("shared.email")}</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                className="h-12"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="pw">{tr("shared.password")}</Label>
              <Input
                id="pw"
                name="password"
                type="password"
                autoComplete="current-password"
                className="h-12"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={busy} className="mt-1 h-12">
              {busy && (
                <LoaderCircle data-icon="inline-start" className="motion-safe:animate-spin" />
              )}
              {tr("auth.sign")}
            </Button>
          </form>
          <p className="mt-7 text-sm leading-relaxed text-muted-foreground">
            {tr("auth.no_account_yet_ask")}
          </p>
        </div>
      </section>
    </main>
  );
}
