import React from "react";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { renderToStaticMarkup } from "react-dom/server";
import { buildBoardDeck, buildSalesPitch } from "../src/deliverables/deck/pptx.ts";
import { steelSignalCss } from "../src/deliverables/designTokens.ts";
import { RetentionEarningsHeatmap, renderSteelSignalDocument } from "../src/deliverables/steelSignalTemplates.tsx";
import type { Deliverable } from "../src/deliverables/types.ts";
import type { World } from "../src/app/useWorld.ts";
import type { Signal, SignalRelationship } from "../src/engine/signals/contract.ts";

const outDir = resolve(import.meta.dirname, "../../design/samples");

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
  companies: [
    {
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
    },
    {
      id: "hubspot-company-101",
      canonical_account_id: "hubspot-company-101",
      hubspot_company_id: "101",
      name: "Boeing",
      relationship: "target",
      account_status: "target_prospect",
      business_motion: "prospect_new_business",
      location: { city: "Seattle", state: "WA", lat: 47.61, lon: -122.33, country: "USA" },
      needs: ["precision machining"],
    },
    {
      id: "hubspot-company-102",
      canonical_account_id: "hubspot-company-102",
      hubspot_company_id: "102",
      name: "RTX",
      relationship: "target",
      account_status: "active_pipeline",
      business_motion: "prospect_new_business",
      location: { city: "Arlington", state: "VA", lat: 38.88, lon: -77.10, country: "USA" },
      needs: ["ITAR"],
    },
  ],
  contacts: [{ id: "hubspot-contact-200", company_id: "hubspot-company-100", name: "Jordan Rivera", title: "Supply Chain Director" }],
  facilities: [],
  opportunities: [
    { id: "opp-1", company_id: "hubspot-company-100", name: "F-35 spares", value: 2400000, stage: "qualified", close_date: "2026-09-30" },
    { id: "opp-2", company_id: "hubspot-company-101", name: "Structures package", value: 640000, stage: "proposal", close_date: "2026-10-15" },
    { id: "opp-3", company_id: "hubspot-company-102", name: "Precision components", value: 480000, stage: "qualified", close_date: "2026-11-01" },
  ],
  analysis: { valid: [accountSignal, marketSignal], rejected: [], scores: [], byId: new Map() },
  prospects: [],
  snapshot: {
    crm: [],
    capacity: [
      { source_type: "demo", source_name: "Sample ERP", source_mode: "static_snapshot", facility_id: "fw", facility_name: "Fort Worth, TX", city: "Fort Worth", available_5_axis_hours_next_30d: 58, available_turning_hours_next_30d: 44, quoted_lead_time_days: 16, capacity_status: "limited", constraint: "AS9100 line" },
      { source_type: "demo", source_name: "Sample ERP", source_mode: "static_snapshot", facility_id: "tulsa", facility_name: "Tulsa, OK", city: "Tulsa", available_5_axis_hours_next_30d: 210, available_turning_hours_next_30d: 150, quoted_lead_time_days: 9, capacity_status: "available now", constraint: "" },
    ],
    pipeline: {
      source_type: "demo",
      source_name: "Sample CRM",
      source_mode: "static_snapshot",
      as_of: "2026-07-12",
      summary: { open_pipeline_value: 3520000, weighted_pipeline_value: 1900000, priority_accounts: ["Lockheed Martin"], top_action: "Open lot-19 RFQ conversation" },
      records: [],
    },
    integrations: [],
    assumptions: { source_type: "demo", source_name: "Sample assumptions", source_mode: "static_snapshot", as_of: "2026-07-12", is_static_demo: true, summary: "Illustrative sample.", assumptions: [] },
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
  provenanceSources: [],
  provenanceSummary: null,
};

function deliverable(type: Deliverable["type"], title: string): Deliverable {
  return {
    id: `sample-${type}`,
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

await mkdir(outDir, { recursive: true });

await buildBoardDeck(deliverable("board_deck", "BTX Board Deck Sample"), world).writeFile({ fileName: resolve(outDir, "board-deck-sample.pptx") });
await buildSalesPitch(deliverable("sales_pitch", "BTX Sales Pitch Sample"), world).writeFile({ fileName: resolve(outDir, "sales-pitch-sample.pptx") });

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 816, height: 1056 }, deviceScaleFactor: 1 });
  for (const [type, filename, title, scale] of [
    ["capabilities_assessment", "capabilities-assessment-sample.pdf", "BTX Capabilities Assessment Sample", 0.88],
    ["outreach", "outreach-draft-sample.pdf", "BTX Outreach Draft Sample", 1],
    ["weekly_memo", "monthly-newsletter-sample.pdf", "BTX Monthly Newsletter Sample", 0.86],
  ] as const) {
    await page.setContent(fitToLetter(renderSteelSignalDocument(deliverable(type, title), world), scale), { waitUntil: "networkidle" });
    await page.pdf({ path: resolve(outDir, filename), width: "8.5in", height: "11in", printBackground: true });
  }

  const heatmapHtml = `<!doctype html><html><head><meta charset="utf-8"><style>${steelSignalCss()}body{margin:0;padding:24px;background:#fff;font-family:var(--ss-font)}.ss-heatmap{width:100%;border-collapse:collapse;table-layout:fixed;font-size:11px}.ss-heatmap th,.ss-heatmap td{border:2px solid #fff;padding:8px;text-align:center}.ss-heatmap th{background:var(--ss-panel);color:var(--ss-ink)}.ss-status-dot{display:inline-block;width:10px;height:10px;margin-right:6px;border-radius:50%;background:var(--ss-teal)}.ss-status-dot.at-risk,.ss-status-dot.soft{background:var(--ss-amber)}.ss-status-dot.churned{background:var(--ss-red)}</style></head><body>${renderToStaticMarkup(<RetentionEarningsHeatmap world={world} />)}</body></html>`;
  await page.setViewportSize({ width: 1300, height: 860 });
  await page.setContent(heatmapHtml, { waitUntil: "networkidle" });
  await page.screenshot({ path: resolve(outDir, "retention-earnings-heatmap-sample.png"), fullPage: true });
} finally {
  await browser.close();
}

console.log(`Generated deliverable samples in ${outDir}`);

function fitToLetter(html: string, scale: number): string {
  if (scale === 1) return html;
  return html.replace("</style>", `html,body{width:816px;height:1056px;overflow:hidden}.ss-page{transform:scale(${scale});transform-origin:top left}</style>`);
}
