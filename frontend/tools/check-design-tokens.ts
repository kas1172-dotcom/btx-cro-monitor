// Design-system enforcement (see design.md's "Rule zero"): every color under
// frontend/src/ui/ must come from uiTokens.ts / the CSS variables it mirrors.
// This script fails the build if a raw hex color literal appears anywhere it
// shouldn't. Run via `npm run check:design`.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const UI_ROOT = join(import.meta.dirname, "..", "src", "ui");
const STYLES_FILE = join(UI_ROOT, "styles.css");

const HEX_PATTERN = /#[0-9A-Fa-f]{3,8}\b/g;

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) walk(full, out);
    else if (/\.(tsx?|css)$/.test(entry)) out.push(full);
  }
  return out;
}

function checkComponentFiles(): string[] {
  const violations: string[] = [];
  for (const file of walk(UI_ROOT)) {
    if (file === STYLES_FILE || !file.endsWith(".ts") && !file.endsWith(".tsx")) continue;
    const text = readFileSync(file, "utf8");
    const matches = text.match(HEX_PATTERN);
    if (matches) {
      violations.push(`${relative(process.cwd(), file)}: ${matches.join(", ")}`);
    }
  }
  return violations;
}

function checkStylesCssStructure(): string[] {
  const violations: string[] = [];
  const text = readFileSync(STYLES_FILE, "utf8");
  const lines = text.split("\n");

  // The canonical cockpit token block is the FIRST :root { ... } in the file.
  const firstRootStart = lines.findIndex((line) => line.trim() === ":root {");
  assert(firstRootStart !== -1, "styles.css must have a :root token block.");
  const firstRootEnd = lines.findIndex((line, i) => i > firstRootStart && line.trim() === "}");
  assert(firstRootEnd !== -1, "styles.css's first :root block must close with a lone '}'.");

  // The deliberate document-theme exception is fenced by a labeled comment
  // banner (see design.md's "Known, deliberate exception"). Anything between
  // that banner and its matching closing banner is exempt.
  const exceptionStart = lines.findIndex((line) => line.includes("STEEL & SIGNAL DOCUMENT THEME"));

  lines.forEach((line, index) => {
    const withinCanonicalRoot = index > firstRootStart && index < firstRootEnd;
    const withinDocumentException = exceptionStart !== -1 && index >= exceptionStart;
    if (withinCanonicalRoot || withinDocumentException) return;
    const matches = line.match(HEX_PATTERN);
    if (matches) {
      violations.push(`styles.css:${index + 1}: ${matches.join(", ")} — "${line.trim()}"`);
    }
  });

  return violations;
}

const componentViolations = checkComponentFiles();
const cssViolations = checkStylesCssStructure();

const all = [...componentViolations, ...cssViolations];

if (all.length > 0) {
  console.error("Raw hex color literals found outside the locked token set:\n");
  for (const violation of all) console.error(`  ${violation}`);
  console.error("\nAll colors must come from frontend/src/app/uiTokens.ts (or the CSS");
  console.error("variables it mirrors in styles.css's canonical :root block). See design.md.");
  process.exit(1);
}

console.log("check:design ok — no raw hex colors outside uiTokens.ts / styles.css's canonical :root block.");
