#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const domain = process.argv[2] || "forge-us.xyz";
const alt = process.argv[3] || `www.${domain}`;
const intervalMinutes = Number(process.env.DOMAIN_WATCH_INTERVAL_MINUTES || 10);
const maxChecks = Number(process.env.DOMAIN_WATCH_MAX_CHECKS || 24);

if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) {
  console.error("Invalid DOMAIN_WATCH_INTERVAL_MINUTES, expected positive number.");
  process.exit(2);
}

if (!Number.isFinite(maxChecks) || maxChecks <= 0) {
  console.error("Invalid DOMAIN_WATCH_MAX_CHECKS, expected positive number.");
  process.exit(2);
}

const waitMs = Math.floor(intervalMinutes * 60 * 1000);

console.log(
  `Watching domain health for ${domain} (alt: ${alt}) every ${intervalMinutes} minute(s), max ${maxChecks} checks.`
);

for (let i = 1; i <= maxChecks; i += 1) {
  console.log(`\n[check ${i}/${maxChecks}] ${new Date().toISOString()}`);
  const result = spawnSync("node", ["scripts/domain-health.mjs", domain, alt], { stdio: "inherit" });
  if (result.status === 0) {
    console.log("Domain is healthy. Exiting watch.");
    process.exit(0);
  }

  if (i < maxChecks) {
    console.log(`Waiting ${intervalMinutes} minute(s) before next check...`);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

console.log("Domain watch reached max checks without healthy status.");
process.exit(1);
