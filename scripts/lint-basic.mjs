import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const files = execSync("rg --files src server scripts .github/workflows package.json README.md README.dev.md .env.example", {
  encoding: 'utf8',
})
  .split(/\r?\n/)
  .map((s) => s.trim())
  .filter(Boolean);

const findings = [];

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);
  if (lines.some((line) => /^(<<<<<<<|=======|>>>>>>>)(\s|$)/.test(line))) {
    findings.push(`${file}: merge conflict marker detected`);
  }
  if (/\bdebugger\s*;/.test(text)) {
    findings.push(`${file}: debugger statement detected`);
  }
  if (/\u0000/.test(text)) {
    findings.push(`${file}: NUL byte detected`);
  }
}

if (findings.length) {
  console.error('[lint-basic] FAIL');
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log(`[lint-basic] OK - scanned ${files.length} files`);
