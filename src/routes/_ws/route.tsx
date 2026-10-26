import { tr } from "@/i18n";
import { createFileRoute, Link, Outlet, redirect, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { Bookmark, Contact as ContactIcon, CalendarDays, FileText, ShoppingCart, Hammer, LayoutDashboard, ListChecks, Receipt, Settings, Wallet, MoreHorizontal, UserRound, LogOut, Pencil } from "lucide-react";
import { getBackendInfo } from "@/lib/data.functions";
import { getAuthState, logoutLocal } from "@/lib/auth.functions";
import { useMutations, useWorkspace } from "@/hooks/use-workspace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { AccountAppearance } from "@/components/app/AppearanceProvider";
import { AppearanceModeMenu } from "@/components/app/AppearanceControls";
import { ProjectDialog } from "@/components/app/ProjectDialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

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
  const { t } = useTranslation("shell");
  const { auth } = Route.useRouteContext();
  const { ws, isLoading } = useWorkspace();
  const project = ws.projects[0];
  const [projectOpen, setProjectOpen] = useState(false);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const primaryNav = NAV.filter((n) => ["/", "/budget", "/dokumente", "/aufgaben"].includes(n.to));
  const secondaryNav = NAV.filter((n) => !primaryNav.includes(n));
  const moreActive = secondaryNav.some((n) => n.to === pathname) || pathname === "/einstellungen";

  return (
    <div className="min-h-screen md:flex">
      <a href="#main-content" className="sr-only z-50 rounded-lg bg-popover p-3 text-popover-foreground focus:not-sr-only focus:fixed focus:left-4 focus:top-4">{t("skip")}</a>
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar px-3 py-5 text-sidebar-foreground md:flex">
        <div className="mb-7 flex items-center gap-3 px-3 font-display text-lg font-semibold text-sidebar-accent-foreground">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Hammer className="h-5 w-5" /></span> {tr("Bauplan")}
        </div>
        <p className="mb-3 px-3 text-xs font-medium tracking-wide">{t("workspace")}</p>
        <nav aria-label={t("navigation")} className="grid gap-1">
          {[...NAV, { to: "/einstellungen", label: tr("Einstellungen"), icon: Settings } as const].map((n) => (
            <Link
              key={n.to}
              to={n.to}
              activeOptions={{ exact: n.to === "/" }}
              className="flex min-h-11 items-center gap-3 rounded-lg border-l-2 border-transparent px-3 py-2 text-sm transition-colors hover:bg-sidebar-accent"
              activeProps={{ className: "bg-sidebar-accent text-sidebar-accent-foreground font-semibold", style: { borderLeftColor: "var(--primary)" } }}
            >
              <n.icon className="h-4 w-4" /> {n.label}
            </Link>
          ))}
        </nav>
        {project && (
          <button
            type="button"
            aria-label={t("editProject")}
            onClick={() => setProjectOpen(true)}
            className="mt-auto flex w-full shrink-0 items-start gap-3 rounded-lg border border-sidebar-border p-3 text-left text-sm transition-colors hover:bg-sidebar-accent"
          >
            <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
              <span className="block font-medium text-sidebar-accent-foreground">{project.name}</span>
              {project.address && <span className="mt-1 block text-xs">{project.address}</span>}
            </span>
            <Pencil className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          </button>
        )}
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex min-h-16 items-center justify-between gap-3 border-b bg-sidebar px-4 md:px-8">
          <div className="min-w-0">
            <span className="flex items-center gap-2 font-semibold md:hidden"><Hammer className="h-5 w-5 text-primary" />{tr("Bauplan")}</span>
            <span className="hidden truncate text-sm text-muted-foreground md:block">{project?.name ?? t("workspace")}</span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <AppearanceModeMenu />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" aria-label={t("accountMenu")} className="gap-2 px-3">
                  <UserRound className="h-5 w-5" />
                  <span className="hidden max-w-40 truncate text-sm md:block">{auth.user?.name || auth.user?.email}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {project && <DropdownMenuItem className="min-h-11" onSelect={() => setProjectOpen(true)}><Pencil />{t("editProject")}</DropdownMenuItem>}
                <DropdownMenuItem asChild className="min-h-11"><Link to="/einstellungen"><Settings />{tr("Einstellungen")}</Link></DropdownMenuItem>
                <DropdownMenuItem className="min-h-11" onSelect={() => void signOut()}><LogOut />{tr("Abmelden")}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main id="main-content" tabIndex={-1} className="min-w-0 px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-6 md:px-8 md:pb-10 md:pt-8">
          <div className="mx-auto min-w-0 max-w-7xl">
            {isLoading ? <p className="text-sm text-muted-foreground">{tr("Lädt…")}</p> : project ? <Outlet /> : <ProjectSetup />}
          </div>
        </main>
      </div>

      <nav aria-label={t("navigation")} className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t bg-card pb-[env(safe-area-inset-bottom)] md:hidden">
        {primaryNav.map((n) => (
          <Link
            key={n.to}
            to={n.to}
            activeOptions={{ exact: n.to === "/" }}
            className="flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 px-0.5 py-2 text-xs text-muted-foreground"
            activeProps={{ className: "bg-accent text-accent-foreground font-semibold" }}
          >
            <n.icon className="h-5 w-5" /> {n.label}
          </Link>
        ))}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className={cn("flex min-h-16 flex-col items-center justify-center gap-1 py-2 text-xs text-muted-foreground", moreActive && "font-medium text-primary")}>
              <MoreHorizontal className="h-5 w-5" />{t("more")}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" sideOffset={12}>
            {[...secondaryNav, { to: "/einstellungen", label: tr("Einstellungen"), icon: Settings } as const].map((n) => (
              <DropdownMenuItem asChild key={n.to} className="min-h-11">
                <Link to={n.to}><n.icon />{n.label}</Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </nav>
      {project && <ProjectDialog project={project} open={projectOpen} onOpenChange={setProjectOpen} />}
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
