import { useStore, type UiState } from "../store/store.ts";
import type { SurfaceId } from "./surfaces.ts";
import { ALL_SURFACES } from "./surfaces.ts";
import type { World } from "./useWorld.ts";
import type { ChartSpec } from "../metrics/types.ts";

export interface ActiveContext {
  tabId: SurfaceId;
  accountId?: string;
  prospectId?: string;
  tripId?: string;
  analysisSpecId?: string;
  deliverableId?: string;
}

type ActiveContextState = Pick<UiState, "activeSurface" | "activeCompanyId" | "activeDeliverable" | "activeAnalysisSpec">;

function compact<T extends Record<string, string | undefined>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => Boolean(entry))) as Partial<T>;
}

export function analysisSpecId(spec: ChartSpec | null): string | undefined {
  if (!spec) return undefined;
  return [
    spec.viz,
    spec.metric,
    spec.rows,
    spec.cols,
    spec.color,
    spec.filters?.accountId ? `account:${spec.filters.accountId}` : undefined,
    spec.timeRange ? `${spec.timeRange.from}:${spec.timeRange.to}` : undefined,
  ].filter(Boolean).join("|");
}

export function activeContextFromState(state: ActiveContextState): ActiveContext {
  const deliverableEntityId = state.activeDeliverable?.entityIds.find(Boolean);
  const accountId = state.activeCompanyId ?? deliverableEntityId;
  return {
    tabId: state.activeSurface,
    ...compact({
      accountId,
      deliverableId: state.activeDeliverable?.id,
      analysisSpecId: analysisSpecId(state.activeAnalysisSpec),
    }),
  };
}

export function describeActiveContext(context: ActiveContext, world?: World): string {
  const lines: string[] = [];
  const tab = ALL_SURFACES.find((surface) => surface.id === context.tabId);
  lines.push(`Active tab: ${tab?.label ?? context.tabId}.`);
  if (context.accountId) {
    const account = world?.companies.find((company) => company.id === context.accountId);
    lines.push(`Active account: ${account?.name ?? context.accountId}${account ? ` (${account.id})` : ""}.`);
  }
  if (context.prospectId) lines.push(`Active prospect: ${context.prospectId}.`);
  if (context.tripId) lines.push(`Active trip: ${context.tripId}.`);
  if (context.analysisSpecId) lines.push(`Active analysis: ${context.analysisSpecId}.`);
  if (context.deliverableId) lines.push(`Active deliverable: ${context.deliverableId}.`);
  return lines.join("\n");
}

export function useActiveContext(): ActiveContext {
  const state = useStore();
  return activeContextFromState(state);
}
