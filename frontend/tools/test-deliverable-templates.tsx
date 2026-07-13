import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildBoardDeck, buildSalesPitch } from "../src/deliverables/deck/pptx.ts";
import { assertNoEmDash, steelSignal } from "../src/deliverables/designTokens.ts";
import {
  Figure,
  ProvenanceCard,
  assertFigureMeta,
} from "../src/deliverables/steelSignalPrimitives.tsx";
import {
  RetentionEarningsHeatmap,
  renderSteelSignalDocument,
  signalScopeForEvidence,
  validateSteelSignalDeliverable,
} from "../src/deliverables/steelSignalTemplates.tsx";
import type { Deliverable } from "../src/deliverables/types.ts";
import type { World } from "../src/app/useWorld.ts";
import type { Signal, SignalRelationship } from "../src/engine/signals/contract.ts";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const relationship: SignalRelationship = {
  canonical_account_id: "hubspot-company-100",
  source_entity_name: "Monitor artifact to Lockheed Martin Corp (CAGE 81755)",
  match_method: "cage_uei",
  evidence: "CAGE 81755 and F-35 program",
  confidence: 0.94,
  review_status: "accepted",
  creation_source: "resolver",
  last_validated_at: "2026-07-12T12:00:00Z",
};

const accountSignal: Signal = {
  id: "sig-lockheed",
  event_type: "government_contract_award",
  entities: ["Lockheed Martin", "F-35"],
  subject_id: "hubspot-company-100",
  scope: "specific_account",
  relationships: [relationship],
  confidence: 0.96,
  source_quote: "Lockheed awards F-35 lot-19 sustainment; spares volume rises into FY27.",
  detected_at: "2026-07-12T12:00:00Z",
};

const marketSignal: Signal = {
  id: "sig-market",
  event_type: "regulatory_change",
  entities: ["DoD"],
  subject_id: "__portfolio__",
  scope: "unlinked",
  relationships: [],
  confidence: 0.9,
  source_quote: "DoD FY27 budget lifts precision-component demand across the market.",
  detected_at: "2026-07-12T12:00:00Z",
};

const world: World = {
  city: null,
  companies: [{
    id: "hubspot-company-100",
    canonical_account_id: "hubspot-company-100",
    hubspot_company_id: "100",
    name: "Lockheed Martin",
    relationship: "customer",
    account_status: "active_pipeline",
    business_motion: "grow_existing_business",
    location: { city: "Fort Worth", state: "TX", lat: 32.75, lon: -97.33, country: "USA" },
    needs: ["5-axis CNC machining", "AS9100D", "ITAR"],
    known_programs: ["F-35"],
  }],
  contacts: [{ id: "hubspot-contact-200", company_id: "hubspot-company-100", name: "Jordan Rivera", title: "Supply Chain Director" }],
  facilities: [],
  opportunities: [{ id: "opp-1", company_id: "hubspot-company-100", name: "F-35 spares", value: 2400000, stage: "qualified", close_date: "2026-09-30" }],
  analysis: {
    valid: [accountSignal, marketSignal],
    rejected: [],
    scores: [],
    byId: new Map(),
  },
  prospects: [],
  snapshot: {
    kpis: [],
    assumptions: [],
    capacity: [
      { facility_id: "fw", facility_name: "Fort Worth, TX", city: "Fort Worth", available_5_axis_hours_next_30d: 58, available_turning_hours_next_30d: 44, quoted_lead_time_days: 16, capacity_status: "limited", constraint: "AS9100 line" },
      { facility_id: "tulsa", facility_name: "Tulsa, OK", city: "Tulsa", available_5_axis_hours_next_30d: 210, available_turning_hours_next_30d: 150, quoted_lead_time_days: 9, capacity_status: "available now", constraint: "" },
    ],
    publicSignals: {
      signal_count: 2,
      news_count: 2,
      latest_signal_at: "2026-07-12T12:00:00Z",
      latest_news_date: "2026-07-12T12:00:00Z",
      source_name: "Monitor artifacts",
      source_mode: "artifact",
      run_at: "2026-07-12T12:00:00Z",
      archive_run_count: 1,
      artifact_path: "clients/btx/artifacts/run_output.json",
      stale: false,
      notice: null,
    },
  },
  dataSource: null,
  loadErrors: [],
  dataMode: "hybrid",
  provenanceSources: [],
  provenanceSummary: null,
};

function baseDeliverable(type: Deliverable["type"], title: string): Deliverable {
  return {
    id: `test-${type}`,
    type,
    title,
    createdAt: "2026-07-12T12:00:00Z",
    brainArea: type === "capabilities_assessment" ? "capacity" : type === "outreach" ? "work_queue" : "analysis",
    entityIds: ["hubspot-company-100"],
    confidence: "high",
    sections: [
      { id: "likely-need", heading: "What They Likely Need", blocks: [{ kind: "text", text: "F-35 lot-19 sustainment: build-to-print spares support with 91% capability fit." }] },
      { id: "subject", heading: "Subject", blocks: [{ kind: "text", text: "5-axis capacity for F-35 lot-19 build-to-print spares" }] },
      { id: "body", heading: "Body", blocks: [{ kind: "text", text: "Hi Jordan,\n\nCongratulations on the F-35 lot-19 sustainment award. BTX has open 5-axis capacity right now.\n\nBest regards,\nAlex Chen" }] },
      { id: "story", heading: "Story", blocks: [{ kind: "text", text: "Lockheed booked the F-35 lot-19 sustainment award; spares demand steps up through FY27." }] },
    ],
    sources: [{ source: "monitor-engine artifacts", records: ["sig-lockheed"], reason: "Relationship-backed account evidence." }],
    actions: [],
    audience: type === "weekly_memo" ? "internal" : "prospect",
    form: type === "outreach" ? "email" : type === "board_deck" ? "deck" : "one_pager",
  };
}

const provenance = renderToStaticMarkup(<ProvenanceCard relationship={relationship} />);
assert(provenance.includes("SOURCE"), "ProvenanceCard should render SOURCE eyebrow");
assert(provenance.includes("cage uei"), "ProvenanceCard should render match method");
assert(provenance.includes("high confidence"), "ProvenanceCard should render confidence");

const figure = renderToStaticMarkup(
  <Figure
    meta={{
      number: 1,
      title: "Bookings and backlog by fiscal quarter",
      xAxis: "Fiscal quarter",
      yAxis: "$ millions",
      caption: "Source: HubSpot CRM deals, rolled up to canonical accounts.",
      summary: "Bookings rose while backlog expanded.",
    }}
  >
    <div>chart</div>
  </Figure>,
);
assert(figure.includes("Figure 1."), "Figure wrapper should stamp figure number");
assert(figure.includes("X-axis: Fiscal quarter"), "Figure wrapper should stamp x-axis label");
assert(figure.includes("aria-hidden=\"true\">·</i>"), "Figure wrapper should separate x-axis and y-axis labels");
assert(figure.includes("Y-axis: $ millions"), "Figure wrapper should stamp y-axis label");
assert(figure.includes("Summary:"), "Figure wrapper should stamp summary");
let missingFigureFailed = false;
try {
  assertFigureMeta({ number: 2, title: "Bad", xAxis: "Quarter", yAxis: "Score", caption: "Caption", summary: "Summary" });
} catch {
  missingFigureFailed = true;
}
assert(missingFigureFailed, "Figure wrapper should reject missing units");

for (const type of ["capabilities_assessment", "outreach", "weekly_memo"] as const) {
  const html = renderSteelSignalDocument(baseDeliverable(type, `Steel Signal ${type}`), world);
  assert(html.includes("BTX"), `${type} should include the BTX mark`);
  assert(html.includes(steelSignal.colors.navy), `${type} should include Steel & Signal navy`);
  assert(html.includes("SOURCE") || type === "weekly_memo", `${type} should render provenance or source block`);
  assert(!/[—–]/.test(html), `${type} should not contain em or en dash`);
}

const caps = renderSteelSignalDocument(baseDeliverable("capabilities_assessment", "Capabilities Assessment"), world);
assert(caps.includes("Capabilities Assessment"), "capabilities assessment snapshot missing title");
assert(caps.includes("Current production capacity"), "capabilities assessment snapshot missing capacity table");
assert(!/\bretention|earnings|churned\b/i.test(caps), "capabilities assessment leaked internal earnings or retention data");

const outreach = renderSteelSignalDocument(baseDeliverable("outreach", "Outreach Draft"), world);
assert(outreach.includes("Outreach draft"), "outreach snapshot missing header");
assert(outreach.includes("Why now") || outreach.includes("SOURCE"), "outreach snapshot missing evidence block");
assert(outreach.includes("Would you be open to a short call"), "outreach snapshot missing explicit short-call ask");
assert(outreach.includes("VP Sales, BTX Precision Machining"), "outreach snapshot missing signature title and company");

const newsletter = renderSteelSignalDocument(baseDeliverable("weekly_memo", "Monthly Newsletter"), world);
assert(newsletter.includes("Tell me"), "newsletter snapshot missing Tell me");
assert(newsletter.includes("Show me"), "newsletter snapshot missing Show me");
assert(newsletter.includes("So what"), "newsletter snapshot missing So what");
assert(!newsletter.includes("<h2>Lockheed awards F-35 lot-19 sustainment; spares volume rises into FY27.</h2>"), "newsletter headline should not duplicate full tell text");
assert(newsletter.includes("Treat as portfolio context") || newsletter.includes("Ask BD to watch") || newsletter.includes("planning tailwind"), "newsletter market-scope so-what should be distinct");

const unsourcedWorld: World = { ...world, analysis: { ...world.analysis, valid: [marketSignal] } };
const invalid = validateSteelSignalDeliverable(baseDeliverable("capabilities_assessment", "Unsourced"), unsourcedWorld);
assert(!invalid.valid && invalid.errors.join(" ").includes("lacks a high-confidence relationship"), "unsourced account claim should fail validation");

assert(signalScopeForEvidence(marketSignal) === "market", "market/unlinked signal should never render as account evidence");
const heatmap = renderToStaticMarkup(<RetentionEarningsHeatmap world={world} />);
assert(heatmap.includes("Internal use only"), "heat map should be marked internal only");
assert(heatmap.includes("Figure 1."), "heat map should follow figure convention");

const boardDeck = buildBoardDeck(baseDeliverable("board_deck", "Q3 Board Review"), world);
const pitchDeck = buildSalesPitch(baseDeliverable("sales_pitch", "Sales Pitch"), world);
const boardBuffer = await (boardDeck as unknown as { write(input: { outputType: "nodebuffer" }): Promise<Buffer> }).write({ outputType: "nodebuffer" });
const pitchBuffer = await (pitchDeck as unknown as { write(input: { outputType: "nodebuffer" }): Promise<Buffer> }).write({ outputType: "nodebuffer" });
assert(boardBuffer.subarray(0, 2).toString() === "PK", "board deck should be a valid pptx zip");
assert(pitchBuffer.subarray(0, 2).toString() === "PK", "sales pitch should be a valid pptx zip");
assert(boardBuffer.length > 10_000, "board deck pptx should not be empty");
assert(pitchBuffer.length > 10_000, "sales pitch pptx should not be empty");

assertNoEmDash([caps, outreach, newsletter, figure, provenance].join("\n"));

console.log("deliverable templates ok: Steel & Signal tokens, primitives, templates, invariants, pptx buffers");
