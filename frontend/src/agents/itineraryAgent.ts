import { z } from "zod";
import type { World } from "../app/useWorld.ts";
import type { Deliverable, DeliverableSection } from "../deliverables/types.ts";
import { signalEvidenceForCompany } from "../app/signalProvenance.ts";
import type { AgentContext, DeliverableAgent } from "./contract.ts";
import { validateRequiredSections } from "./contract.ts";
import { AGENT_RUBRICS } from "./rubrics.ts";

const Inputs = z.object({
  city: z.string().min(1),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  focus: z.enum(["prospecting", "customers", "mixed"]).default("mixed"),
  instructions: z.string().optional(),
});

type Inputs = z.infer<typeof Inputs>;
interface ItineraryStop {
  id: string;
  name: string;
  city: string;
  address: string;
  lat: number;
  lon: number;
  opportunity: number;
  fit: number;
  contact: string;
  trigger: string;
  talkingPoint: string;
  day: number;
  legMiles: number | null;
  legMinutes: number | null;
}

interface ItineraryContext extends AgentContext {
  stops: ItineraryStop[];
}

const sectionSpec = [
  { id: "schedule", heading: "Day-by-Day Schedule", required: true },
  { id: "map", heading: "Visit Map", required: true },
  { id: "briefs", heading: "Per-Stop Briefs", required: true },
  { id: "outreach", heading: "Intro Outreach Drafts", required: true },
];

function miles(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const toRad = (n: number) => (n * Math.PI) / 180;
  const earth = 3958.8;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return Math.round(earth * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
}

function marketCenter(city: string, world: World) {
  const companies = world.companies.filter((c) => c.location.city === city);
  const pool = companies.length ? companies : world.companies;
  return {
    lat: pool.reduce((sum, c) => sum + c.location.lat, 0) / Math.max(pool.length, 1),
    lon: pool.reduce((sum, c) => sum + c.location.lon, 0) / Math.max(pool.length, 1),
  };
}

function dayCount(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 1;
  return Math.min(5, Math.max(1, Math.round((end - start) / 86400000) + 1));
}

function driveMinutes(straightLineMiles: number): number {
  return Math.max(10, Math.round(straightLineMiles * 1.35));
}

function stripTerminalPunctuation(text: string): string {
  return text.replace(/\s+/g, " ").replace(/[.?!]\s*$/u, "").trim();
}

function fullTalkingPoint(capability: string, trigger: string): string {
  const cleanCapability = capability || "BTX production fit";
  const cleanTrigger = stripTerminalPunctuation(trigger);
  return `Lead with ${cleanCapability} because the validated signal points to active production need. Connect the source evidence to where BTX can reduce delivery risk or help the account move faster. Evidence: ${cleanTrigger}`;
}

function clusterStops<T extends { company: { location: { lat: number; lon: number } } }>(
  prospects: T[],
  center: { lat: number; lon: number },
  days: number,
): Array<{ prospect: T; day: number; legMiles: number | null }> {
  const maxLegMiles = 60;
  const remaining = [...prospects];
  const clustered: Array<{ prospect: T; day: number; legMiles: number | null }> = [];

  for (let day = 1; day <= days && remaining.length; day += 1) {
    const daySize = day === 1 ? 3 : 3;
    let previous: T | null = null;

    for (let slot = 0; slot < daySize && remaining.length; slot += 1) {
      const ranked = remaining
        .map((prospect, index) => {
          const legMiles = previous ? miles(previous.company.location, prospect.company.location) : 0;
          const distanceToCenter = miles(center, prospect.company.location);
          const score = (prospect as { opportunity?: number }).opportunity ?? 0;
          return { prospect, index, legMiles, distanceToCenter, score };
        })
        .filter((row) => !previous || row.legMiles <= maxLegMiles)
        .sort((a, b) => {
          if (previous) return a.legMiles - b.legMiles || b.score - a.score;
          return a.distanceToCenter - b.distanceToCenter || b.score - a.score;
        });
      const next = ranked[0];
      if (!next) break;
      remaining.splice(next.index, 1);
      clustered.push({ prospect: next.prospect, day, legMiles: previous ? next.legMiles : null });
      previous = next.prospect;
    }
  }

  return clustered;
}

export const itineraryAgent: DeliverableAgent<Inputs> = {
  id: "itinerary",
  audience: "internal",
  form: "itinerary",
  inputs: Inputs,
  outputSchema: sectionSpec,
  rubric: AGENT_RUBRICS.itinerary,
  contextRecipe(inputs: Inputs, world: World): AgentContext {
    const center = marketCenter(inputs.city, world);
    const prospects = world.prospects
      .filter((p) => {
        if (inputs.focus === "prospecting" && p.company.relationship !== "target") return false;
        if (inputs.focus === "customers" && p.company.relationship !== "customer") return false;
        return true;
      })
      .map((p) => ({ ...p, distance: miles(center, p.company.location) }))
      .sort((a, b) => (a.distance - b.distance) || (b.opportunity + b.fit.score - (a.opportunity + a.fit.score)))
      .slice(0, 14);
    const clusteredStops = clusterStops(prospects, center, dayCount(inputs.startDate, inputs.endDate)).slice(0, 8);
    const itineraryStops: ItineraryStop[] = clusteredStops.map(({ prospect: p, day, legMiles }) => ({
      id: p.company.id,
      name: p.company.name,
      city: p.company.location.city,
      address: [p.company.location.address, p.company.location.city, p.company.location.state].filter(Boolean).join(", "),
      lat: p.company.location.lat,
      lon: p.company.location.lon,
      opportunity: p.opportunity,
      fit: p.fit.score,
      contact: p.contact ? `${p.contact.name}, ${p.contact.title}` : "No contact available",
      trigger: signalEvidenceForCompany(p.company.name, p.topSignal, "No validated trigger attached"),
      talkingPoint: fullTalkingPoint(p.fit.matched[0] ?? "BTX production fit", signalEvidenceForCompany(p.company.name, p.topSignal, "No validated trigger attached")),
      day,
      legMiles,
      legMinutes: legMiles === null ? null : driveMinutes(legMiles),
    }));
    return {
      facts: {
        city: inputs.city,
        startDate: inputs.startDate,
        endDate: inputs.endDate,
        focus: inputs.focus,
        stopCount: itineraryStops.length,
      },
      entityIds: itineraryStops.map((p) => p.id),
      stops: itineraryStops,
      sources: [
        { source: "companies.json", records: clusteredStops.map((p) => p.prospect.company.id), reason: "Addresses, coordinates, relationship status, and market clustering." },
        { source: clusteredStops.some((p) => p.prospect.topSignal?.artifact) ? "monitor-engine artifacts" : "signals.json + news.json", records: clusteredStops.flatMap((p) => p.prospect.topSignal ? [p.prospect.topSignal.id] : []), reason: clusteredStops.some((p) => p.prospect.topSignal?.artifact) ? "Real monitor-engine trigger evidence with source names, dates, and artifact provenance." : "Trigger signals and why-now evidence for each stop." },
        { source: "contacts.json", records: clusteredStops.flatMap((p) => p.prospect.contact ? [p.prospect.contact.id] : []), reason: "Recommended contacts for meeting prep." },
      ],
    } as ItineraryContext;
  },
  async compose(ctx): Promise<Deliverable> {
    const itinerary = ctx as ItineraryContext;
    const stops = itinerary.stops;
    const slotsByDay = new Map<number, number>();
    const dayRows = stops.map((stop) => {
      const slotIndex = slotsByDay.get(stop.day) ?? 0;
      slotsByDay.set(stop.day, slotIndex + 1);
      const slot = ["9:00", "11:30", "14:30"][slotIndex] ?? "16:00";
      const travelNote = stop.legMinutes === null ? `Start in the ${stop.city} cluster` : `~${stop.legMinutes} min est. from prior stop`;
      return [String(stop.day), slot, stop.name, `${stop.address}. ${travelNote}.`];
    });
    const briefBlocks = stops.map((stop, index) => ({
      kind: "text" as const,
      text: `Stop ${index + 1}: ${stop.name}. Opportunity ${stop.opportunity}, fit ${stop.fit}%. Contact: ${stop.contact}. Why visit: ${stripTerminalPunctuation(stop.trigger)}. Talking point: ${stripTerminalPunctuation(stop.talkingPoint)}.`,
    }));
    return {
      id: `deliv-${Date.now()}-itinerary`,
      type: "itinerary",
      title: `${ctx.facts.city} Visit Plan`,
      createdAt: new Date().toISOString(),
      brainArea: "geographic",
      entityIds: stops.map((stop) => stop.id),
      confidence: stops.length >= 6 ? "high" : "medium",
      sections: [
        { id: "schedule", heading: "Day-by-Day Schedule", blocks: [{ kind: "table", columns: ["Day", "Time", "Account", "Travel note"], rows: dayRows }] },
        {
          id: "map",
          heading: "Visit Map",
          blocks: [{
            kind: "map-ref",
            title: `${ctx.facts.city} numbered stops`,
            entityIds: stops.map((stop) => stop.id),
            stops: stops.map((stop) => ({ entityId: stop.id, label: stop.name, day: stop.day, lat: stop.lat, lon: stop.lon })),
          }],
        },
        { id: "briefs", heading: "Per-Stop Briefs", blocks: briefBlocks },
        { id: "outreach", heading: "Intro Outreach Drafts", blocks: stops.slice(0, 4).map((stop, index) => ({ kind: "text", text: `Stop ${index + 1}: ${stop.name}, we saw this validated signal: ${stripTerminalPunctuation(stop.trigger)}. ${stripTerminalPunctuation(stop.talkingPoint)}. Would a 20-minute production-capacity discussion be useful while we are in market?` })) },
        { id: "methodology", heading: "Methodology Note", blocks: [{ kind: "text", text: "Travel estimates are planning approximations derived from straight-line distance, grouped to avoid back-to-back legs above roughly 60 miles where possible. They are not route-optimization or traffic estimates." }] },
      ],
      sources: ctx.sources,
      actions: [
        { id: "copy", label: "Copy", kind: "copy" },
        { id: "download", label: "Download Markdown", kind: "download_markdown" },
        { id: "calendar", label: "Add Trip to Calendar", kind: "simulated_send" },
      ],
    };
  },
  validate(deliverable, ctx) {
    const base = validateRequiredSections(deliverable, sectionSpec.map((s) => ({ id: s.id, heading: s.heading, blocks: [] })), ctx);
    if (deliverable.entityIds.length < 4) base.errors.push("Itinerary needs at least 4 clustered stops for the demo flow");
    return { valid: base.errors.length === 0, errors: base.errors };
  },
};
