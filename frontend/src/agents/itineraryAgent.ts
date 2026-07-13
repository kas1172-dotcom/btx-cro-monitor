import { z } from "zod";
import type { World } from "../app/useWorld.ts";
import type { Deliverable, DeliverableSection } from "../deliverables/types.ts";
import { signalEvidenceForCompany } from "../app/signalProvenance.ts";
import { rankingExplanation } from "../app/rankingExplain.ts";
import { PROFILE } from "../app/config.ts";
import type { AgentContext, DeliverableAgent } from "./contract.ts";
import { validateRequiredSections } from "./contract.ts";
import { AGENT_RUBRICS } from "./rubrics.ts";
import type { BusinessMotion } from "../engine/brain/entities.ts";
import type { SignalRelationship } from "../engine/signals/contract.ts";
import { scoreFit } from "../engine/decision/fit.ts";
import {
  canonicalAccountsFromCompanies,
  extractSignalEntities,
  resolveSignalRelationships,
} from "../identity/canonicalAccounts.ts";

const Inputs = z.object({
  city: z.string().min(1).optional(),
  startDate: z.string().min(1).optional(),
  endDate: z.string().min(1).optional(),
  region: z.string().min(1).optional(),
  radius: z.number().min(1).max(500).optional(),
  dateRange: z.object({
    startDate: z.string().min(1),
    endDate: z.string().min(1),
  }).optional(),
  goals: z.array(z.enum(["grow_existing_business", "manage_current_business", "reduce_risk", "prospect_new_business"])).optional(),
  eventAnchor: z.object({
    name: z.string().optional(),
    date: z.string().optional(),
  }).optional(),
  meetingCapacity: z.number().int().min(1).max(20).optional(),
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

export interface RankedTripCandidate {
  companyId: string;
  score: number;
  whyRanked: string;
  evidence: string;
  confidence: number;
  relationship?: SignalRelationship;
}

interface ItineraryContext extends AgentContext {
  stops: ItineraryStop[];
  rankedCandidates: RankedTripCandidate[];
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
  const normalized = city.toLowerCase();
  const companies = world.companies.filter((c) =>
    c.location.city.toLowerCase() === normalized ||
    c.location.state?.toLowerCase() === normalized ||
    c.location.country?.toLowerCase() === normalized
  );
  const pool = companies.length ? companies : world.companies;
  return {
    lat: pool.reduce((sum, c) => sum + c.location.lat, 0) / Math.max(pool.length, 1),
    lon: pool.reduce((sum, c) => sum + c.location.lon, 0) / Math.max(pool.length, 1),
  };
}

function inputRegion(inputs: Inputs, world: World): string {
  return inputs.region ?? inputs.city ?? world.city ?? world.companies[0]?.location.city ?? "All markets";
}

function inputStartDate(inputs: Inputs): string {
  return inputs.dateRange?.startDate ?? inputs.startDate ?? new Date().toISOString().slice(0, 10);
}

function inputEndDate(inputs: Inputs): string {
  return inputs.dateRange?.endDate ?? inputs.endDate ?? inputStartDate(inputs);
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

function signalText(signal: NonNullable<ReturnType<typeof topSignalForCompany>>): string {
  return [signal.artifact?.headline, signal.source_quote, signal.entities.join(" ")].filter(Boolean).join(" ");
}

function topSignalForCompany(world: World, companyId: string) {
  const company = world.companies.find((candidate) => candidate.id === companyId || candidate.canonical_account_id === companyId);
  const canonicalId = company?.canonical_account_id ?? companyId;
  return world.analysis.valid
    .filter((signal) =>
      signal.subject_id === companyId ||
      signal.subject_id === canonicalId ||
      signal.relationships?.some((relationship) => relationship.canonical_account_id === canonicalId)
    )
    .sort((a, b) => b.confidence - a.confidence || b.detected_at.localeCompare(a.detected_at))[0];
}

function relationshipForCandidate(world: World, companyId: string): SignalRelationship | undefined {
  const company = world.companies.find((candidate) => candidate.id === companyId || candidate.canonical_account_id === companyId);
  const signal = topSignalForCompany(world, companyId);
  if (!company || !signal) return undefined;
  const account = canonicalAccountsFromCompanies([company]);
  const entities = extractSignalEntities(signalText(signal), signal.entities);
  const resolved = resolveSignalRelationships(entities, account);
  return resolved.relationships[0] ?? signal.relationships?.find((relationship) =>
    relationship.canonical_account_id === (company.canonical_account_id ?? company.id)
  );
}

function confidenceForCandidate(world: World, companyId: string, score: number): number {
  const relationship = relationshipForCandidate(world, companyId);
  const signal = topSignalForCompany(world, companyId);
  if (relationship) return relationship.confidence;
  if (signal) return signal.confidence;
  return Math.max(0.45, Math.min(0.7, score / 180));
}

function rankedCandidatesForInputs(inputs: Inputs, world: World): RankedTripCandidate[] {
  const region = inputRegion(inputs, world).toLowerCase();
  const center = marketCenter(inputRegion(inputs, world), world);
  const goals = new Set<BusinessMotion>(inputs.goals ?? []);
  const capacity = inputs.meetingCapacity ?? 8;
  const radius = inputs.radius ?? 120;
  return world.companies
    .filter((company) => {
      const regionMatch =
        !region ||
        region === "all markets" ||
        company.location.city.toLowerCase().includes(region) ||
        company.location.state?.toLowerCase().includes(region) ||
        company.location.country?.toLowerCase().includes(region);
      const distanceMatch = miles(center, company.location) <= radius;
      const goalMatch = goals.size === 0 || (company.business_motion ? goals.has(company.business_motion) : false);
      return (regionMatch || distanceMatch) && goalMatch;
    })
    .map((company) => {
      const prospect = world.prospects.find((candidate) => candidate.company.id === company.id);
      const scoreTrace = world.analysis.byId.get(company.id) ?? (company.canonical_account_id ? world.analysis.byId.get(company.canonical_account_id) : undefined);
      const fit = prospect?.fit.score ?? scoreFit(company.needs, PROFILE.capabilities).score;
      const opportunity = prospect?.opportunity ?? scoreTrace?.dimensions.opportunity.score ?? 0;
      const distance = miles(center, company.location);
      const motionBoost = inputs.goals?.includes(company.business_motion as BusinessMotion) ? 18 : 0;
      const distancePenalty = Math.min(24, distance / 10);
      const score = Math.round(opportunity + fit + motionBoost - distancePenalty);
      const confidence = confidenceForCandidate(world, company.id, score);
      const signal = topSignalForCompany(world, company.id);
      const relationship = relationshipForCandidate(world, company.id);
      const why = rankingExplanation(world, company, {
        dimension: "opportunity",
        fitScore: fit,
      });
      return {
        companyId: company.id,
        score,
        whyRanked: why.rationaleLine,
        evidence: relationship?.evidence ?? signal?.source_quote ?? "No account-specific evidence yet.",
        confidence,
        relationship,
      };
    })
    .sort((a, b) => b.score - a.score || b.confidence - a.confidence || a.companyId.localeCompare(b.companyId))
    .slice(0, capacity);
}

export function buildItineraryContext(rawInputs: unknown, world: World): ItineraryContext {
  const parsed = Inputs.safeParse(rawInputs);
  if (!parsed.success) {
    throw new Error(`Invalid itinerary inputs: ${parsed.error.issues.map((issue) => issue.message).join(", ")}`);
  }
  return itineraryAgent.contextRecipe(parsed.data, world) as ItineraryContext;
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
    const region = inputRegion(inputs, world);
    const startDate = inputStartDate(inputs);
    const endDate = inputEndDate(inputs);
    const rankedCandidates = rankedCandidatesForInputs(inputs, world);
    const candidateIds = new Set(rankedCandidates.map((candidate) => candidate.companyId));
    const center = marketCenter(region, world);
    const prospects = world.companies
      .filter((company) => {
        if (inputs.focus === "prospecting" && company.relationship !== "target") return false;
        if (inputs.focus === "customers" && company.relationship !== "customer") return false;
        if (candidateIds.size && !candidateIds.has(company.id)) return false;
        return true;
      })
      .map((company) => {
        const prospect = world.prospects.find((candidate) => candidate.company.id === company.id);
        const scoreTrace = world.analysis.byId.get(company.id) ?? (company.canonical_account_id ? world.analysis.byId.get(company.canonical_account_id) : undefined);
        const fitResult = prospect?.fit ?? scoreFit(company.needs, PROFILE.capabilities);
        return {
          company,
          opportunity: prospect?.opportunity ?? scoreTrace?.dimensions.opportunity.score ?? 0,
          fit: fitResult,
          contact: prospect?.contact ?? world.contacts.find((contact) => contact.company_id === company.id),
          topSignal: prospect?.topSignal ?? topSignalForCompany(world, company.id),
          distance: miles(center, company.location),
        };
      })
      .sort((a, b) => (a.distance - b.distance) || (b.opportunity + b.fit.score - (a.opportunity + a.fit.score)))
      .slice(0, 14);
    const clusteredStops = clusterStops(prospects, center, dayCount(startDate, endDate)).slice(0, inputs.meetingCapacity ?? 8);
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
        city: region,
        region,
        startDate,
        endDate,
        focus: inputs.focus,
        goals: (inputs.goals ?? []).join(", "),
        eventAnchor: [inputs.eventAnchor?.name, inputs.eventAnchor?.date].filter(Boolean).join(" on "),
        stopCount: itineraryStops.length,
      },
      entityIds: itineraryStops.map((p) => p.id),
      stops: itineraryStops,
      rankedCandidates,
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
    if (deliverable.entityIds.length < 1) base.errors.push("Itinerary needs at least one clustered stop.");
    return { valid: base.errors.length === 0, errors: base.errors };
  },
};
