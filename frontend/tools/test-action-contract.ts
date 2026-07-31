import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

function read(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const presentation = read("src/app/presentation.ts");
const workQueue = read("src/ui/surfaces/WorkQueue.tsx");
const workList = read("src/ui/surfaces/WorkItemList.tsx");
const crmWrites = read("src/ui/actions/CrmWriteActions.tsx");
const dossier = read("src/ui/company/Dossier.tsx");

assert(!presentation.includes("Confirm review complete"), "Work triage must not be labeled as confirmation when it only marks review.");
assert(presentation.includes('triage: "Mark reviewed"'), "Triage action should use accurate verb-first user language.");
assert(presentation.includes("plainApprovalState") && presentation.includes("plainExecutionState") && presentation.includes("plainWorkType"), "Workflow enums need user-language presentation helpers.");

assert(!workQueue.includes("window.prompt"), "Work transitions must collect reasons before activation in app UI, not with browser prompts.");
assert(workQueue.includes("Reason required") && workQueue.includes("Outcome required"), "Dismiss/reject/outcome actions must require user input before execution.");
assert(workQueue.includes("pendingAction") && workQueue.includes("busyAction"), "Work actions need pending state and double-submit protection.");
assert(workQueue.includes("Undo dismiss") && workQueue.includes("Undo close"), "Recoverable terminal actions should offer undo where possible.");
assert(workQueue.includes("<summary>Technical details</summary>"), "Raw workflow IDs and enums should live in an expandable diagnostic area.");
assert(workQueue.includes("All statuses") && workQueue.includes("All types"), "Filters should avoid raw enum labels.");
assert(workQueue.includes("filtered work item") && workQueue.includes("work_open") && workQueue.includes("work_total"), "Work counts must distinguish filtered, open, and total counts.");

assert(workList.includes("plainWorkStatus") && workList.includes("plainWorkType"), "Work table should render statuses and types in user language.");
assert(!workList.includes("{titleCase(item.status)}"), "Work table should not show raw status enum labels.");

assert(!crmWrites.includes("Confirm create"), "CRM confirmation buttons must say exactly what will be created.");
assert(crmWrites.includes("Prepare HubSpot company") && crmWrites.includes("Prepare HubSpot task"), "CRM write entry points need verb-first labels.");
assert(crmWrites.includes("Create HubSpot company") && crmWrites.includes("Create HubSpot task"), "CRM confirm buttons need entity-specific result language.");
assert(crmWrites.includes("Idempotency protection: enabled") && crmWrites.includes("Technical details"), "CRM idempotency keys should be disclosed as diagnostics, not primary action copy.");

assert(dossier.includes("Create meeting brief") && dossier.includes("Create outreach draft"), "Deliverable actions should be verb-first.");

console.log("Action contract checks passed.");
