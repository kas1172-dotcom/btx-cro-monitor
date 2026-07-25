import type { ScoreSnapshot, SourceHealth } from "./revenueDataClient.ts";
import type { WorkItem, WorkItemTransitionAction } from "./workItems.ts";
import type { World } from "./useWorld.ts";

export type AlertLevel = "critical" | "action_required" | "watch" | "informational";
export type AvailabilityLabel = "Available" | "More information needed" | "Not connected" | "Awaiting review" | "Provisional" | "Disqualified" | "Stale" | "Unable to verify" | "Confirmed" | "Inferred";

export const SCORE_FAMILY_LABELS = {
  accountAttractiveness: "Strategic attractiveness",
  signalConfidence: "Evidence strength",
  pursuitPwin: "Likelihood to win",
  deliveryFeasibility: "Ability to deliver",
  relationshipHealth: "Relationship strength",
  actionPriority: "Action priority",
} as const;

const WORK_STATUS_LABELS: Record<string, string> = {
  detected: "Detected",
  triaged: "Triaged",
  prepared: "Prepared",
  awaiting_approval: "Approval needed",
  approved: "Approved",
  in_progress: "In progress",
  executed: "Waiting for verification",
  verified: "Verified",
  outcome_recorded: "Outcome recorded",
  dismissed: "Dismissed",
  closed: "Closed",
};

const ACTION_LABELS: Record<WorkItemTransitionAction, string> = {
  triage: "Mark triaged",
  prepare: "Prepare work",
  request_approval: "Request approval",
  approve: "Approve action",
  reject: "Reject with reason",
  start: "Start work",
  mark_executed: "Mark executed",
  verify: "Verify result",
  record_outcome: "Record outcome",
  dismiss: "Dismiss with reason",
  close: "Close work",
  reopen: "Reopen work",
};

export function plainWorkStatus(status: string): string {
  return WORK_STATUS_LABELS[status] ?? status.replace(/_/g, " ");
}

export function plainActionLabel(action: WorkItemTransitionAction): string {
  return ACTION_LABELS[action] ?? action.replace(/_/g, " ");
}

export function workItemAlertLevel(item: WorkItem): AlertLevel {
  if (item.execution_state === "failed") return "critical";
  if (item.approval_state === "pending" || item.status === "awaiting_approval") return "action_required";
  if (item.due_date && new Date(item.due_date) < new Date() && !["closed", "dismissed"].includes(item.status)) return "action_required";
  if (item.status === "detected" || item.status === "triaged") return "watch";
  return "informational";
}

export function primaryWorkAction(item: WorkItem): WorkItemTransitionAction | null {
  const order: WorkItemTransitionAction[] = ["approve", "request_approval", "triage", "prepare", "start", "mark_executed", "verify", "record_outcome", "close"];
  return order.find((action) => item.allowed_actions.includes(action)) ?? item.allowed_actions[0] ?? null;
}

export function scoreAvailability(score: ScoreSnapshot | null): AvailabilityLabel {
  if (!score || score.score === null || score.result.status === "insufficient_data") return "More information needed";
  if (score.result.status === "provisional") return "Provisional";
  if (score.result.status === "disqualified") return "Disqualified";
  return "Available";
}

export function scoreInterpretation(score: ScoreSnapshot | null, familyLabel: string): string {
  const availability = scoreAvailability(score);
  if (availability !== "Available") return `${familyLabel}: ${availability.toLowerCase()}.`;
  const value = Math.round(score?.score ?? 0);
  if (value >= 80) return `${familyLabel}: strong signal for executive attention.`;
  if (value >= 60) return `${familyLabel}: worth investigating.`;
  if (value >= 40) return `${familyLabel}: mixed support; review missing information.`;
  return `${familyLabel}: weak support from current records.`;
}

export function sourceFreshnessLabel(source: SourceHealth): AvailabilityLabel {
  if (source.availability === "available") return "Available";
  if (source.availability === "stale") return "Stale";
  if (source.availability === "not_configured") return "Not connected";
  return "Unable to verify";
}

export function contextRibbonItems(world: World): Array<{ id: string; label: string; tone: "success" | "warning" | "danger" | "info"; href?: string }> {
  const workItems = world.worldSnapshot?.workItems ?? [];
  const approvals = workItems.filter((item) => item.approval_state === "pending").length;
  const overdue = workItems.filter((item) => item.due_date && new Date(item.due_date) < new Date() && !["closed", "dismissed"].includes(item.status)).length;
  const failed = workItems.filter((item) => item.execution_state === "failed").length;
  const stale = world.worldSnapshot?.sourceHealth.filter((source) => ["stale", "error", "unavailable"].includes(source.availability)) ?? [];
  const items: Array<{ id: string; label: string; tone: "success" | "warning" | "danger" | "info"; href?: string }> = [];
  if (failed) items.push({ id: "failed", label: `${failed} failed execution${failed === 1 ? "" : "s"}`, tone: "danger", href: "/work?execution=failed" });
  if (approvals) items.push({ id: "approvals", label: `${approvals} approval${approvals === 1 ? "" : "s"} needed`, tone: "warning", href: "/work?approval=pending" });
  if (overdue) items.push({ id: "overdue", label: `${overdue} overdue`, tone: "warning", href: "/work?overdue=true" });
  for (const source of stale.slice(0, 2)) {
    items.push({ id: `source-${source.sourceKey}`, label: `${source.displayName}: ${sourceFreshnessLabel(source)}`, tone: source.availability === "stale" ? "warning" : "danger", href: "/integrations" });
  }
  if (!items.length) items.push({ id: "clear", label: "Systems normal", tone: "success" });
  return items.slice(0, 4);
}

export function demoWorkspaceNotice(world: World): string | null {
  if (world.worldSnapshot?.tenant.id.includes("demo")) {
    return "Demonstration workspace. Public intelligence is sourced. Internal BTX records are illustrative.";
  }
  return null;
}
