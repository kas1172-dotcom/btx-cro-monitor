import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

function read(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const settingsSections = read("src/app/settingsSections.ts");
const settings = read("src/ui/settings/SettingsWorkspace.tsx");
const prospects = read("src/ui/surfaces/Prospecting.tsx");

assert(!settingsSections.includes('id: "prompts"'), "Prompts & rubrics must stay hidden until a real editor is implemented.");
assert(!settings.includes("settings-placeholder"), "Settings must not render placeholder-only routes.");
assert(!settings.includes("window.confirm"), "Settings destructive actions must use accessible product dialogs, not window.confirm.");
assert(settings.includes('role="dialog"') && settings.includes('aria-modal="true"'), "Confirmation UI must expose a modal dialog to assistive tech.");
assert(settings.includes("Clear current conversation"), "Settings copy must say current conversation instead of current tab.");
assert(!settings.includes("current tab"), "Settings copy must not refer to current tab.");

assert(settings.includes("ErrorSummary") && settings.includes('role="alert"'), "Settings forms need an error summary.");
assert(settings.includes("Unit: points") && settings.includes("Validation: blank or -100 to 100"), "Engine fields need visible units and validation rules.");
assert(settings.includes("Collection status") && settings.includes("Source type") && settings.includes("Display name") && settings.includes("Collection URL") && settings.includes("Administration notes"), "Source fields need visible labels.");
assert(settings.includes("absolute URL beginning with https://"), "Source URL validation rule must be visible.");
assert(settings.includes("Remove source") && settings.includes("Existing collected records are not deleted"), "Source removal needs confirmation with scope and consequences.");

assert(!prospects.includes('<button key={row.company.id} className="current-mini-row"'), "Market prospect rows must not be interactive containers with nested actions.");
assert(!prospects.includes('<button key={r.subject_id} className="rec-row"'), "Recommended action rows must not be interactive containers with nested actions.");
assert(!prospects.includes('<button key={signal.id} className="current-signal-row"'), "Buying signal rows must not be interactive containers with nested actions.");
assert(!prospects.includes('<button key={row.company.id} className="outreach-row"'), "Outreach rows must not be interactive containers with nested actions.");
assert(prospects.includes("<article") && prospects.includes("Open dossier"), "Prospect cards should separate row content from navigation buttons.");

console.log("Settings accessibility checks passed.");
