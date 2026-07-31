import { createCrmSubmissionLock, crmEntityIdentityMatches, crmWriteBlockReason } from "../src/app/crmWriteSafety.ts";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const lockheed = {
  formEntityId: "lockheed",
  targetEntityId: "lockheed",
  previewEntityId: "lockheed",
  routeEntityId: "lockheed",
};

assert(crmEntityIdentityMatches(lockheed), "Matching form, target, preview, and route identity should pass.");
assert(!crmEntityIdentityMatches({ ...lockheed, targetEntityId: "pulse-space" }), "A switched target must invalidate a Lockheed form.");
assert(!crmEntityIdentityMatches({ ...lockheed, previewEntityId: "pulse-space" }), "A stale preview must be rejected.");
assert(!crmEntityIdentityMatches({ ...lockheed, routeEntityId: "pulse-space" }), "Back/forward route mismatch must be rejected.");
assert(!crmEntityIdentityMatches({ ...lockheed, previewEntityId: null }), "A form without a captured preview identity must be rejected.");
assert(
  crmWriteBlockReason(lockheed)?.includes("temporarily frozen"),
  "The disposable-tenant kill switch must remain engaged by default.",
);
const submissionLock = createCrmSubmissionLock();
assert(submissionLock.acquire(), "First submit should acquire the single-flight lock.");
assert(!submissionLock.acquire(), "A double submit must be rejected while the first is in flight.");
submissionLock.release();
assert(submissionLock.acquire(), "The lock should permit a later submit after completion.");

console.log("crm write safety ok: identity mismatches rejected and tenant-validation freeze engaged");
