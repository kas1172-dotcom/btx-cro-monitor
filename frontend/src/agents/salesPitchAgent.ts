import { z } from "zod";
import type { World } from "../app/useWorld.ts";
import type { Deliverable } from "../deliverables/types.ts";
import { PROFILE } from "../app/config.ts";
import { scoreFit } from "../engine/decision/fit.ts";
import type { AgentContext, DeliverableAgent } from "./contract.ts";
import { validateRequiredSections } from "./contract.ts";
import { AGENT_RUBRICS } from "./rubrics.ts";

const Inputs = z.object({
  accountId: z.string().optional(),
  segment: z.string().optional(),
  instructions: z.string().optional(),
});

type Inputs = z.infer<typeof Inputs>;

const sectionSpec = [
  { id: "opening-hook", heading: "Opening Hook", required: true },
  { id: "what-btx-does", heading: "What BTX Does for Companies Like Them", required: true },
  { id: "proof-points", heading: "Proof Points", required: true },
  { id: "why-now", heading: "Why Now", required: true },
  { id: "the-ask", heading: "The Ask", required: true },
];

function clean(text: string): string {
  return text.replace(/\s+/g, " ").replace(/[.?!]\s*$/u, "").trim();
}

function firstAccount(world: World, accountId?: string): World["prospects"][number] {
  const prospect = accountId
    ? world.prospects.find((item) => item.company.id === accountId)
    : world.prospects[0];
  if (!prospect) throw new Error("No account available for sales pitch");
  return prospect;
}

export const salesPitchAgent: DeliverableAgent<Inputs> = {
  id: "sales_pitch",
  audience: "prospect",
  form: "one_pager",
  inputs: Inputs,
  outputSchema: sectionSpec,
  rubric: AGENT_RUBRICS.sales_pitch,
  contextRecipe(inputs: Inputs, world: World): AgentContext {
    const prospect = firstAccount(world, inputs.accountId);
    const fit = scoreFit(prospect.company.needs, PROFILE.capabilities);
    const contact = world.contacts.find((item) => item.company_id === prospect.company.id);
    const topSignal = prospect.topSignal;
    const capacity = world.snapshot?.capacity.find((item) => item.city === prospect.company.location.city) ?? world.snapshot?.capacity[0];
    return {
      facts: {
        accountName: prospect.company.name,
        segment: inputs.segment ?? prospect.company.account_status ?? prospect.company.relationship,
        city: prospect.company.location.city,
        hook: topSignal?.source_quote ?? `${prospect.company.name} appears to be evaluating outside production support`,
        publicTrigger: topSignal ? clean(topSignal.source_quote) : "a visible production need",
        matchedCapabilities: fit.matched.slice(0, 3).join(", ") || "certified precision machining",
        capacityLine: capacity ? `${capacity.facility_name} has available 5-axis capacity with quoted lead time of ${capacity.quoted_lead_time_days} days` : "BTX can qualify capacity after the first conversation",
        contactName: contact?.name ?? "their operations leader",
        senderName: PROFILE.sender_name,
        senderTitle: PROFILE.sender_title,
      },
      entityIds: [prospect.company.id],
      sources: [
        { source: "companies.json", records: [prospect.company.id], reason: "Account profile, market, and stated needs." },
        { source: "signals.json + news.json", records: topSignal ? [topSignal.id] : [], reason: "Account-specific public trigger." },
        { source: "erp_capacity.json", records: capacity ? [capacity.facility_id] : [], reason: "Capacity context used for the pitch." },
      ],
    };
  },
  async compose(ctx): Promise<Deliverable> {
    const f = ctx.facts;
    const hook = clean(String(f.hook));
    return {
      id: `deliv-${Date.now()}-sales-pitch`,
      type: "sales_pitch",
      title: `Sales Pitch - ${f.accountName}`,
      createdAt: new Date().toISOString(),
      brainArea: "workflow",
      entityIds: ctx.entityIds,
      confidence: "high",
      confidenceReason: "High: account need, public trigger, fit, and capacity context are available.",
      sections: [
        {
          id: "opening-hook",
          heading: "Opening Hook",
          audience: "prospect",
          blocks: [{ kind: "text", text: `${f.accountName} is balancing new production demand with qualified supplier capacity.` }],
        },
        {
          id: "what-btx-does",
          heading: "What BTX Does for Companies Like Them",
          audience: "prospect",
          blocks: [{ kind: "text", text: `${PROFILE.name} helps aerospace and defense manufacturers move qualified machined work through certified outside capacity. For ${f.accountName}, the most relevant fit is ${f.matchedCapabilities}. We keep the conversation practical: prints, materials, timing, and what can be supported without overpromising.` }],
        },
        {
          id: "proof-points",
          heading: "Proof Points",
          audience: "prospect",
          blocks: [{ kind: "text", text: `BTX brings AS9100 and ITAR discipline, 5-axis machining capacity, build-to-print execution, and delivery follow-through for production teams that need dependable support.` }],
        },
        {
          id: "why-now",
          heading: "Why Now",
          audience: "prospect",
          blocks: [{ kind: "text", text: `Recent public evidence points to timing: ${hook}. That makes now a useful moment to compare what they need against where BTX may help.` }],
        },
        {
          id: "the-ask",
          heading: "The Ask",
          audience: "prospect",
          blocks: [{ kind: "text", text: `Ask ${f.contactName} for a 20-minute fit call with one current print package or work statement, then confirm materials, certifications, delivery window, and whether ${f.capacityLine}.` }],
        },
      ],
      sources: ctx.sources,
      actions: [
        { id: "copy", label: "Copy", kind: "copy" },
        { id: "task", label: "Create CRM Task", kind: "simulated_crm_task" },
      ],
    };
  },
  validate(deliverable, ctx) {
    return validateRequiredSections(deliverable, sectionSpec.map((section) => ({ id: section.id, heading: section.heading, blocks: [] })), ctx);
  },
};
