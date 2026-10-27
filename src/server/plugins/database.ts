import { definePlugin } from "nitro";
import { getSqliteDb } from "../repo";

// Module initialization must finish before Nitro starts listening, not in an async plugin callback.
await getSqliteDb();

export default definePlugin(() => {});
