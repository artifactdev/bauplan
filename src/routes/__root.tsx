import { tr } from "@/i18n";
import "@/i18n";
import { syncClientLanguage } from "@/i18n";
import { useTranslation } from "react-i18next";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { toast } from "sonner";
import { logoutLocal } from "@/lib/auth.functions";
import { clearPendingOfflineLogout, hasPendingOfflineLogout } from "@/lib/offline-store";
import { isChunkLoadError, markUpdateReady, registerServiceWorker, reloadForUpdate } from "@/lib/sw-update";

import appCss from "../styles.css?url";
import { Toaster } from "@/components/ui/sonner";
import { AppearanceProvider, useAppearance } from "@/components/app/AppearanceProvider";
import { appearanceBootstrap } from "@/lib/appearance";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">{tr("app.page_not_found")}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {tr("app.page_looking_not_exist")}
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {tr("app.go_home")}
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  // A route chunk from the previous deployment is gone; reload to get the current one.
  useEffect(() => {
    if (isChunkLoadError(error)) reloadForUpdate();
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {tr("app.page_failed_load")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {tr("app.something_went_wrong_end")}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {tr("shared.try_again")}
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            {tr("app.go_home")}
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: tr("app.bauplan_renovation_under_control") },
      {
        name: "description",
        content: tr(
          "app.budget_quotes_documents_tasks",
        ),
      },
      { name: "theme-color", content: "#f8f7f4" },
      { property: "og:title", content: tr("app.bauplan_renovation_under_control") },
      {
        property: "og:description",
        content: tr(
          "app.budget_quotes_documents_tasks",
        ),
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico", sizes: "48x48" },
      { rel: "icon", href: "/app-icon.svg", type: "image/svg+xml" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "manifest", href: "/manifest.webmanifest" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="de" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: appearanceBootstrap }} />
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const { i18n: i18nInst } = useTranslation();

  useEffect(() => {
    syncClientLanguage();
  }, []);
  useEffect(() => {
    const finishOfflineLogout = async () => {
      if (!navigator.onLine || !hasPendingOfflineLogout()) return;
      try {
        await logoutLocal();
        clearPendingOfflineLogout();
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : tr("shared.not_complete_sign_out"),
        );
      }
    };
    window.addEventListener("online", finishOfflineLogout);
    void finishOfflineLogout();
    return () => window.removeEventListener("online", finishOfflineLogout);
  }, []);
  useEffect(() => {
    // sw.js is only generated by `vite build`; the dev server has none.
    if (import.meta.env.DEV || !("serviceWorker" in navigator)) return;
    return registerServiceWorker({
      onUpdateReady: markUpdateReady,
      onError: (error) => {
        console.error("Could not register the PWA service worker", error);
        toast.error(tr("app.not_enable_offline_support"));
      },
    });
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <AppearanceProvider>
        <Outlet key={i18nInst.language} />
        <AppearanceToaster />
      </AppearanceProvider>
    </QueryClientProvider>
  );
}

function AppearanceToaster() {
  const { resolvedMode } = useAppearance();
  return <Toaster theme={resolvedMode} richColors position="top-center" />;
}
