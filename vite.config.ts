import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { nitro } from "nitro/vite";
import { VitePWA } from "vite-plugin-pwa";

// Changes on every build so the precached HTML shell ("/") is refreshed with each deployment.
const buildId = Date.now().toString(36);

export default defineConfig({
  optimizeDeps: {
    exclude: ["@napi-rs/canvas"],
  },
  // The document scanner runs OpenCV.js in a module worker.
  worker: { format: "es" },
  plugins: [
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
        icons: [
          { src: "/app-icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          { src: "/app-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/app-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/app-icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        globDirectory: ".output/public",
        globPatterns: ["**/*.{js,css,html,ico,svg,png,woff2}"],
        // OpenCV.js (≈ 15 MB) is not precached for every install; it is cached on the first scan instead.
        globIgnores: ["**/scan.worker-*.js"],
        runtimeCaching: [
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
