import { tr } from "@/i18n";
import { createFileRoute, Link, Outlet, redirect, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { version as appVersion } from "../../../package.json";
import { useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import {
  Hammer,
  Settings,
  MoreHorizontal,
  UserRound,
  LogOut,
  Pencil,
  RefreshCw,
  Wifi,
  WifiOff,
  Download,
  Info,
  CircleArrowUp,
} from "lucide-react";
import { getBackendInfo, getWorkspaceSyncGeneration } from "@/lib/data.functions";
import { getAuthState, logoutLocal } from "@/lib/auth.functions";
import { useMutations, useOfflineSync, useWorkspace } from "@/hooks/use-workspace";
import {
  clearAccountData,
  clearOfflineAccount,
  clearPendingOfflineLogout,
  getOfflineAccount,
  hasPendingOfflineLogout,
  listChanges,
  listUploads,
  requestOfflineLogout,
  setOfflineAccount,
} from "@/lib/offline-store";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { getUpdateReady, subscribeUpdateReady } from "@/lib/sw-update";
import { AccountAppearance } from "@/components/app/AppearanceProvider";
import { AppearanceModeMenu } from "@/components/app/AppearanceControls";
import { ProjectDialog } from "@/components/app/ProjectDialog";
import { navigationItem } from "@/components/app/navigation-items";
import { DEFAULT_NAVIGATION, visibleNavigation } from "@/lib/navigation";
import { useNavigation } from "@/hooks/use-navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

export const Route = createFileRoute("/_ws")({
  ssr: false,
  beforeLoad: async () => {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      const account = getOfflineAccount();
      if (!account) throw redirect({ to: "/auth" });
      return {
        backend: { dataDir: "", uploadsDir: "" },
        auth: { needsSetup: false, user: account, oidc: { enabled: false, label: "" } },
      };
    }
    if (hasPendingOfflineLogout()) {
      await logoutLocal();
      clearPendingOfflineLogout();
    }
    const [info, auth] = await Promise.all([getBackendInfo(), getAuthState()]);
    if (auth.needsSetup) {
      clearOfflineAccount();
      throw redirect({ to: "/setup" });
    }
    if (!auth.user) {
      clearOfflineAccount();
      throw redirect({ to: "/auth" });
    }
    if (auth.user.role === "admin" || auth.user.role === "member") {
      const syncGeneration = await getWorkspaceSyncGeneration();
      setOfflineAccount({
        id: auth.user.id,
        email: auth.user.email,
        name: auth.user.name,
        role: auth.user.role,
        syncGeneration,
      });
    }
    return { backend: info, auth };
  },
  component: Layout,
  pendingComponent: () => <div className="p-10 text-sm text-muted-foreground">{tr("shared.loading")}</div>,
});

export async function signOut(userId = getOfflineAccount()?.id) {
  try {
    const [changes, uploads] = userId
      ? await Promise.all([listChanges(userId), listUploads(userId)])
      : [[], []];
    if (changes.length + uploads.length > 0) {
      if (
        !window.confirm(
          tr("route.unsynchronized_changes_discard_sign"),
        )
      )
        return;
    }
    if (navigator.onLine) {
      await logoutLocal();
      clearPendingOfflineLogout();
    } else {
      requestOfflineLogout();
    }
    if (userId) await clearAccountData(userId);
    clearOfflineAccount();
    window.location.href = "/auth";
  } catch (error) {
    toast.error(
      error instanceof Error
        ? error.message
        : tr("shared.not_complete_sign_out"),
    );
  }
}

function Layout() {
  const { auth } = Route.useRouteContext();
  if (auth.user?.role === "pending") return <Pending email={auth.user.email} />;
  return (
    <AccountAppearance key={auth.user!.id} userId={auth.user!.id}>
      <Shell />
    </AccountAppearance>
  );
}

function Pending({ email }: { email: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-md rounded-xl border bg-card p-6 text-center shadow-card">
        <Hammer className="mx-auto h-8 w-8 text-primary" />
        <h1 className="mt-3 text-2xl font-semibold">{tr("route.waiting_approval")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Du bist als {email} angemeldet. Ein Admin muss dein Konto in den Einstellungen
          freischalten, bevor du das Projekt sehen kannst.
        </p>
        <Button variant="outline" className="mt-5" onClick={() => signOut()}>
          {tr("shared.sign_out")}
        </Button>
      </div>
    </div>
  );
}

function Shell() {
  const { t } = useTranslation("shell");
  const { auth } = Route.useRouteContext();
  const workspace = useWorkspace();
  const { ws, isLoading } = workspace;
  const sync = useOfflineSync(auth.user!.id);
  const updateReady = useSyncExternalStore(subscribeUpdateReady, getUpdateReady, () => false);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const project = ws.projects[0];
  const [projectOpen, setProjectOpen] = useState(false);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const navigation = useNavigation(auth.user!.id);
  const items = visibleNavigation(navigation.data ?? DEFAULT_NAVIGATION).map((path) => {
    const item = navigationItem(path);
    return { ...item, label: item.label() };
  });
  const primaryNav = items.slice(0, 4);
  const secondaryNav = items.slice(4);
  const moreActive = secondaryNav.some((n) => n.to === pathname) || pathname === "/einstellungen";

  useEffect(() => {
    const onInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const onInstalled = () => setInstallPrompt(null);
    window.addEventListener("beforeinstallprompt", onInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const installApp = async () => {
    if (!installPrompt) return;
    try {
      await installPrompt.prompt();
      await installPrompt.userChoice;
      setInstallPrompt(null);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : tr("route.not_start_installation"),
      );
    }
  };

  return (
    <div className="min-h-screen md:flex">
      <a
        href="#main-content"
        className="sr-only z-50 rounded-lg bg-popover p-3 text-popover-foreground focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        {t("skip")}
      </a>
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar px-3 py-5 text-sidebar-foreground md:flex">
        <div className="mb-7 flex items-center gap-3 px-3 font-display text-lg font-semibold text-sidebar-accent-foreground">
          <img src="/app-icon.svg" alt="" className="h-9 w-9 shrink-0 rounded-[17%] dark:ring-1 dark:ring-white/15" />
          {tr("shared.bauplan")}
        </div>
        <p className="mb-3 px-3 text-xs font-medium tracking-wide">{t("workspace")}</p>
        <nav aria-label={t("navigation")} className="grid gap-1">
          {[
            ...items,
            { to: "/einstellungen", label: tr("shared.settings"), icon: Settings } as const,
          ].map((n) => (
            <Link
              key={n.to}
              to={n.to}
              activeOptions={{ exact: n.to === "/" }}
              className="flex min-h-11 items-center gap-3 rounded-lg border-l-2 border-transparent px-3 py-2 text-sm transition-colors hover:bg-sidebar-accent"
              activeProps={{
                className: "bg-sidebar-accent text-sidebar-accent-foreground font-semibold",
                style: { borderLeftColor: "var(--primary)" },
              }}
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
              <span className="block font-medium text-sidebar-accent-foreground">
                {project.name}
              </span>
              {project.address && <span className="mt-1 block text-xs">{project.address}</span>}
            </span>
            <Pencil className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          </button>
        )}
        <p className={cn("shrink-0 px-3 pt-3 text-[11px] text-muted-foreground/70", !project && "mt-auto")}>
          {t("appVersion", { version: appVersion })}
        </p>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex min-h-16 items-center justify-between gap-3 border-b bg-sidebar/60 px-4 backdrop-blur-xl md:bg-sidebar md:px-8 md:backdrop-blur-none">
          <div className="min-w-0">
            <span className="flex items-center gap-2 font-semibold md:hidden">
              <img src="/app-icon.svg" alt="" className="h-6 w-6 shrink-0 rounded-[17%] dark:ring-1 dark:ring-white/15" />
              {tr("shared.bauplan")}
            </span>
            <span className="hidden truncate text-sm text-muted-foreground md:block">
              {project?.name ?? t("workspace")}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {updateReady && (
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("updateAvailable")}
                title={t("updateAvailable")}
                onClick={() => window.location.reload()}
                className="text-primary"
              >
                <CircleArrowUp className="h-5 w-5" />
              </Button>
            )}
            <div
              className="flex items-center gap-1 text-xs text-muted-foreground"
              role="status"
              aria-live="polite"
            >
              {sync.online ? (
                <Wifi className="h-4 w-4" aria-hidden="true" />
              ) : (
                <WifiOff className="h-4 w-4" aria-hidden="true" />
              )}
              <span className="hidden sm:inline">{sync.online ? t("online") : t("offline")}</span>
              {sync.pending > 0 && <span>{t("pendingSync", { count: sync.pending })}</span>}
            </div>
            {sync.online && sync.pending > 0 && (
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("syncNow")}
                onClick={() => void sync.sync()}
                disabled={sync.syncing}
              >
                <RefreshCw className={cn("h-4 w-4", sync.syncing && "animate-spin")} />
              </Button>
            )}
            {installPrompt && (
              <Button variant="outline" size="sm" onClick={() => void installApp()}>
                <Download className="h-4 w-4" />
                <span className="hidden sm:inline">{t("installApp")}</span>
              </Button>
            )}
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={t("appInfo")} className="md:hidden">
                  <Info className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-auto px-3 py-2 text-sm">
                {t("appVersion", { version: appVersion })}
              </PopoverContent>
            </Popover>
            <AppearanceModeMenu />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" aria-label={t("accountMenu")} className="gap-2 px-3">
                  <UserRound className="h-5 w-5" />
                  <span className="hidden max-w-40 truncate text-sm md:block">
                    {auth.user?.name || auth.user?.email}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {project && (
                  <DropdownMenuItem className="min-h-11" onSelect={() => setProjectOpen(true)}>
                    <Pencil />
                    {t("editProject")}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem asChild className="min-h-11">
                  <Link to="/einstellungen">
                    <Settings />
                    {tr("shared.settings")}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem className="min-h-11" onSelect={() => void signOut(auth.user!.id)}>
                  <LogOut />
                  {tr("shared.sign_out")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main
          id="main-content"
          tabIndex={-1}
          className="min-w-0 px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-6 md:px-8 md:pb-10 md:pt-8"
        >
          <div className="mx-auto min-w-0 max-w-7xl">
            {sync.conflicts.length > 0 && (
              <section
                className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3"
                aria-label={t("syncConflicts", { count: sync.conflicts.length })}
              >
                <div className="mr-auto">
                  <p className="text-sm font-medium text-destructive">
                    {t("syncConflicts", { count: sync.conflicts.length })}
                  </p>
                  <p className="text-xs text-muted-foreground">{t("syncConflictExplanation")}</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void sync.resolveConflict(false)}
                >
                  {t("useServerVersion")}
                </Button>
                <Button variant="outline" size="sm" onClick={() => void sync.resolveConflict(true)}>
                  {t("keepOfflineChanges")}
                </Button>
              </section>
            )}
            {navigation.isError && sync.online && (
              <p role="alert" className="mb-4 text-sm">
                {t("navigationLoadError")}{" "}
                <Button variant="outline" size="sm" onClick={() => void navigation.refetch()}>
                  {t("retry")}
                </Button>
              </p>
            )}
            {isLoading ? (
              <p className="text-sm text-muted-foreground">{tr("shared.loading")}</p>
            ) : workspace.isError && !workspace.data ? (
              <p role="alert" className="text-sm text-muted-foreground">
                {t("workspaceUnavailable")}{" "}
                <Button variant="outline" size="sm" onClick={() => void workspace.refetch()}>
                  {t("retry")}
                </Button>
              </p>
            ) : project ? (
              <Outlet />
            ) : (
              <ProjectSetup />
            )}
          </div>
        </main>
      </div>

      <nav
        aria-label={t("navigation")}
        className="fixed inset-x-0 bottom-0 z-30 grid gap-1 border-t bg-card/60 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-1 shadow-card backdrop-blur-xl md:hidden"
        style={{
          gridTemplateColumns: `repeat(${primaryNav.length + 1}, minmax(0, 1fr))`,
        }}
      >
        {primaryNav.map((n) => (
          <Link
            key={n.to}
            to={n.to}
            activeOptions={{ exact: n.to === "/" }}
            className="flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 rounded-lg px-0.5 py-2 text-xs text-muted-foreground transition-colors"
            activeProps={{ className: "bg-primary/10 text-primary font-semibold" }}
          >
            <n.icon className="h-5 w-5" /> {n.label}
          </Link>
        ))}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className={cn(
                "flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 rounded-lg px-0.5 py-2 text-xs text-muted-foreground transition-colors",
                moreActive && "bg-primary/10 font-semibold text-primary",
              )}
            >
              <MoreHorizontal className="h-5 w-5" />
              {t("more")}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" sideOffset={12}>
            {[
              ...secondaryNav,
              { to: "/einstellungen", label: tr("shared.settings"), icon: Settings } as const,
            ].map((n) => (
              <DropdownMenuItem asChild key={n.to} className="min-h-11">
                <Link to={n.to}>
                  <n.icon />
                  {n.label}
                </Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </nav>
      {project && (
        <ProjectDialog project={project} open={projectOpen} onOpenChange={setProjectOpen} />
      )}
    </div>
  );
}

function ProjectSetup() {
  const { create } = useMutations();
  const [name, setName] = useState("");
  const [budget, setBudget] = useState("");
  return (
    <div className="mx-auto mt-10 max-w-md rounded-xl border bg-card p-6 shadow-card">
      <h1 className="text-2xl font-semibold">{tr("route.create_project")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {tr("route.just_two_details_add")}
      </p>
      <form
        className="mt-6 grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate({
            table: "projects",
            row: { name: name || "Mein Renovierungsprojekt", total_budget: budget },
          });
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="pn">{tr("shared.project_name")}</Label>
          <Input
            id="pn"
            placeholder={tr("route.renovating_old_apartment")}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="pb">{tr("shared.total_budget_2")}</Label>
          <Input
            id="pb"
            type="number"
            required
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
          />
        </div>
        <Button type="submit" disabled={create.isPending} className={cn()}>
          {tr("route.start_project")}
        </Button>
      </form>
    </div>
  );
}
