import type { Action } from "../engine/decision/recommend.ts";

export interface ActionCopy {
  label: string;
  description: string;
}

export const ACTION_COPY: Record<Action, ActionCopy> = {
  pursue: {
    label: "Pursue revenue",
    description: "Actively pursue a new or existing revenue opportunity.",
  },
  defend: {
    label: "Defend account",
    description: "Protect an existing account from churn, competitor activity, or relationship risk.",
  },
  derisk: {
    label: "Reduce risk",
    description: "Address delivery, capacity, supplier, quality, or revenue risk.",
  },
  expand: {
    label: "Expand relationship",
    description: "Grow an existing relationship through additional work, facilities, programs, or contacts.",
  },
  watch: {
    label: "Monitor",
    description: "Keep watching, but no immediate action is required.",
  },
};

export function actionLabel(action: Action): string {
  return ACTION_COPY[action].label;
}

export function actionDescription(action: Action): string {
  return ACTION_COPY[action].description;
}
