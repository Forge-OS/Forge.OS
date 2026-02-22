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
    chunkSizeWarningLimit: 450,
    // Keep prior hashed assets in dist for safer GitHub Pages cache rollover.
    emptyOutDir: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;

          if (
            id.includes("/react/") ||
            id.includes("/react-dom/") ||
            id.includes("/scheduler/")
          ) {
            return "react-vendor";
          }

          if (id.includes("recharts") || id.includes("victory-vendor")) {
            return "recharts-vendor";
          }

          if (id.includes("/d3-")) {
            if (
              id.includes("/d3-scale") ||
              id.includes("/d3-array") ||
              id.includes("/d3-format") ||
              id.includes("/d3-time") ||
              id.includes("/d3-time-format")
            ) {
              return "d3-scale-vendor";
            }
            if (
              id.includes("/d3-shape") ||
              id.includes("/d3-path") ||
              id.includes("/d3-interpolate") ||
              id.includes("/d3-color")
            ) {
              return "d3-render-vendor";
            }
            return "d3-vendor";
          }

          return undefined;
        },
      },
    },
  },
});
