import { definePlugin } from "nitro";
import { getSqliteDb } from "../repo";
import { wakePush } from "../push";

// Module initialization must finish before Nitro starts listening, not in an async plugin callback.
await getSqliteDb();

export default definePlugin((app) => {
  const timer = setInterval(wakePush, 30_000);
  timer.unref();
  wakePush();
  app.hooks.hook("close", () => {
    clearInterval(timer);
  });
});
