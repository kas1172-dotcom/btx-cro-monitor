import { z } from "zod";
import type { World } from "../app/useWorld.ts";
import type { Deliverable } from "../deliverables/types.ts";
import { PROFILE } from "../app/config.ts";
import { signalEvidence, signalFigureContext } from "../app/signalProvenance.ts";
import type { AgentContext, DeliverableAgent } from "./contract.ts";
import { validateRequiredSections } from "./contract.ts";
import { AGENT_RUBRICS } from "./rubrics.ts";

const Inputs = z.object({
  accountId: z.string().optional(),
  instructions: z.string().optional(),
});

type Inputs = z.infer<typeof Inputs>;

const PREFERRED_CONTACT_TITLES = ["operations", "supply", "engineering", "procurement", "program", "sourcing"];

function firstName(name: string): string {
  return name.split(/\s+/)[0] ?? name;
}

function cleanSentence(text: string): string {
  return text.replace(/\s+/g, " ").replace(/[.?!]\s*$/u, "").trim();
}

function chooseVariant(accountName: string): number {
  return accountName.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0) % 3;
}

function publicHook(accountName: string, hook: string): string {
  if (!hook || hook === "No public hook available") return `${accountName} appears to be adding production work`;
  return cleanSentence(hook)
    .replace(/^A customer /, "Your customer ")
    .replace(/\bvalidated\b/gi, "public")
    .replace(/\bsignals?\b/gi, "shows")
    .replace(/\bopportunity score\b/gi, "timing")
    .replace(/\bfit %\b/gi, "fit")
    .replace(/\brisk score\b/gi, "risk");
}

function emailBody(input: {
  contactName: string;
  accountName: string;
  city: string;
  hook: string;
  capability: string;
  senderName: string;
  senderTitle: string;
}): string {
  const first = firstName(input.contactName);
  const hook = publicHook(input.accountName, input.hook);
  const variants = [
    `Hi ${first},\n\nI saw ${hook}. We're a precision machining shop in ${PROFILE.home_city} with open 5-axis capacity, AS9100/ITAR coverage, and a team that can help when production schedules tighten around ${input.capability}. Would you be open to a 20-minute call next week to compare what you need against where we may be able to help?\n\n${input.senderName}\n${input.senderTitle}, ${PROFILE.name}`,
    `Hi ${first},\n\nI noticed ${hook}. ${PROFILE.name} supports aerospace and defense teams with ${input.capability}, 5-axis machining, and certified build-to-print work when programs need qualified outside capacity. Could we schedule 20 minutes next week to see whether there is a useful fit?\n\n${input.senderName}\n${input.senderTitle}, ${PROFILE.name}`,
    `Hi ${first},\n\nI saw ${hook}. We run certified precision machining capacity out of ${PROFILE.home_city}, and the work you are managing looks close to where ${input.capability} and quick-turn production support can matter. Are you open to a short conversation next week?\n\n${input.senderName}\n${input.senderTitle}, ${PROFILE.name}`,
  ];
  return variants[chooseVariant(input.accountName)];
}

function confidence(contactAvailable: boolean, signalAvailable: boolean, capacityAvailable: boolean): Deliverable["confidence"] {
  if (contactAvailable && signalAvailable && capacityAvailable) return "high";
  if (signalAvailable || contactAvailable) return "medium";
  return "low";
}

const sectionSpec = [
  { id: "recipient", heading: "Recipient", required: true },
  { id: "subject", heading: "Subject", required: true },
  { id: "body", heading: "Body", required: true },
  { id: "why-this-works", heading: "Why This Works", required: true },
  { id: "provenance", heading: "Provenance", required: true },
];

export const outreachAgent: DeliverableAgent<Inputs> = {
  id: "outreach",
  audience: "prospect",
  form: "email",
  inputs: Inputs,
  outputSchema: sectionSpec,
  rubric: AGENT_RUBRICS.outreach,
  contextRecipe(inputs: Inputs, world: World): AgentContext {
    const prospect = inputs.accountId
      ? world.prospects.find((p) => p.company.id === inputs.accountId)
      : world.prospects[0];
    if (!prospect) throw new Error("No prospect available for outreach");
    const contacts = world.contacts.filter((contact) => contact.company_id === prospect.company.id);
    const preferred = contacts.find((contact) => PREFERRED_CONTACT_TITLES.some((term) => contact.title.toLowerCase().includes(term)));
    const contact = preferred ?? contacts[0];
    const contactNote = preferred ? "Role matched to operations, supply chain, engineering, procurement, program, or sourcing." : "No operations-oriented contact was available; using the best available contact.";
    const hasCapacity = Boolean(world.snapshot?.capacity.length);
    return {
      facts: {
        accountName: prospect.company.name,
        city: prospect.company.location.city,
        opportunityScore: prospect.opportunity,
        fitScore: prospect.fit.score,
        contactName: contact?.name ?? "Operations team",
        contactTitle: contact?.title ?? "No named contact",
        contact: contact ? `${contact.name}, ${contact.title}` : "Operations team",
        contactNote,
        hook: signalEvidence(prospect.topSignal, "No public hook available"),
        artifactSignalFigures: signalFigureContext(prospect.topSignal ? [prospect.topSignal] : []),
        capability: prospect.fit.matched[0] ?? "certified production support",
        sourceCount: [prospect.company.id, prospect.topSignal?.id, contact?.id].filter(Boolean).length,
        senderName: PROFILE.sender_name,
        senderTitle: PROFILE.sender_title,
        hasSignal: Boolean(prospect.topSignal),
        hasContact: Boolean(contact),
        hasCapacity,
      },
      entityIds: [prospect.company.id],
      sources: [
        { source: "companies.json", records: [prospect.company.id], reason: "Account and location context." },
        { source: prospect.topSignal?.artifact ? "monitor-engine artifacts" : "signals.json + news.json", records: prospect.topSignal ? [prospect.topSignal.id] : [], reason: prospect.topSignal?.artifact ? `Specific outreach hook from ${prospect.topSignal.artifact.source_name} on ${prospect.topSignal.artifact.source_date.slice(0, 10)}.` : "Specific outreach hook." },
        { source: "contacts.json", records: contact ? [contact.id] : [], reason: "Recipient context." },
      ],
    };
  },
  async compose(ctx): Promise<Deliverable> {
    const f = ctx.facts;
    const body = emailBody({
      contactName: String(f.contactName),
      accountName: String(f.accountName),
      city: String(f.city),
      hook: String(f.hook),
      capability: String(f.capability),
      senderName: String(f.senderName),
      senderTitle: String(f.senderTitle),
    });
    const conf = confidence(Boolean(f.hasContact), Boolean(f.hasSignal), Boolean(f.hasCapacity));
    return {
      id: `deliv-${Date.now()}-outreach`,
      type: "outreach",
      title: `Draft Outreach - ${f.accountName}`,
      createdAt: new Date().toISOString(),
      brainArea: "work_queue",
      entityIds: ctx.entityIds,
      confidence: conf,
      confidenceReason: conf === "high" ? "High: named contact, public business hook, and capacity context are available." : conf === "medium" ? `Medium: ${f.contactNote}` : "Low: missing named contact and public business hook.",
      sections: [
        {
          id: "recipient",
          heading: "Recipient",
          blocks: [
            { kind: "text", text: `${f.contact} at ${f.accountName}.` },
          ],
        },
        {
          id: "subject",
          heading: "Subject",
          blocks: [
            { kind: "text", text: `${f.accountName} production-capacity conversation` },
          ],
        },
        {
          id: "body",
          heading: "Body",
          audience: "prospect",
          blocks: [
            { kind: "text", text: body },
          ],
        },
        {
          id: "why-this-works",
          heading: "Why This Works",
          audience: "internal",
          blocks: [
            { kind: "text", text: `Internal rationale: outreach uses opportunity score ${f.opportunityScore}, fit ${f.fitScore}%, contact selection note "${f.contactNote}", and the top public hook "${f.hook}".` },
          ],
        },
        {
          id: "provenance",
          heading: "Provenance",
          audience: "internal",
          blocks: [
            { kind: "text", text: `Internal source note: built from ${f.sourceCount} account, contact, and evidence records.` },
          ],
        },
      ],
      sources: ctx.sources,
      actions: [
        { id: "copy", label: "Copy", kind: "copy" },
        { id: "send", label: "Send via Outlook", kind: "simulated_send" },
      ],
    };
  },
  validate(deliverable, ctx) {
    return validateRequiredSections(deliverable, sectionSpec.map((s) => ({ id: s.id, heading: s.heading, blocks: [] })), ctx);
  },
};
