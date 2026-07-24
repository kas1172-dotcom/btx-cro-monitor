// Design-system enforcement (see docs/DESIGN_SPEC.md). Colors must come from the
// token sources: the dark cockpit from uiTokens.ts, the light documents from
// designTokens.ts, and their shared brand core from brandCore.ts. This script
// fails the build if a raw off-system hex literal appears where it should not.
// Run via `npm run check:design`.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { uiTokens } from "../src/app/uiTokens.ts";
import { brandCore } from "../src/app/brandCore.ts";
import { steelSignal } from "../src/deliverables/designTokens.ts";

const SRC = join(import.meta.dirname, "..", "src");
const UI_ROOT = join(SRC, "ui");
const DELIVERABLES_ROOT = join(SRC, "deliverables");
const STYLES_FILE = join(UI_ROOT, "styles.css");
const TOKEN_SOURCE = join(SRC, "deliverables", "designTokens.ts");
const REFERENCE_ROOT = join(import.meta.dirname, "..", "..", "design", "reference");
const ALLOW_MARKER = "check:design-allow";

const HEX_PATTERN = /#[0-9A-Fa-f]{3,8}\b/g;

// The set of on-system hex values. The reference-document generators (Python, JS)
// keep literal hex, but every value must be one of these, plus neutral white and
// black. Anything else is off-system and fails.
const ON_SYSTEM = new Set(
  [
    ...Object.values(uiTokens.color),
    brandCore.accent,
    brandCore.amber,
    ...Object.values(steelSignal.colors).filter((value) => value.startsWith("#")),
    "#FFFFFF",
    "#FFF",
    "#000000",
    "#000",
  ].map((value) => value.toUpperCase()),
);

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function walk(dir: string, exts: RegExp, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, exts, out);
    else if (exts.test(entry)) out.push(full);
  }
  return out;
}

// Cockpit and deliverable component files: no raw hex at all, except the token
// source files and lines carrying an explicit allow marker (the current line or
// the line above it).
function checkComponentFiles(root: string): string[] {
  const violations: string[] = [];
  for (const file of walk(root, /\.tsx?$/)) {
    if (file === TOKEN_SOURCE) continue;
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      const allowed = line.includes(ALLOW_MARKER) || (index > 0 && lines[index - 1].includes(ALLOW_MARKER));
      if (allowed) return;
      const matches = line.match(HEX_PATTERN);
      if (matches) violations.push(`${relative(process.cwd(), file)}:${index + 1}: ${matches.join(", ")}`);
    });
  }
  return violations;
}

function checkStylesCssStructure(): string[] {
  const violations: string[] = [];
  const lines = readFileSync(STYLES_FILE, "utf8").split("\n");
  const firstRootStart = lines.findIndex((line) => line.trim() === ":root {");
  assert(firstRootStart !== -1, "styles.css must have a :root token block.");
  const firstRootEnd = lines.findIndex((line, i) => i > firstRootStart && line.trim() === "}");
  assert(firstRootEnd !== -1, "styles.css's first :root block must close with a lone '}'.");
  const exceptionStart = lines.findIndex((line) => line.includes("STEEL & SIGNAL DOCUMENT THEME"));
  lines.forEach((line, index) => {
    const withinCanonicalRoot = index > firstRootStart && index < firstRootEnd;
    const withinDocumentException = exceptionStart !== -1 && index >= exceptionStart;
    if (withinCanonicalRoot || withinDocumentException) return;
    const matches = line.match(HEX_PATTERN);
    if (matches) violations.push(`styles.css:${index + 1}: ${matches.join(", ")} - "${line.trim()}"`);
  });
  return violations;
}

// Reference-document generators: literal hex is allowed only if it is on-system.
function checkReferenceGenerators(): string[] {
  const violations: string[] = [];
  for (const file of walk(REFERENCE_ROOT, /\.(py|js)$/)) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      if (line.includes(ALLOW_MARKER)) return;
      for (const match of line.match(HEX_PATTERN) ?? []) {
        if (!ON_SYSTEM.has(match.toUpperCase())) {
          violations.push(`${relative(process.cwd(), file)}:${index + 1}: ${match} (off-system)`);
        }
      }
    });
  }
  return violations;
}

const all = [
  ...checkComponentFiles(UI_ROOT),
  ...checkComponentFiles(DELIVERABLES_ROOT),
  ...checkStylesCssStructure(),
  ...checkReferenceGenerators(),
];

if (all.length > 0) {
  console.error("Off-system hex color literals found:\n");
  for (const violation of all) console.error(`  ${violation}`);
  console.error("\nColors must come from the token sources (uiTokens.ts, designTokens.ts,");
  console.error("brandCore.ts). Reference generators may use literal hex only if on-system.");
  console.error("See docs/DESIGN_SPEC.md.");
  process.exit(1);
}

console.log("check:design ok - cockpit, deliverables, and reference generators use on-system color only.");
