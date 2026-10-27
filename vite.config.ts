import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { nitro } from "nitro/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  optimizeDeps: {
    exclude: ["@napi-rs/canvas"],
  },
  plugins: [
    tanstackStart({
      server: { entry: "server" },
    }),
    nitro({ preset: "node-server" }),
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
        additionalManifestEntries: [{ url: "/", revision: null }],
        navigateFallback: "/",
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  resolve: { tsconfigPaths: true },
});
