import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { nitro } from "nitro/vite";
import { VitePWA } from "vite-plugin-pwa";
import deUi from "./src/locales/de/ui.json";
import { pdfjsAssets } from "./scripts/pdfjs-assets";

// Changes on every build so the precached HTML shell ("/") is refreshed with each deployment.
const buildId = Date.now().toString(36);

export default defineConfig({
  optimizeDeps: {
    exclude: ["@napi-rs/canvas"],
  },
  // The document scanner runs OpenCV.js in a module worker.
  worker: { format: "es" },
  plugins: [
    pdfjsAssets(),
    tanstackStart({
      server: { entry: "server" },
    }),
    nitro({
      preset: "node-server",
      plugins: ["./src/server/plugins/database.ts"],
      // tesseract.js and pdf.js locate their worker scripts and WASM/core files at runtime
      // (__dirname, dynamic imports), so they must stay unbundled packages in .output/server/node_modules.
      traceDeps: ["tesseract.js*", "tesseract.js-core*", "pdfjs-dist*", "zxing-wasm*"],
      routeRules: {
        "/sw.js": { headers: { "cache-control": "no-cache" } },
        "/share-target.js": { headers: { "cache-control": "no-cache" } },
        "/push.js": { headers: { "cache-control": "no-cache" } },
        "/manifest.webmanifest": { headers: { "cache-control": "no-cache" } },
      },
    }),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      outDir: ".output/public",
      injectRegister: false,
      includeAssets: ["favicon.ico", "app-icon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Bauplan – Renovierung im Griff",
        short_name: "Bauplan",
        description:
          "Budget, Angebote, Dokumente, Aufgaben und Termine deiner Renovierung an einem Ort.",
        lang: "de",
        theme_color: "#f8f7f4",
        background_color: "#f8f7f4",
        display: "standalone",
        start_url: "/",
        share_target: {
          action: "/share-target",
          method: "POST",
          enctype: "multipart/form-data",
          params: {
            files: [{ name: "files", accept: ["application/pdf", "image/*", ".pdf"] }],
          },
        },
        shortcuts: [
          {
            name: deUi["pwa.shortcut_new_appointment"],
            url: "/kalender?aktion=neu",
            icons: [{ src: "/app-icon-192.png", sizes: "192x192", type: "image/png" }],
          },
          {
            name: deUi["pwa.shortcut_new_task"],
            url: "/aufgaben?aktion=neu",
            icons: [{ src: "/app-icon-192.png", sizes: "192x192", type: "image/png" }],
          },
          {
            name: deUi["pwa.shortcut_scan_receipt"],
            url: "/dokumente?aktion=neu",
            icons: [{ src: "/app-icon-192.png", sizes: "192x192", type: "image/png" }],
          },
          {
            name: deUi["pwa.shortcut_record_expense"],
            url: "/ausgaben?aktion=neu",
            icons: [{ src: "/app-icon-192.png", sizes: "192x192", type: "image/png" }],
          },
        ],
        icons: [
          { src: "/app-icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          { src: "/app-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/app-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          {
            src: "/app-icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        importScripts: ["/share-target.js", "/push.js"],
        skipWaiting: true,
        clientsClaim: true,
        globDirectory: ".output/public",
        globPatterns: ["**/*.{js,css,html,ico,svg,png,woff2}"],
        // Large processing workers and PDF resources are cached as used, not at installation.
        globIgnores: ["**/scan.worker-*.js", "pdfjs/**", "**/pdf.worker*.mjs"],
        runtimeCaching: [
          {
            urlPattern: ({ url }) =>
              /\/pdfjs\//.test(url.pathname) ||
              /\/assets\/pdf\.worker(?:\.min)?-[\w-]+\.mjs$/.test(url.pathname),
            handler: "CacheFirst",
            options: {
              cacheName: "bauplan-pdf-reader",
              expiration: { maxEntries: 250 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            urlPattern: ({ url }) => /\/assets\/scan\.worker-[\w-]+\.js$/.test(url.pathname),
            handler: "CacheFirst",
            options: {
              cacheName: "bauplan-scanner",
              expiration: { maxEntries: 2 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
        additionalManifestEntries: [{ url: "/", revision: buildId }],
        navigateFallback: "/",
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  resolve: { tsconfigPaths: true },
});
