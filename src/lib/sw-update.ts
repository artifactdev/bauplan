let updateReady = false;
const listeners = new Set<() => void>();

export function markUpdateReady() {
  if (updateReady) return;
  updateReady = true;
  listeners.forEach((l) => l());
}
export function subscribeUpdateReady(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export const getUpdateReady = () => updateReady;

const RELOAD_KEY = "bauplan:update-reload";
const RELOAD_GUARD_MS = 30_000;
const UPDATE_CHECK_MS = 30 * 60_000;

/** Errors thrown when a lazily loaded route chunk from an older deployment no longer exists. */
export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error ?? "");
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|ChunkLoadError|Unable to preload CSS/i.test(
    message,
  );
}

/** Reloads to pick up the current deployment; at most once per 30 s so a real outage cannot loop. */
export function reloadForUpdate(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
    if (Date.now() - last < RELOAD_GUARD_MS) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    // Storage may be unavailable (private mode); reloading once is still better than a broken page.
  }
  window.location.reload();
  return true;
}

/**
 * Registers the service worker and keeps the open app in step with deployments.
 * The worker activates immediately (skipWaiting); once it takes control, the page still runs
 * the old bundle, so it reloads at once when hidden or lets the user reload via `onUpdateReady`.
 */
export function registerServiceWorker({
  onUpdateReady,
  onError,
}: {
  onUpdateReady: () => void;
  onError: (error: unknown) => void;
}): () => void {
  const sw = navigator.serviceWorker;
  const hadController = Boolean(sw.controller);
  let registration: ServiceWorkerRegistration | undefined;
  let notified = false;

  const onControllerChange = () => {
    if (!hadController || notified) return;
    notified = true;
    if (document.visibilityState === "hidden") reloadForUpdate();
    else onUpdateReady();
  };
  const checkForUpdate = () => {
    if (navigator.onLine) void registration?.update().catch(() => {});
  };
  const onVisible = () => {
    if (document.visibilityState === "visible") checkForUpdate();
  };
  const onPreloadError = (event: Event) => {
    if (reloadForUpdate()) event.preventDefault();
  };

  sw.addEventListener("controllerchange", onControllerChange);
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("vite:preloadError", onPreloadError);
  const timer = window.setInterval(checkForUpdate, UPDATE_CHECK_MS);
  sw.register("/sw.js", { scope: "/", updateViaCache: "none" })
    .then((reg) => {
      registration = reg;
    })
    .catch(onError);

  return () => {
    sw.removeEventListener("controllerchange", onControllerChange);
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("vite:preloadError", onPreloadError);
    window.clearInterval(timer);
  };
}
