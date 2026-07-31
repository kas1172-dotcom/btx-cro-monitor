export interface CrmEntityIdentity {
  formEntityId: string | null;
  targetEntityId: string | null;
  previewEntityId: string | null;
  routeEntityId: string | null;
}

// This flag must remain off until the disposable HubSpot tenant regression
// proves that the returned record is associated with the intended entity.
export const CRM_WRITES_TENANT_VERIFIED =
  import.meta.env?.VITE_CRM_WRITES_TENANT_VERIFIED === "1";

export function crmEntityIdentityMatches(identity: CrmEntityIdentity): boolean {
  const ids = [
    identity.formEntityId,
    identity.targetEntityId,
    identity.previewEntityId,
    identity.routeEntityId,
  ];
  return ids.every((id): id is string => Boolean(id)) && new Set(ids).size === 1;
}

export function crmWriteBlockReason(identity?: CrmEntityIdentity): string | null {
  if (!CRM_WRITES_TENANT_VERIFIED) {
    return "CRM writes are temporarily frozen until the disposable HubSpot tenant verifies the target entity.";
  }
  if (identity && !crmEntityIdentityMatches(identity)) {
    return "CRM write blocked: form, target, preview, and route entity IDs do not match.";
  }
  return null;
}

export function assertCrmWriteAllowed(identity?: CrmEntityIdentity): void {
  const reason = crmWriteBlockReason(identity);
  if (reason) throw new Error(reason);
}

export interface CrmSubmissionLock {
  acquire(): boolean;
  release(): void;
}

export function createCrmSubmissionLock(): CrmSubmissionLock {
  let locked = false;
  return {
    acquire() {
      if (locked) return false;
      locked = true;
      return true;
    },
    release() {
      locked = false;
    },
  };
}
