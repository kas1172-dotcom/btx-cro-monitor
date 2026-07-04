import type { AccountStatus, BusinessMotion, Company, Relationship } from "../engine/brain/entities.ts";

const BUSINESS_MOTION_LABELS: Record<BusinessMotion, string> = {
  manage_current_business: "Manage Current Business",
  grow_existing_business: "Grow Existing Business",
  prospect_new_business: "Prospect New Business",
  reduce_risk: "Reduce Risk",
};

export function accountStatusForRelationship(relationship: Relationship): AccountStatus {
  switch (relationship) {
    case "self":
    case "customer":
      return "current_customer";
    case "supplier":
      return "partner";
    case "competitor":
      return "competitor";
    case "target":
      return "target_prospect";
  }
}

export function businessMotionForAccount(account: Pick<Company, "relationship" | "business_motion">): BusinessMotion {
  if (account.business_motion) return account.business_motion;
  switch (account.relationship) {
    case "self":
      return "manage_current_business";
    case "customer":
      return "grow_existing_business";
    case "target":
      return "prospect_new_business";
    case "supplier":
    case "competitor":
      return "reduce_risk";
  }
}

export function accountStatus(account: Pick<Company, "relationship" | "account_status">): AccountStatus {
  return account.account_status ?? accountStatusForRelationship(account.relationship);
}

export function isCurrentBusinessAccount(account: Pick<Company, "relationship" | "account_status">): boolean {
  const status = accountStatus(account);
  return status === "current_customer" || status === "active_pipeline" || status === "past_customer" || status === "partner";
}

export function isProspectingAccount(account: Pick<Company, "relationship" | "account_status">): boolean {
  const status = accountStatus(account);
  return status === "target_prospect" || status === "new_logo" || status === "active_pipeline";
}

export function getBusinessMotionLabel(motion: BusinessMotion): string {
  return BUSINESS_MOTION_LABELS[motion];
}
