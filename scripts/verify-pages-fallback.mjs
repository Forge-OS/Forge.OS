import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

function sha256(path) {
  const raw = readFileSync(path);
  return createHash("sha256").update(raw).digest("hex");
}

function manifestFiles(manifest) {
  return [...new Set(
    Object.values(manifest || {}).flatMap((entry) => {
      const files = [];
      if(entry?.file) files.push(entry.file);
      if(Array.isArray(entry?.css)) files.push(...entry.css);
      return files;
    }).filter(Boolean)
  )];
}

const distManifestPath = "dist/manifest.json";
const rootManifestPath = "manifest.json";

if(!existsSync(distManifestPath)) {
  console.error(`[verify:pages-fallback] Missing ${distManifestPath}. Run npm run build first.`);
  process.exit(1);
}

if(!existsSync(rootManifestPath)) {
  console.error(`[verify:pages-fallback] Missing ${rootManifestPath}. Run npm run pages:fallback and commit the files.`);
  process.exit(1);
}

const distManifestRaw = readFileSync(distManifestPath, "utf8");
const rootManifestRaw = readFileSync(rootManifestPath, "utf8");

if(distManifestRaw.trim() !== rootManifestRaw.trim()) {
  console.error("[verify:pages-fallback] manifest.json is out of sync with dist/manifest.json.");
  console.error("[verify:pages-fallback] Run: npm run pages:fallback");
  process.exit(1);
}

const distManifest = JSON.parse(distManifestRaw);
const files = manifestFiles(distManifest);
const mismatches = [];
const missing = [];

for(const relFile of files) {
  const distPath = `dist/${relFile}`;
  const rootPath = relFile;
  if(!existsSync(rootPath)) {
    missing.push(rootPath);
    continue;
  }
  if(!existsSync(distPath)) {
    mismatches.push(`${rootPath} (missing dist source ${distPath})`);
    continue;
  }
  if(sha256(rootPath) !== sha256(distPath)) {
    mismatches.push(rootPath);
  }
}

if(missing.length > 0) {
  console.error("[verify:pages-fallback] Missing fallback files:");
  for(const path of missing) console.error(`  - ${path}`);
}

if(mismatches.length > 0) {
  console.error("[verify:pages-fallback] Out-of-sync fallback files:");
  for(const path of mismatches) console.error(`  - ${path}`);
}

if(missing.length > 0 || mismatches.length > 0) {
  console.error("[verify:pages-fallback] Run: npm run pages:fallback");
  process.exit(1);
}

console.log(`[verify:pages-fallback] OK - ${files.length} files synced with dist artifacts.`);
