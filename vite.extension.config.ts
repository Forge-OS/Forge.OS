import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import webExtension from "vite-plugin-web-extension";
import { resolve } from "path";

const browser = process.env.TARGET_BROWSER || "chrome";
const ext = (p: string) => resolve(__dirname, "extension", p);

export default defineConfig({
  // Keep root at the project level so rollup resolves all imports from here.
  plugins: [
    react(),
    webExtension({
      // Provide manifest as a function returning an object so all entry paths
      // can be absolute — avoids CWD-relative resolution issues in sub-builds.
      manifest: () => ({
        manifest_version: 3,
        name: "Forge-OS",
        version: "1.0.0",
        description: "Kaspa AI trading agents — wallet balance, send, receive, and agent monitoring.",
        action: {
          default_popup: "extension/popup/index.html",
          default_icon: { "16": "extension/icons/icon16.png", "48": "extension/icons/icon48.png", "128": "extension/icons/icon128.png" },
        },
        icons: { "16": "extension/icons/icon16.png", "48": "extension/icons/icon48.png", "128": "extension/icons/icon128.png" },
        background: { service_worker: "extension/background/service-worker.ts", type: "module" },
        content_scripts: [{
          matches: ["*://forgeos.xyz/*", "*://www.forgeos.xyz/*", "*://localhost/*"],
          js: ["extension/content/site-bridge.ts"],
          run_at: "document_idle",
        }],
        permissions: ["storage", "alarms", "clipboardWrite"],
        host_permissions: ["https://api.kaspa.org/*", "https://api-tn10.kaspa.org/*"],
      }),
      browser,
      // Prevent sub-builds from loading the main vite.config.ts (manualChunks
      // is incompatible with service worker inlineDynamicImports).
      // Also direct all sub-build outputs to dist-extension/.
      scriptViteConfig: {
        configFile: false,
        resolve: { alias: { "../../src": resolve(__dirname, "src") } },
        build: { outDir: resolve(__dirname, "dist-extension") },
      },
      htmlViteConfig: {
        configFile: false,
        resolve: { alias: { "../../src": resolve(__dirname, "src") } },
        build: { outDir: resolve(__dirname, "dist-extension") },
      },
    }),
  ],
  resolve: {
    alias: { "../../src": resolve(__dirname, "src") },
  },
  build: {
    outDir: resolve(__dirname, "dist-extension"),
    emptyOutDir: true,
    sourcemap: false,
    // Explicitly clear manualChunks so it doesn't conflict with the service
    // worker sub-build which requires inlineDynamicImports.
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },
});
