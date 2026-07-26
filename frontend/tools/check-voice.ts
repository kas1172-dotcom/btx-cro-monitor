// Voice enforcement (see docs/VOICE_SPEC.md). Fails the build if a banned word,
// a banned opener, or an em or en dash appears in the cockpit copy, the
// deliverable templates, or the LLM system prompts. The canonical lists live in
// src/app/voiceRules.ts. Run via `npm run check:voice`.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { findVoiceViolations } from "../src/app/voiceRules.ts";

const SRC = join(import.meta.dirname, "..", "src");
const ROOTS = [
  join(SRC, "ui"),
  join(SRC, "deliverables"),
  join(SRC, "agents"),
  join(SRC, "brain"),
  join(import.meta.dirname, "..", "..", "btx_platform", "demo"),
];
const STORED_CONTENT_FILES = [
  join(import.meta.dirname, "..", "data", "demo", "btx", "sample_library.json"),
];
const ALLOWLIST_FILE = join(import.meta.dirname, "voice-allowlist.txt");

// voiceRules.ts holds the banned lists themselves, so it is not scanned.
const SKIP_FILES = new Set([join(SRC, "app", "voiceRules.ts")]);

const allowlist = readFileSync(ALLOWLIST_FILE, "utf8")
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#"));

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx?|py|json)$/.test(entry)) out.push(full);
  }
  return out;
}

function isAllowlisted(line: string): boolean {
  return allowlist.some((phrase) => line.includes(phrase));
}

const violations: string[] = [];
for (const root of ROOTS) {
  for (const file of walk(root)) {
    if (SKIP_FILES.has(file)) continue;
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      if (isAllowlisted(line)) return;
      const found = findVoiceViolations(line);
      if (found.length) violations.push(`${relative(process.cwd(), file)}:${index + 1}: ${found.join(", ")}`);
    });
  }
}
for (const file of STORED_CONTENT_FILES) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, index) => {
    if (isAllowlisted(line)) return;
    const found = findVoiceViolations(line);
    if (found.length) violations.push(`${relative(process.cwd(), file)}:${index + 1}: ${found.join(", ")}`);
  });
}

if (violations.length > 0) {
  console.error("Voice violations found (see docs/VOICE_SPEC.md):\n");
  for (const violation of violations) console.error(`  ${violation}`);
  console.error("\nRemove the banned word, opener, or dash. If it is a legitimate exception");
  console.error("(for example a real name), add the exact phrase to tools/voice-allowlist.txt.");
  process.exit(1);
}

console.log("check:voice ok - no banned words, openers, or em dashes in copy, templates, or prompts.");
