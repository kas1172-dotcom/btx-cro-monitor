import type { SettingsSection } from "../store/store.ts";

export interface SettingsSectionSpec {
  id: SettingsSection;
  label: string;
  summary: string;
}

export const SETTINGS_SECTIONS: SettingsSectionSpec[] = [
  {
    id: "general",
    label: "General & history",
    summary: "Clear local Ask threads, saved memory, and reset this workspace.",
  },
  {
    id: "memory",
    label: "Memory",
    summary: "Saved notes, generated deliverables, and local activity history.",
  },
  {
    id: "engine",
    label: "Engine tuning",
    summary: "Client-tunable scoring, thresholds, targets, capacity assumptions, and profile settings.",
  },
  {
    id: "sources",
    label: "Source admin",
    summary: "Monitor source registry, collection runs, and source requests.",
  },
  {
    id: "integrations",
    label: "Integrations",
    summary: "Review integration capabilities, environments, and guarded external actions.",
  },
];
