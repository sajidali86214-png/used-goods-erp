import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon-180.png"],
      manifest: {
        name: "Used Goods ERP",
        short_name: "UG ERP",
        description: "Inventory, purchasing, sales and finance for the used clothing & bags business.",
        theme_color: "#2563eb",
        background_color: "#f5f6f8",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Cache the app shell; API calls (/auth, /products, etc.) always hit
        // the network — this is an installable UI, not an offline-first app.
        globPatterns: ["**/*.{js,css,html,png,svg}"],
        navigateFallbackDenylist: [/^\/(auth|products|suppliers|sales|customers|purchasing|stock|settings|reports|users|audit-events|imports|finance)\//],
      },
      devOptions: { enabled: true },
    }),
  ],
  server: { port: 5173, host: true }, // host: true binds to the LAN, not just localhost, so a phone on the same wifi can reach it
});
