import { buildLibraryItems, filterLibraryItems } from "../src/ui/surfaces/DeliverableLibrary.tsx";
import { recordToDeliverable, type StoredDeliverable } from "../src/app/deliverablesApi.ts";
import type { Deliverable } from "../src/deliverables/types.ts";
import type { World } from "../src/app/useWorld.ts";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function deliverable(id: string, title: string, accountId: string, type: Deliverable["type"] = "meeting_brief"): Deliverable {
  return {
    id,
    type,
    title,
    createdAt: `2026-07-13T1${id.length}:00:00.000Z`,
    brainArea: "customer",
    entityIds: [accountId],
    canonicalAccountId: accountId,
    sections: [{ id: "overview", heading: "Overview", blocks: [{ kind: "text", text: "Initial text." }] }],
    sources: [{ source: "test", records: [accountId], reason: "Fixture." }],
    confidence: "high",
    actions: [],
  };
}

const company = {
  id: "acct-1",
  name: "Trinity Defense Components",
  relationship: "customer",
  business_motion: "manage_current_business",
  account_status: "active",
  location: { city: "Pittsburgh", state: "PA", lat: 40.4, lon: -80 },
  needs: [],
  capabilities: [],
  industries: [],
} as World["companies"][number];

const world = {
  companies: [company],
} as World;

const backendRecord: StoredDeliverable = {
  id: "backend-1",
  type: "meeting_brief",
  title: "Backend brief",
  canonical_account_id: "acct-1",
  program_id: null,
  trip_id: null,
  document: deliverable("doc-1", "Old title", "acct-1"),
  created_at: "2026-07-13T10:00:00.000Z",
  updated_at: "2026-07-13T12:00:00.000Z",
};

const backendDeliverable = recordToDeliverable(backendRecord);
assert(backendDeliverable.backendRecordId === "backend-1", "Backend record id must be retained for patch saves.");
assert(backendDeliverable.title === "Backend brief", "Backend title should win over stale document title.");
assert(backendDeliverable.canonicalAccountId === "acct-1", "Canonical account metadata should map onto the deliverable.");

const localBrief = deliverable("local-1", "Local brief", "acct-1", "weekly_memo");
const unrelated = deliverable("local-2", "Other account deck", "acct-2", "board_deck");
const items = buildLibraryItems({ backend: [backendDeliverable], local: [localBrief, unrelated], world });

assert(items.length === 3, `Expected 3 library items, got ${items.length}`);
assert(items.some((item) => item.accountName === "Trinity Defense Components"), "Library item should resolve account name from world.");

const accountFiltered = filterLibraryItems(items, { accountId: "acct-1", type: "all" });
assert(accountFiltered.length === 2, `Expected account filter to keep 2 records, got ${accountFiltered.length}`);

const typeFiltered = filterLibraryItems(items, { accountId: "all", type: "weekly_memo" });
assert(typeFiltered.length === 1 && typeFiltered[0]?.deliverable.id === "local-1", "Type filter should isolate weekly memo.");

const combined = filterLibraryItems(items, { accountId: "acct-1", type: "meeting_brief" });
assert(combined.length === 1 && combined[0]?.deliverable.backendRecordId === "backend-1", "Combined filters should isolate backend meeting brief.");

console.log(`deliverable library ok: ${items.length} items, ${accountFiltered.length} for Trinity`);
