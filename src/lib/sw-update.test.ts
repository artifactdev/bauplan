import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getUpdateReady,
  isChunkLoadError,
  markUpdateReady,
  registerServiceWorker,
  reloadForUpdate,
  subscribeUpdateReady,
} from "./sw-update";

const reload = vi.fn();

beforeEach(() => {
  sessionStorage.clear();
  reload.mockReset();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, reload },
  });
});

describe("isChunkLoadError", () => {
  it.each([
    "Failed to fetch dynamically imported module: https://x/assets/a-1.js",
    "error loading dynamically imported module",
    "Importing a module script failed.",
  ])("detects %s", (message) => {
    expect(isChunkLoadError(new TypeError(message))).toBe(true);
  });

  it("ignores other errors", () => {
    expect(isChunkLoadError(new Error("Network down"))).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
  });
});

describe("update-ready store", () => {
  it("notifies subscribers once when an update is ready", () => {
    const listener = vi.fn();
    const stop = subscribeUpdateReady(listener);
    expect(getUpdateReady()).toBe(false);
    markUpdateReady();
    markUpdateReady();
    expect(getUpdateReady()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
  });
});

describe("reloadForUpdate", () => {
  it("reloads once and then guards against reload loops", () => {
    expect(reloadForUpdate()).toBe(true);
    expect(reloadForUpdate()).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe("registerServiceWorker", () => {
  let sw: EventTarget & { controller: unknown; register: ReturnType<typeof vi.fn> };
  let update: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    update = vi.fn().mockResolvedValue(undefined);
    sw = Object.assign(new EventTarget(), {
      controller: {},
      register: vi.fn().mockResolvedValue({ update }),
    });
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: sw });
  });
  afterEach(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  });

  it("offers a reload when a new worker takes over a visible page", async () => {
    const onUpdateReady = vi.fn();
    const stop = registerServiceWorker({ onUpdateReady, onError: vi.fn() });
    await Promise.resolve();
    expect(sw.register).toHaveBeenCalledWith("/sw.js", { scope: "/", updateViaCache: "none" });

    sw.dispatchEvent(new Event("controllerchange"));
    sw.dispatchEvent(new Event("controllerchange"));
    expect(onUpdateReady).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
    stop();
  });

  it("offers an update without reloading and losing drafts in the background", () => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    const onUpdateReady = vi.fn();
    const stop = registerServiceWorker({ onUpdateReady, onError: vi.fn() });
    sw.dispatchEvent(new Event("controllerchange"));
    expect(reload).not.toHaveBeenCalled();
    expect(onUpdateReady).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(reload).not.toHaveBeenCalled();
    stop();
  });

  it("does nothing on the first install", () => {
    sw.controller = null;
    const onUpdateReady = vi.fn();
    const stop = registerServiceWorker({ onUpdateReady, onError: vi.fn() });
    sw.dispatchEvent(new Event("controllerchange"));
    expect(onUpdateReady).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    stop();
  });

  it("checks for updates when the app comes back to the foreground", async () => {
    const stop = registerServiceWorker({ onUpdateReady: vi.fn(), onError: vi.fn() });
    await Promise.resolve();
    await Promise.resolve();
    document.dispatchEvent(new Event("visibilitychange"));
    expect(update).toHaveBeenCalled();
    stop();
  });

  it("reloads on a failed chunk preload", () => {
    const stop = registerServiceWorker({ onUpdateReady: vi.fn(), onError: vi.fn() });
    const event = new Event("vite:preloadError", { cancelable: true });
    window.dispatchEvent(event);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    stop();
  });
});
