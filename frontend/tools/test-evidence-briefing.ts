import { readFileSync } from "node:fs";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const evidenceModel = readFileSync("src/app/evidence.ts", "utf8");
const drawer = readFileSync("src/ui/evidence/EvidenceDrawer.tsx", "utf8");
const timelineModel = readFileSync("src/app/timeline.ts", "utf8");
const timeline = readFileSync("src/ui/timeline/MeaningfulTimeline.tsx", "utf8");
const account360 = readFileSync("src/ui/surfaces/Account360.tsx", "utf8");
const today = readFileSync("src/ui/surfaces/TodayBrief.tsx", "utf8");
const workQueue = readFileSync("src/ui/surfaces/WorkQueue.tsx", "utf8");
const askSurface = readFileSync("src/ui/surfaces/AskSurface.tsx", "utf8");
const programSignals = readFileSync("src/ui/surfaces/ProgramContractTracker.tsx", "utf8");
const documentViewer = readFileSync("src/ui/deliverables/DocumentViewer.tsx", "utf8");
const briefing = readFileSync("src/ui/modes/BriefingMode.tsx", "utf8");
const meetingBriefAgent = readFileSync("src/agents/meetingBriefAgent.ts", "utf8");
const styles = readFileSync("src/ui/styles.css", "utf8");

for (const token of [
  "buildSignalEvidence",
  "buildScoreEvidence",
  "buildWorkItemEvidence",
  "buildAccountEvidence",
  "evidenceFromCitation",
  "evidenceFromDeliverableSource",
  "relationshipReviewStatus",
]) {
  assert(evidenceModel.includes(token), `shared evidence model missing ${token}`);
}

for (const token of ["role=\"dialog\"", "aria-modal=\"true\"", "event.key === \"Escape\"", "event.key !== \"Tab\"", "focusableElements", "triggerRef"]) {
  assert(drawer.includes(token), `Evidence drawer accessibility missing ${token}`);
}

for (const category of ["signal", "relationship", "score", "work", "approval", "execution", "verification", "outcome", "note"]) {
  assert(timelineModel.includes(`\"${category}\"`), `timeline model missing category ${category}`);
}
assert(timeline.includes("<ol className=\"timeline-list\""), "timeline should use a semantic ordered list");
assert(timeline.includes("tabIndex={0}"), "timeline events should be keyboard focusable");

for (const [name, text] of [
  ["Account360", account360],
  ["TodayBrief", today],
  ["WorkQueue", workQueue],
  ["AskSurface", askSurface],
  ["ProgramContractTracker", programSignals],
  ["DocumentViewer", documentViewer],
] as const) {
  assert(text.includes("EvidenceDrawer"), `${name} must integrate shared EvidenceDrawer`);
  assert(text.includes("View evidence") || text.includes("View score evidence"), `${name} must expose evidence action`);
}

assert(account360.includes("buildAccountTimeline") && account360.includes("AccountBriefingMode"), "Account 360 should expose timeline and briefing mode");
assert(workQueue.includes("buildWorkTimeline") && workQueue.includes("Focus mode"), "Work detail should expose timeline and focus mode");
assert(askSurface.includes("evidenceFromCitation") && askSurface.includes("Draft the executive brief"), "Ask should inspect citations and expose contextual actions");
assert(documentViewer.includes("DeliverableBriefingMode") && documentViewer.includes("Briefing mode"), "Deliverable viewer should support briefing mode");
assert(briefing.includes("ArrowRight") && briefing.includes("window.print()") && briefing.includes("Exit briefing"), "Briefing mode needs keyboard, print, and exit behavior");

for (const heading of [
  "Cover",
  "Executive Summary",
  "Account Context",
  "Recent Developments",
  "Decision Summary",
  "Meeting Preparation",
  "Current Work",
  "Sources And Data Notes",
]) {
  assert(meetingBriefAgent.includes(heading), `executive brief missing ${heading}`);
}
assert(meetingBriefAgent.includes("Meeting date\", \"Not supplied\""), "executive brief must not invent meeting dates");
assert(meetingBriefAgent.includes("Executive Account and Meeting Brief"), "executive brief title missing");

for (const token of [
  ".evidence-drawer",
  ".meaningful-timeline",
  ".record-focus-mode",
  ".briefing-mode",
  "@media print",
  "prefers-reduced-motion",
  "100dvh",
]) {
  assert(styles.includes(token), `styles missing ${token}`);
}

console.log("evidence and briefing ok: shared drawer, timelines, focus mode, briefing mode, Ask citations, and executive brief structure are wired");
