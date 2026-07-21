import { z } from "zod";
import type { AgentContext, DeliverableAgent } from "./contract.ts";
import { validateRequiredSections } from "./contract.ts";
import { AGENT_RUBRICS } from "./rubrics.ts";
import type { Deliverable, DeliverableSection, ProvenanceEntry } from "../deliverables/types.ts";

const Inputs = z.object({
  itinerary: z.custom<Deliverable>((value) => Boolean(value && typeof value === "object" && "sections" in value)),
  meetingBriefs: z.array(z.custom<Deliverable>((value) => Boolean(value && typeof value === "object" && "sections" in value))).default([]),
  logistics: z.string().optional(),
});

type Inputs = z.infer<typeof Inputs>;

interface TripBriefContext extends AgentContext {
  itinerary: Deliverable;
  meetingBriefs: Deliverable[];
  logistics: string;
}

const sectionSpec = [
  { id: "itinerary-logistics", heading: "Itinerary and Logistics", required: true },
];

function uniq<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function textFromSection(section: DeliverableSection): string {
  return section.blocks.map((block) => {
    if (block.kind === "text") return block.text;
    if (block.kind === "table") return [block.columns.join(" | "), ...block.rows.map((row) => row.join(" | "))].join("\n");
    if (block.kind === "map-ref") return block.title;
    return block.title;
  }).join("\n");
}

function compactSources(deliverables: Deliverable[]): ProvenanceEntry[] {
  return deliverables.flatMap((deliverable) => deliverable.sources ?? []);
}

export const tripBriefAgent: DeliverableAgent<Inputs> = {
  id: "trip_brief",
  audience: "internal",
  form: "brief",
  inputs: Inputs,
  outputSchema: sectionSpec,
  rubric: AGENT_RUBRICS.trip_brief,
  contextRecipe(inputs: Inputs): AgentContext {
    const deliverables = [inputs.itinerary, ...inputs.meetingBriefs];
    return {
      facts: {
        itineraryTitle: inputs.itinerary.title,
        stopCount: inputs.meetingBriefs.length,
        logistics: inputs.logistics ?? "Confirm driving order, meeting owners, and buffer time before departure.",
      },
      entityIds: uniq(deliverables.flatMap((deliverable) => deliverable.entityIds)),
      sources: [
        ...compactSources(deliverables),
        { source: "trip planner", records: deliverables.map((deliverable) => deliverable.id), reason: "Compiled itinerary and per-stop meeting briefs into one trip brief." },
      ],
      itinerary: inputs.itinerary,
      meetingBriefs: inputs.meetingBriefs,
      logistics: inputs.logistics ?? "Confirm driving order, meeting owners, and buffer time before departure.",
    } as TripBriefContext;
  },
  async compose(ctx): Promise<Deliverable> {
    const trip = ctx as TripBriefContext;
    const schedule = trip.itinerary.sections.find((section) => section.id === "schedule");
    const map = trip.itinerary.sections.find((section) => section.id === "map");
    const stopSections: DeliverableSection[] = trip.meetingBriefs.map((brief, index) => ({
      id: `stop-${index + 1}-${brief.id}`,
      heading: `Stop ${index + 1}: ${brief.title}`,
      blocks: [
        { kind: "text", text: textFromSection(brief.sections[0] ?? { id: "summary", heading: "Summary", blocks: [] }) },
        ...brief.sections.slice(1).flatMap((section) => section.blocks),
      ],
      audience: "internal",
    }));
    return {
      id: `deliv-${Date.now()}-trip-brief`,
      type: "itinerary",
      title: `Trip Brief: ${trip.itinerary.title}`,
      createdAt: new Date().toISOString(),
      brainArea: "trip_planner",
      entityIds: trip.entityIds,
      sections: [
        {
          id: "itinerary-logistics",
          heading: "Itinerary and Logistics",
          blocks: [
            { kind: "text", text: `Logistics: ${trip.logistics}` },
            ...(schedule?.blocks ?? []),
            ...(map?.blocks ?? []),
          ],
          audience: "internal",
        },
        ...stopSections,
      ],
      sources: trip.sources,
      confidence: trip.meetingBriefs.length >= 2 ? "high" : "medium",
      confidenceReason: `${trip.meetingBriefs.length} per-stop meeting brief${trip.meetingBriefs.length === 1 ? "" : "s"} compiled with the itinerary.`,
      audience: "internal",
      form: "brief",
      actions: [
        { id: "copy", label: "Copy", kind: "copy" },
        { id: "download", label: "Download Markdown", kind: "download_markdown" },
      ],
    };
  },
  validate(deliverable, ctx) {
    const result = validateRequiredSections(deliverable, sectionSpec.map((section) => ({ id: section.id, heading: section.heading, blocks: [] })), ctx);
    if (!deliverable.sections.some((section) => section.id.startsWith("stop-"))) {
      result.errors.push("Trip brief requires at least one per-stop meeting brief section.");
    }
    return { valid: result.errors.length === 0, errors: result.errors };
  },
};
