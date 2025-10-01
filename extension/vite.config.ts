import { defineConfig } from "vite";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.json" with { type: "json" };

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  build: {
    target: "chrome114",
    rollupOptions: {
      input: {
        onboarding: resolve(__dirname, "src/onboarding/index.html")
      }
    }
  }
});
