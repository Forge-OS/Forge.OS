import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const rawBase = process.env.VITE_BASE_PATH || "./";
const base = rawBase.endsWith("/") ? rawBase : `${rawBase}/`;

export default defineConfig({
  base,
  plugins: [react()],
  build: {
    manifest: "manifest.json",
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if(!id.includes("node_modules")) return undefined;
          if(id.includes("recharts") || id.includes("victory-vendor") || id.includes("d3-")) return "charts-vendor";
          return undefined;
        },
      },
    },
  },
});
