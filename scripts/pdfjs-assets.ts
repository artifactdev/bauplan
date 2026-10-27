import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import type { Plugin } from "vite";

/** Serve PDF.js's supporting files locally, with the same URLs in dev and production. */
export function pdfjsAssets(): Plugin {
  const require = createRequire(import.meta.url);
  const directory = dirname(require.resolve("pdfjs-dist/package.json"));
  const { version } = require("pdfjs-dist/package.json") as { version: string };
  const prefix = `/pdfjs/${version}/`;
  const files = new Map<string, string>();
  return {
    name: "pdfjs-assets",
    async config() {
      for (const folder of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
        for (const name of await readdir(resolve(directory, folder))) {
          files.set(`${prefix}${folder}/${name}`, resolve(directory, folder, name));
        }
      }
      return { define: { __PDFJS_ASSET_BASE__: JSON.stringify(prefix) } };
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = files.get((request.url ?? "").split("?")[0]!);
        if (!path) return next();
        void readFile(path).then((data) => {
          response.setHeader(
            "Content-Type",
            path.endsWith(".wasm")
              ? "application/wasm"
              : path.endsWith(".js")
                ? "text/javascript"
                : "application/octet-stream",
          );
          response.end(data);
        }, next);
      });
    },
    async generateBundle() {
      for (const [url, path] of files) {
        this.emitFile({ type: "asset", fileName: url.slice(1), source: await readFile(path) });
      }
    },
  };
}
