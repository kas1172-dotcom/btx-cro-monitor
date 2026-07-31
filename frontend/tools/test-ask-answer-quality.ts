import { readFileSync } from "node:fs";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const askSurface = readFileSync("src/ui/surfaces/AskSurface.tsx", "utf8");
const assistantOnline = readFileSync("../btx_platform/assistant_online.py", "utf8");
const assistant = readFileSync("../btx_platform/assistant.py", "utf8");

const promptClasses = [
  "current-news",
  "workspace-only",
  "mixed",
  "adversarial",
  "no-result",
  "contradiction",
] as const;

for (const promptClass of promptClasses) {
  const token = promptClass === "current-news"
    ? "CURRENT_MARKERS"
    : promptClass === "workspace-only"
      ? "WORKSPACE_ONLY_MARKERS"
      : promptClass === "mixed"
        ? "workspace_web"
        : promptClass === "adversarial"
          ? "INJECTION_MARKERS"
          : promptClass === "no-result"
            ? "No citable public result"
            : "conflicting";
  const haystack = promptClass === "current-news" || promptClass === "workspace-only" || promptClass === "adversarial" || promptClass === "no-result"
    ? assistantOnline
    : `${askSurface}\n${assistantOnline}`;
  assert(haystack.toLowerCase().includes(token.toLowerCase()), `Ask quality suite missing ${promptClass} coverage token ${token}`);
}

assert(assistantOnline.includes("return \"workspace_web\" if wants_workspace else \"web\""), "public-current automatic routing must not inject workspace records by default");
assert(assistantOnline.includes("GOVERNMENT_HOSTS"), "primary government source classifier must be explicit");
assert(assistantOnline.includes('"primary_government"'), "government citations must carry primary_government data classification");
assert(assistantOnline.includes('"reporting_or_public_web"'), "secondary publishers must not be labeled official");
assert(assistant.includes("tool_activity: list[str] = []"), "backend Ask should not emit model process narration");
assert(askSurface.includes("Unsupported answer: no citations were returned."), "unsupported answers must be explicit");
assert(askSurface.includes("unconfirmed or conflicting"), "conflicting evidence must be explicit");
assert(askSurface.includes("stale or simulated"), "stale evidence must be explicit");
assert(askSurface.includes("SanitizedMarkdown") && !askSurface.includes("dangerouslySetInnerHTML"), "Ask must render sanitized Markdown without raw HTML injection");
assert(askSurface.includes("citationMessages") && askSurface.includes("onEvidence"), "Ask must preserve evidence per assistant message");

console.log(`ask answer quality ok: ${promptClasses.length} prompt classes covered`);
