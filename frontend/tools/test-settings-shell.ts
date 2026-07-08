import { SETTINGS_SECTIONS } from "../src/app/settingsSections.ts";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const expected = ["general", "engine", "prompts", "connections"];
const ids = SETTINGS_SECTIONS.map((section) => section.id);

assert(ids.length === expected.length, `Expected ${expected.length} settings sections, got ${ids.length}`);
for (const id of expected) {
  assert(ids.includes(id as typeof SETTINGS_SECTIONS[number]["id"]), `Missing settings section: ${id}`);
}

for (const section of SETTINGS_SECTIONS) {
  assert(section.label.trim().length > 0, `${section.id} section needs a label`);
  assert(section.summary.trim().length > 0, `${section.id} section needs a summary`);
}

console.log(`settings shell ok: ${SETTINGS_SECTIONS.map((section) => section.label).join(" · ")}`);
