import type { BrainArea, SavedBrainNote } from "./types.ts";

export function saveBrainNote(input: { title: string; brainArea: BrainArea; summary: string; entities?: string[] }): SavedBrainNote {
  return {
    title: input.title,
    brainArea: input.brainArea,
    summary: input.summary,
    entities: input.entities ?? [],
  };
}
