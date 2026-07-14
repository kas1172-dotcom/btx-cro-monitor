import type { TabId } from "../app/surfaces.ts";
import type { SavedBrainNote } from "../brain/types.ts";
import type { Deliverable } from "../deliverables/types.ts";

export interface BrainMemoryNote extends SavedBrainNote {
  id: string;
  createdAt: string;
}

export interface ActivityLogEntry {
  id: string;
  createdAt: string;
  brainArea: TabId;
  entityIds: string[];
  title: string;
  summary: string;
  kind: "note_saved" | "deliverable_saved" | "simulated_action";
}

export interface MemoryState {
  notes: BrainMemoryNote[];
  deliverables: Deliverable[];
  activity: ActivityLogEntry[];
}
