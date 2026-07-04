import { useSyncExternalStore } from "react";
import type { BrainArea, SavedBrainNote } from "../brain/types.ts";
import type { Deliverable } from "../deliverables/types.ts";
import type { ActivityLogEntry, BrainMemoryNote, MemoryState } from "./types.ts";

const STORAGE_KEY = "btx.revenueBrain.memory.v1";

const emptyMemory: MemoryState = {
  notes: [],
  deliverables: [],
  activity: [],
};

let memory = load();
const listeners = new Set<() => void>();

function nowId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function load(): MemoryState {
  if (typeof window === "undefined") return emptyMemory;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyMemory;
    const parsed = JSON.parse(raw) as Partial<MemoryState>;
    return {
      notes: Array.isArray(parsed.notes) ? parsed.notes : [],
      deliverables: Array.isArray(parsed.deliverables) ? parsed.deliverables : [],
      activity: Array.isArray(parsed.activity) ? parsed.activity : [],
    };
  } catch {
    return emptyMemory;
  }
}

function persist(): void {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(memory));
  }
  listeners.forEach((listener) => listener());
}

function addActivity(entry: Omit<ActivityLogEntry, "id" | "createdAt">): ActivityLogEntry {
  const saved = { ...entry, id: nowId("act"), createdAt: new Date().toISOString() };
  memory = { ...memory, activity: [saved, ...memory.activity].slice(0, 100) };
  return saved;
}

export function saveBrainMemoryNote(note: SavedBrainNote): BrainMemoryNote {
  const saved = { ...note, id: nowId("note"), createdAt: new Date().toISOString() };
  memory = { ...memory, notes: [saved, ...memory.notes].slice(0, 100) };
  addActivity({
    kind: "note_saved",
    brainArea: note.brainArea,
    entityIds: note.entities,
    title: `Saved note: ${note.title}`,
    summary: note.summary,
  });
  persist();
  return saved;
}

export function saveDeliverable(deliverable: Deliverable): Deliverable {
  const existing = memory.deliverables.filter((d) => d.id !== deliverable.id);
  memory = { ...memory, deliverables: [deliverable, ...existing].slice(0, 40) };
  addActivity({
    kind: "deliverable_saved",
    brainArea: deliverable.brainArea,
    entityIds: deliverable.entityIds,
    title: `Created ${deliverable.title}`,
    summary: `${deliverable.sections.length} sections, ${deliverable.sources.length} provenance sources.`,
  });
  persist();
  return deliverable;
}

export function clearMemory(): void {
  memory = emptyMemory;
  persist();
}

export function recordSimulatedAction(input: {
  title: string;
  summary: string;
  brainArea?: BrainArea;
  entityIds?: string[];
}): ActivityLogEntry {
  const entry = addActivity({
    kind: "simulated_action",
    brainArea: input.brainArea ?? "workflow",
    entityIds: input.entityIds ?? [],
    title: input.title,
    summary: input.summary,
  });
  persist();
  return entry;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useMemory(): MemoryState {
  return useSyncExternalStore(subscribe, () => memory);
}

export function memoryCountsByArea(): Partial<Record<BrainArea, number>> {
  const counts: Partial<Record<BrainArea, number>> = {};
  for (const item of [...memory.notes, ...memory.deliverables, ...memory.activity]) {
    counts[item.brainArea] = (counts[item.brainArea] ?? 0) + 1;
  }
  return counts;
}
