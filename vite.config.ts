import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import nodepod from "@scelar/nodepod/vite";
import { defineConfig } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));
const crossOriginHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "credentialless",
  "X-Content-Type-Options": "nosniff",
};

export default defineConfig({
  plugins: [react(), nodepod()],
  resolve: {
    alias: { "@": path.resolve(root, "src") },
  },
  server: {
    headers: crossOriginHeaders,
    proxy: {
      // Production uses relay-deno/main.ts. Mirror that same-origin route in
      // local development so the Deploy button is testable under `npm run dev`.
      "/api/cloudflare": {
        target: "https://api.cloudflare.com",
        changeOrigin: true,
        rewrite: (requestPath) => requestPath.replace(/^\/api\/cloudflare/, ""),
      },
    },
  },
  preview: { headers: crossOriginHeaders },
  build: {
    target: "es2022",
    outDir: "dist",
  },
});
