import { existsSync, readFileSync } from "node:fs";

const requiredFiles = [
  "dist/index.html",
  "dist/.vite/manifest.json",
];

for(const file of requiredFiles) {
  if(!existsSync(file)) {
    console.error(`[smoke] Missing required build artifact: ${file}`);
    process.exit(1);
  }
}

const manifestRaw = readFileSync("dist/.vite/manifest.json", "utf8");
const manifest = JSON.parse(manifestRaw);
const entry = manifest?.["index.html"]?.file || Object.values(manifest || {}).find((v) => v && v.isEntry)?.file;

if(!entry) {
  console.error("[smoke] Could not resolve JS entry from dist/.vite/manifest.json");
  process.exit(1);
}

if(!existsSync(`dist/${entry}`)) {
  console.error(`[smoke] Manifest entry not found on disk: dist/${entry}`);
  process.exit(1);
}

console.log(`[smoke] OK - entry: dist/${entry}`);
