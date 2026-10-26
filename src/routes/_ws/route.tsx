import { tr } from "@/i18n";
import { createFileRoute, Link, Outlet, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { Bookmark, Contact as ContactIcon, CalendarDays, FileText, ShoppingCart, Hammer, LayoutDashboard, ListChecks, Receipt, Settings, Wallet } from "lucide-react";
import { getBackendInfo } from "@/lib/data.functions";
import { getAuthState, logoutLocal } from "@/lib/auth.functions";
import { useMutations, useWorkspace } from "@/hooks/use-workspace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { AccountAppearance } from "@/components/app/AppearanceProvider";
import { AppearanceModeMenu } from "@/components/app/AppearanceControls";

export const Route = createFileRoute("/_ws")({
  ssr: false,
  beforeLoad: async () => {
    const [info, auth] = await Promise.all([getBackendInfo(), getAuthState()]);
    if (auth.needsSetup) throw redirect({ to: "/setup" });
    if (!auth.user) throw redirect({ to: "/auth" });
    return { backend: info, auth };
  },
  component: Layout,
  pendingComponent: () => <div className="p-10 text-sm text-muted-foreground">{tr("Lädt…")}</div>,
});

const NAV = [
  { to: "/", label: tr("Übersicht"), icon: LayoutDashboard },
  { to: "/budget", label: tr("Budget"), icon: Wallet },
  { to: "/angebote", label: tr("Angebote"), icon: Receipt },
  { to: "/ausgaben", label: tr("Ausgaben"), icon: ShoppingCart },
  { to: "/dokumente", label: tr("Dokumente"), icon: FileText },
  { to: "/aufgaben", label: tr("Aufgaben"), icon: ListChecks },
  { to: "/kalender", label: tr("Kalender"), icon: CalendarDays },
  { to: "/sammlungen", label: tr("Sammlungen"), icon: Bookmark },
  { to: "/kontakte", label: tr("Kontakte"), icon: ContactIcon },
] as const;

export async function signOut() {
  await logoutLocal();
  window.location.href = "/auth";
}

function Layout() {
  const { auth } = Route.useRouteContext();
  if (auth.user?.role === "pending") return <Pending email={auth.user.email} />;
  return <AccountAppearance key={auth.user!.id} userId={auth.user!.id}><Shell /></AccountAppearance>;
}

function Pending({ email }: { email: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-md rounded-xl border bg-card p-6 text-center shadow-card">
        <Hammer className="mx-auto h-8 w-8 text-primary" />
        <h1 className="mt-3 text-2xl font-semibold">{tr("Warte auf Freischaltung")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">Du bist als {email} angemeldet. Ein Admin muss dein Konto in den Einstellungen freischalten, bevor du das Projekt sehen kannst.</p>
        <Button variant="outline" className="mt-5" onClick={() => signOut()}>{tr("Abmelden")}</Button>
      </div>
    </div>
  );
}

function Shell() {
  const { ws, isLoading } = useWorkspace();
  const project = ws.projects[0];

  return (
    <div className="min-h-screen md:flex">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col bg-sidebar p-4 text-sidebar-foreground md:flex">
        <div className="mb-8 flex items-center gap-2 px-2 font-display text-lg font-semibold text-sidebar-accent-foreground">
          <Hammer className="h-5 w-5 text-sidebar-primary" /> {tr("Bauplan")}
        </div>
        <nav className="grid gap-1">
          {[...NAV, { to: "/einstellungen", label: tr("Einstellungen"), icon: Settings } as const].map((n) => (
            <Link
              key={n.to}
              to={n.to}
              activeOptions={{ exact: n.to === "/" }}
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-sidebar-accent"
              activeProps={{ className: "bg-sidebar-accent text-sidebar-accent-foreground font-medium" }}
            >
              <n.icon className="h-4 w-4" /> {n.label}
            </Link>
          ))}
        </nav>
        {project && (
          <div className="mt-auto rounded-lg bg-sidebar-accent p-3 text-xs">
            <div className="font-medium text-sidebar-accent-foreground">{project.name}</div>
            {project.address && <div className="mt-0.5 opacity-70">{project.address}</div>}
          </div>
        )}
      </aside>

      <header className="sticky top-0 z-30 flex items-center justify-between border-b bg-background/95 px-4 py-3 backdrop-blur md:hidden">
        <div className="flex items-center gap-2 font-display font-semibold">
          <Hammer className="h-5 w-5 text-primary" /> {tr("Bauplan")}
        </div>
        <div className="flex items-center gap-2">
          <AppearanceModeMenu />
          <Link to="/einstellungen" aria-label={tr("Einstellungen")}><Settings className="h-5 w-5 text-muted-foreground" /></Link>
        </div>
      </header>

      <main className="min-w-0 flex-1 px-4 pb-24 pt-5 md:px-8 md:pb-10 md:pt-8">
        <div className="mx-auto max-w-6xl">
          <div className="mb-2 hidden justify-end md:flex"><AppearanceModeMenu /></div>
          {isLoading ? <p className="text-sm text-muted-foreground">{tr("Lädt…")}</p> : project ? <Outlet /> : <ProjectSetup />}
        </div>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-9 border-t bg-card md:hidden">
        {NAV.map((n) => (
          <Link
            key={n.to}
            to={n.to}
            activeOptions={{ exact: n.to === "/" }}
            className="flex flex-col items-center gap-0.5 py-2 text-[10px] text-muted-foreground"
            activeProps={{ className: "text-primary font-medium" }}
          >
            <n.icon className="h-5 w-5" /> {n.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

function ProjectSetup() {
  const { create } = useMutations();
  const [name, setName] = useState("");
  const [budget, setBudget] = useState("");
  return (
    <div className="mx-auto mt-10 max-w-md rounded-xl border bg-card p-6 shadow-card">
      <h1 className="text-2xl font-semibold">{tr("Projekt anlegen")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{tr("Nur zwei Angaben – alles Weitere kannst du später ergänzen.")}</p>
      <form
        className="mt-6 grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate({ table: "projects", row: { name: name || "Mein Renovierungsprojekt", total_budget: budget } });
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="pn">{tr("Projektname")}</Label>
          <Input id="pn" placeholder={tr("z. B. Sanierung Altbauwohnung")} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="pb">{tr("Gesamtbudget (€)")}</Label>
          <Input id="pb" type="number" required value={budget} onChange={(e) => setBudget(e.target.value)} />
        </div>
        <Button type="submit" disabled={create.isPending} className={cn()}>{tr("Projekt starten")}</Button>
      </form>
    </div>
  );
}
