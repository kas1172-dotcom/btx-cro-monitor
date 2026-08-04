import { readFileSync } from "node:fs";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const askSurface = readFileSync("src/ui/surfaces/AskSurface.tsx", "utf8");
const askButton = readFileSync("src/ui/ask/AskButton.tsx", "utf8");
const account360 = readFileSync("src/ui/surfaces/Account360.tsx", "utf8");
const workQueue = readFileSync("src/ui/surfaces/WorkQueue.tsx", "utf8");

for (const token of [
  "listAssistantConversations",
  "askAssistant",
  "ask-conversation-sidebar",
  "ask-citation-panel",
  "ask-workspace-composer",
  "action_draft",
  "deliverable_draft",
  "AssistantSourceMode",
  "workspace_web",
  "Stop research",
  "actual_source_mode",
  "as-of unavailable",
  "SanitizedMarkdown",
  "messageQuality",
  "ask-mobile-switcher",
  "drawer-open",
  "Primary government source",
  "Unsupported answer",
]) {
  assert(askSurface.includes(token), `Ask workspace missing ${token}`);
}

assert(!askSurface.includes("dispatchBrainQuestion"), "Ask page must not use the old local question dispatcher.");
assert(!askSurface.includes("AskBrainBar"), "Ask page must not render the old local Ask bar.");
assert(!askSurface.includes("tool_activity.map"), "Ask page must not render model/process narration as message content.");
assert(askButton.includes("navigateTo(`/ask?prompt="), "Contextual Ask buttons should deep-link to /ask.");
assert(account360.includes("Ask about this account"), "Account 360 needs a contextual Ask action.");
assert(workQueue.includes("Ask about this work"), "Work item detail needs a contextual Ask action.");

for (const [name, text] of [
  ["AskSurface", askSurface],
  ["AskButton", askButton],
  ["Account360", account360],
  ["WorkQueue", workQueue],
] as const) {
  for (const legacy of ["ChatPill", "Chatpil", "Jarvis", "Copilot"]) {
    assert(!text.includes(legacy), `${name} exposes legacy assistant name ${legacy}`);
  }
}

console.log("assistant workspace ok: Ask uses backend conversations, citations, drafts, and contextual entry points");
