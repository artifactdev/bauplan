import { definePlugin } from "nitro";
import { getSqliteDb } from "../repo";
import { wakePush } from "../push";
import { startPaperless, stopPaperless, wakePaperless } from "../paperless";

// Module initialization must finish before Nitro starts listening, not in an async plugin callback.
await getSqliteDb();
await startPaperless();

export default definePlugin((app) => {
  const timer = setInterval(wakePush, 30_000);
  const paperlessTimer = setInterval(wakePaperless, 15_000);
  paperlessTimer.unref();
  timer.unref();
  wakePush();
  app.hooks.hook("close", () => {
    clearInterval(timer);
    clearInterval(paperlessTimer);
    return stopPaperless();
  });
});
