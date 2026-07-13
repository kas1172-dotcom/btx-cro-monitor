import { useCallback, useEffect, useMemo, useState } from "react";
import type { AgentId } from "../agents/runAgent.ts";
import {
  BACKEND_ENDPOINT,
  listBackendDeliverableTemplates,
  patchBackendDeliverableTemplate,
  type BackendDeliverableTemplate,
} from "./backendApi.ts";

export interface DeliverableTemplateMeta {
  agent_id: AgentId;
  label: string;
  enabled: boolean;
  order: number;
  prompt_override?: string | null;
  updated_at?: string;
}

export const DEFAULT_DELIVERABLE_TEMPLATES: DeliverableTemplateMeta[] = [
  { agent_id: "weekly_memo", label: "Weekly memo", enabled: true, order: 10 },
  { agent_id: "meeting_brief", label: "Meeting brief", enabled: true, order: 20 },
  { agent_id: "itinerary", label: "Trip itinerary", enabled: true, order: 30 },
  { agent_id: "board_deck", label: "Board deck", enabled: true, order: 40 },
  { agent_id: "outreach", label: "Outreach draft", enabled: true, order: 50 },
  { agent_id: "analysis_annotation", label: "Analysis annotation", enabled: true, order: 60 },
  { agent_id: "sales_pitch", label: "Sales pitch", enabled: true, order: 70 },
  { agent_id: "capabilities_assessment", label: "Capabilities assessment", enabled: true, order: 80 },
];

export const DEFAULT_TEMPLATE_PROMPTS: Record<AgentId, string> = {
  weekly_memo: "Summarize the week for a CRO using grounded account, program, and market evidence.",
  meeting_brief: "Prepare a concise account meeting brief with agenda, current signals, risks, and next actions.",
  itinerary: "Plan a trip around ranked stops, logistics, and meeting priorities.",
  board_deck: "Build an executive-ready board deck with figures, risks, opportunities, and provenance.",
  outreach: "Draft direct outreach tied to a specific account signal and a clear ask.",
  analysis_annotation: "Explain a chart or metric view in plain revenue-leadership language.",
  sales_pitch: "Create a value-oriented sales pitch grounded in the account's needs and BTX capabilities.",
  capabilities_assessment: "Assess whether BTX can credibly serve an account's requirements and constraints.",
};

const TEMPLATE_STORAGE_KEY = "btx.settings.deliverable_templates";

function isAgentId(value: string): value is AgentId {
  return DEFAULT_DELIVERABLE_TEMPLATES.some((item) => item.agent_id === value);
}

function normalizeTemplate(record: BackendDeliverableTemplate | DeliverableTemplateMeta): DeliverableTemplateMeta | null {
  if (!isAgentId(record.agent_id)) return null;
  return {
    agent_id: record.agent_id,
    label: record.label,
    enabled: record.enabled,
    order: record.order,
    prompt_override: record.prompt_override ?? null,
    updated_at: record.updated_at,
  };
}

export function normalizeDeliverableTemplates(records: Array<BackendDeliverableTemplate | DeliverableTemplateMeta>): DeliverableTemplateMeta[] {
  const byAgent = new Map(DEFAULT_DELIVERABLE_TEMPLATES.map((template) => [template.agent_id, { ...template }]));
  for (const record of records) {
    const normalized = normalizeTemplate(record);
    if (normalized) byAgent.set(normalized.agent_id, { ...byAgent.get(normalized.agent_id), ...normalized });
  }
  return [...byAgent.values()].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
}

export function enabledTemplatesForAgents(templates: DeliverableTemplateMeta[], agentIds: AgentId[]): DeliverableTemplateMeta[] {
  const allowed = new Set(agentIds);
  return normalizeDeliverableTemplates(templates)
    .filter((template) => template.enabled && allowed.has(template.agent_id));
}

export function reorderTemplates(
  templates: DeliverableTemplateMeta[],
  agentId: AgentId,
  direction: "up" | "down",
): DeliverableTemplateMeta[] {
  const sorted = normalizeDeliverableTemplates(templates);
  const index = sorted.findIndex((template) => template.agent_id === agentId);
  const swapWith = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || swapWith < 0 || swapWith >= sorted.length) return sorted;
  const current = sorted[index];
  const other = sorted[swapWith];
  const next = sorted.map((template) => {
    if (template.agent_id === current.agent_id) return { ...template, order: other.order };
    if (template.agent_id === other.agent_id) return { ...template, order: current.order };
    return template;
  });
  return normalizeDeliverableTemplates(next);
}

function readLocalTemplates(): DeliverableTemplateMeta[] {
  if (typeof window === "undefined") return DEFAULT_DELIVERABLE_TEMPLATES;
  try {
    const raw = window.localStorage.getItem(TEMPLATE_STORAGE_KEY);
    return normalizeDeliverableTemplates(raw ? JSON.parse(raw) as DeliverableTemplateMeta[] : DEFAULT_DELIVERABLE_TEMPLATES);
  } catch {
    return DEFAULT_DELIVERABLE_TEMPLATES;
  }
}

function writeLocalTemplates(templates: DeliverableTemplateMeta[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(normalizeDeliverableTemplates(templates)));
}

export function useDeliverableTemplates() {
  const [templates, setTemplates] = useState<DeliverableTemplateMeta[]>(() => readLocalTemplates());
  const [status, setStatus] = useState(BACKEND_ENDPOINT ? "Loading deliverable templates..." : "Local template settings.");

  useEffect(() => {
    let alive = true;
    if (!BACKEND_ENDPOINT) return;
    listBackendDeliverableTemplates()
      .then((records) => {
        if (!alive) return;
        setTemplates(normalizeDeliverableTemplates(records));
        setStatus("Loaded from backend.");
      })
      .catch((error) => {
        if (alive) setStatus(error instanceof Error ? error.message : "Could not load deliverable templates.");
      });
    return () => {
      alive = false;
    };
  }, []);

  const patchTemplate = useCallback(async (agentId: AgentId, patch: Partial<Omit<DeliverableTemplateMeta, "agent_id" | "updated_at">>) => {
    const optimistic = normalizeDeliverableTemplates(templates.map((template) => (
      template.agent_id === agentId ? { ...template, ...patch } : template
    )));
    setTemplates(optimistic);
    if (!BACKEND_ENDPOINT) {
      writeLocalTemplates(optimistic);
      setStatus("Saved to local template settings.");
      return optimistic.find((template) => template.agent_id === agentId);
    }
    try {
      const saved = await patchBackendDeliverableTemplate(agentId, patch);
      const next = normalizeDeliverableTemplates(optimistic.map((template) => (
        template.agent_id === agentId ? { ...template, ...saved } : template
      )));
      setTemplates(next);
      setStatus("Saved to backend.");
      return next.find((template) => template.agent_id === agentId);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Template update failed.");
      throw error;
    }
  }, [templates]);

  const moveTemplate = useCallback(async (agentId: AgentId, direction: "up" | "down") => {
    const reordered = reorderTemplates(templates, agentId, direction);
    setTemplates(reordered);
    if (!BACKEND_ENDPOINT) {
      writeLocalTemplates(reordered);
      setStatus("Saved to local template settings.");
      return;
    }
    const changed = reordered.filter((next) => templates.find((current) => current.agent_id === next.agent_id)?.order !== next.order);
    try {
      await Promise.all(changed.map((template) => patchBackendDeliverableTemplate(template.agent_id, { order: template.order })));
      setStatus("Saved order to backend.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Template reorder failed.");
      throw error;
    }
  }, [templates]);

  return useMemo(() => ({
    templates: normalizeDeliverableTemplates(templates),
    status,
    patchTemplate,
    moveTemplate,
  }), [moveTemplate, patchTemplate, status, templates]);
}
