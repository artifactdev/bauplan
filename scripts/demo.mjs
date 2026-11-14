#!/usr/bin/env node
// Starts the dev server against the local demo database (see scripts/demo-seed.mjs).
//
//   npm run demo
//
// The demo data lives in .demo/ and is not part of the repository.
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const env = {
  ...process.env,
  DATA_DIR: process.env.DATA_DIR ?? path.join(root, ".demo", "data"),
  UPLOADS_DIR: process.env.UPLOADS_DIR ?? path.join(root, ".demo", "uploads"),
};
mkdirSync(env.DATA_DIR, { recursive: true });
mkdirSync(env.UPLOADS_DIR, { recursive: true });

const seed = spawnSync(
  process.execPath,
  ["node_modules/tsx/dist/cli.mjs", "scripts/demo-seed.mjs"],
  {
    stdio: "inherit",
    env,
  },
);
if (seed.status !== 0) process.exit(seed.status ?? 1);

const dev = spawn("npm", ["run", "dev"], { stdio: "inherit", env });
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => dev.kill(signal));
}
dev.on("exit", (code) => process.exit(code ?? 0));
