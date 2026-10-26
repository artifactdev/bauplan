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

import appCss from "../styles.css?url";
import { Toaster } from "@/components/ui/sonner";
import { AppearanceProvider, useAppearance } from "@/components/app/AppearanceProvider";
import { appearanceBootstrap } from "@/lib/appearance";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">{tr("Page not found")}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {tr("The page you're looking for doesn't exist or has been moved.")}
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {tr("Go home")}
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {tr("This page didn't load")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {tr("Something went wrong on our end. You can try refreshing or head back home.")}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {tr("Try again")}
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            {tr("Go home")}
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
      { title: tr("Bauplan – Renovierung im Griff") },
      {
        name: "description",
        content: tr(
          "Budget, Angebote, Dokumente, Aufgaben und Termine deiner Renovierung an einem Ort.",
        ),
      },
      { name: "theme-color", content: "#f8f7f4" },
      { property: "og:title", content: tr("Bauplan – Renovierung im Griff") },
      {
        property: "og:description",
        content: tr(
          "Budget, Angebote, Dokumente, Aufgaben und Termine deiner Renovierung an einem Ort.",
        ),
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
      { rel: "apple-touch-icon", href: "/pwa-icon.png" },
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
            : tr("Die Abmeldung konnte nicht abgeschlossen werden."),
        );
      }
    };
    window.addEventListener("online", finishOfflineLogout);
    void finishOfflineLogout();
    return () => window.removeEventListener("online", finishOfflineLogout);
  }, []);
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    void navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .catch((error: unknown) => {
        console.error("Could not register the PWA service worker", error);
        toast.error(tr("Die Offline-Funktion konnte nicht aktiviert werden."));
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
