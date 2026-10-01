import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "./",
  build: {
    rolldownOptions: { input: { website: "index.html", app: "app.html" } },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["favicon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Emir Cards – Dein Lernraum",
        short_name: "Emir Cards",
        description:
          "Dein Wissen. In deinem Tempo. Karteikarten, die bei dir bleiben.",
        lang: "de",
        id: "./",
        start_url: "./app.html",
        scope: "./",
        display: "standalone",
        theme_color: "#254d42",
        background_color: "#f6f7f4",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          {
            src: "icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "icon-maskable.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  test: {
    include: ["src/**/*.test.ts"],
    setupFiles: ["src/test-setup.ts"],
    environment: "node",
  },
});
