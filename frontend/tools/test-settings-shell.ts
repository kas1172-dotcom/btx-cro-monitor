import { SETTINGS_SECTIONS } from "../src/app/settingsSections.ts";
import {
  DEFAULT_DELIVERABLE_TEMPLATES,
  enabledTemplatesForAgents,
  normalizeDeliverableTemplates,
  reorderTemplates,
} from "../src/app/deliverableTemplates.ts";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const expected = ["general", "memory", "engine", "prompts", "sources", "integrations"];
const ids = SETTINGS_SECTIONS.map((section) => section.id);

assert(ids.length === expected.length, `Expected ${expected.length} settings sections, got ${ids.length}`);
for (const id of expected) {
  assert(ids.includes(id as typeof SETTINGS_SECTIONS[number]["id"]), `Missing settings section: ${id}`);
}

for (const section of SETTINGS_SECTIONS) {
  assert(section.label.trim().length > 0, `${section.id} section needs a label`);
  assert(section.summary.trim().length > 0, `${section.id} section needs a summary`);
}

assert(DEFAULT_DELIVERABLE_TEMPLATES.length === 8, "Settings must manage exactly the existing 8 deliverable agents");
assert(new Set(DEFAULT_DELIVERABLE_TEMPLATES.map((template) => template.agent_id)).size === 8, "Deliverable agent ids must be unique");

const disabledMeeting = normalizeDeliverableTemplates([
  ...DEFAULT_DELIVERABLE_TEMPLATES,
  { agent_id: "meeting_brief", label: "Meeting brief", enabled: false, order: 20 },
]);
const enabledAccountTemplates = enabledTemplatesForAgents(disabledMeeting, ["meeting_brief", "outreach", "sales_pitch"]);
assert(!enabledAccountTemplates.some((template) => template.agent_id === "meeting_brief"), "Disabled templates must be excluded from pickers");
assert(enabledAccountTemplates.some((template) => template.agent_id === "outreach"), "Enabled templates should remain available");

const moved = reorderTemplates(DEFAULT_DELIVERABLE_TEMPLATES, "board_deck", "up");
const itineraryOrder = moved.find((template) => template.agent_id === "itinerary")?.order;
const boardDeckOrder = moved.find((template) => template.agent_id === "board_deck")?.order;
assert(boardDeckOrder === 30 && itineraryOrder === 40, "Template reorder should swap adjacent order values");

console.log(`settings shell ok: ${SETTINGS_SECTIONS.map((section) => section.label).join(" · ")} · ${DEFAULT_DELIVERABLE_TEMPLATES.length} templates`);
