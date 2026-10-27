// @vitest-environment node
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

function worker(hasWindow = true) {
  const handlers: Record<string, (event: unknown) => void> = {};
  const showNotification = vi.fn().mockResolvedValue(undefined);
  const navigate = vi.fn().mockResolvedValue(undefined);
  const focus = vi.fn().mockResolvedValue(undefined);
  const openWindow = vi.fn().mockResolvedValue(undefined);
  const client = { url: "https://bauplan.example/", navigate, focus };
  runInNewContext(readFileSync(new URL("../../public/push.js", import.meta.url), "utf8"), {
    URL,
    console,
    self: {
      location: { origin: "https://bauplan.example" },
      addEventListener: (type: string, handler: (event: unknown) => void) => {
        handlers[type] = handler;
      },
      registration: { showNotification },
      clients: { matchAll: vi.fn(async () => (hasWindow ? [client] : [])), openWindow },
    },
  });
  return { handlers, showNotification, navigate, focus, openWindow };
}
describe("push service worker", () => {
  for (const route of ["aufgaben", "angebote", "ausgaben", "kalender"]) {
    it(`opens ${route} with its record when no app window is open`, async () => {
      const state = worker(false);
      let task: Promise<void> | undefined;
      state.handlers["notificationclick"]!({
        notification: {
          close: vi.fn(),
          data: { url: `https://bauplan.example/${route}?eintrag=id` },
        },
        waitUntil: (promise: Promise<void>) => {
          task = promise;
        },
      });
      await task;
      expect(state.openWindow).toHaveBeenCalledWith(`https://bauplan.example/${route}?eintrag=id`);
      expect(state.navigate).not.toHaveBeenCalled();
    });
  }
  it("displays the supplied localized notification with a same-origin record link", async () => {
    const state = worker();
    let task: Promise<void> | undefined;
    state.handlers["push"]!({
      data: {
        json: () => ({
          title: "Bauplan",
          body: "Assigned",
          url: "/aufgaben?eintrag=task",
          tag: "id",
        }),
      },
      waitUntil: (promise: Promise<void>) => {
        task = promise;
      },
    });
    await task;
    expect(state.showNotification).toHaveBeenCalledWith(
      "Bauplan",
      expect.objectContaining({
        body: "Assigned",
        tag: "id",
        data: { url: "https://bauplan.example/aufgaben?eintrag=task" },
      }),
    );
  });
  it.each(["aufgaben", "angebote", "ausgaben", "kalender"])(
    "navigates and focuses an existing app window in %s",
    async (route) => {
      const state = worker();
      const close = vi.fn();
      let task: Promise<void> | undefined;
      state.handlers["notificationclick"]!({
        notification: { close, data: { url: `https://bauplan.example/${route}?eintrag=e` } },
        waitUntil: (promise: Promise<void>) => {
          task = promise;
        },
      });
      await task;
      expect(close).toHaveBeenCalledOnce();
      expect(state.navigate).toHaveBeenCalledWith(`https://bauplan.example/${route}?eintrag=e`);
      expect(state.focus).toHaveBeenCalledOnce();
      expect(state.openWindow).not.toHaveBeenCalled();
    },
  );
});
