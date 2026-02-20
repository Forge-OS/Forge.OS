import { existsSync, readFileSync } from "node:fs";

const requiredFiles = [
  "dist/index.html",
  "dist/manifest.json",
];

for(const file of requiredFiles) {
  if(!existsSync(file)) {
    console.error(`[smoke] Missing required build artifact: ${file}`);
    process.exit(1);
  }
}

const manifestRaw = readFileSync("dist/manifest.json", "utf8");
const manifest = JSON.parse(manifestRaw);
const entry = manifest?.["index.html"]?.file || Object.values(manifest || {}).find((v) => v && v.isEntry)?.file;

if(!entry) {
  console.error("[smoke] Could not resolve JS entry from dist/manifest.json");
  process.exit(1);
}

if(!existsSync(`dist/${entry}`)) {
  console.error(`[smoke] Manifest entry not found on disk: dist/${entry}`);
  process.exit(1);
}

const cssAssets = new Set();
for (const value of Object.values(manifest || {})) {
  const file = value?.file;
  if (typeof file === "string" && file.length > 0) {
    if (!existsSync(`dist/${file}`)) {
      console.error(`[smoke] Manifest file missing on disk: dist/${file}`);
      process.exit(1);
    }
  }

  if (Array.isArray(value?.imports)) {
    for (const importKey of value.imports) {
      if (!manifest?.[importKey]) {
        console.error(`[smoke] Manifest import key missing: ${importKey}`);
        process.exit(1);
      }
    }
  }

  if (Array.isArray(value?.dynamicImports)) {
    for (const importKey of value.dynamicImports) {
      if (!manifest?.[importKey]) {
        console.error(`[smoke] Manifest dynamic import key missing: ${importKey}`);
        process.exit(1);
      }
    }
  }

  const files = value?.css;
  if (!Array.isArray(files)) continue;
  for (const file of files) cssAssets.add(file);
}

if (cssAssets.size === 0) {
  console.error("[smoke] No CSS assets discovered in manifest. The app may ship unstyled.");
  process.exit(1);
}

for (const cssFile of cssAssets) {
  if(!existsSync(`dist/${cssFile}`)) {
    console.error(`[smoke] CSS asset missing on disk: dist/${cssFile}`);
    process.exit(1);
  }
}

console.log(`[smoke] OK - entry: dist/${entry}`);
