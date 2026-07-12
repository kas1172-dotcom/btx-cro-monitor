import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { steelSignal, steelSignalCss, stripEmDashes, assertNoEmDash } from "./designTokens.ts";
import type { Deliverable } from "./types.ts";
import type { World } from "../app/useWorld.ts";
import type { Company } from "../engine/brain/entities.ts";
import type { Signal, SignalRelationship, SignalScope } from "../engine/signals/contract.ts";
import {
  BrandMark,
  CapacityTable,
  Figure,
  PROVENANCE_CONFIDENCE_FLOOR,
  ProvenanceCard,
  ScopePill,
  StatCallout,
  TellShowSoWhatBlock,
  type CapacityRow,
} from "./steelSignalPrimitives.tsx";

export interface SteelSignalValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateSteelSignalDeliverable(deliverable: Deliverable, world: World): SteelSignalValidationResult {
  const text = deliverableText(deliverable);
  const errors: string[] = [];
  if (/[—–]/.test(text)) errors.push("Generated deliverable text contains an em or en dash.");
  if (deliverable.type === "capabilities_assessment" && /\b(retention|earnings|churned|book-to-bill)\b/i.test(text)) {
    errors.push("Client-facing capabilities assessment cannot include other-client earnings or retention data.");
  }
  for (const entityId of deliverable.entityIds) {
    const company = companyForId(world, entityId);
    if (!company) continue;
    const relationship = relationshipForCompany(world, company);
    if (!relationship) {
      errors.push(`Account-linked deliverable claim for ${company.name} lacks a high-confidence relationship record.`);
    }
  }
  return { valid: errors.length === 0, errors };
}

export function assertSteelSignalExportable(deliverable: Deliverable, world: World): void {
  const result = validateSteelSignalDeliverable(deliverable, world);
  if (!result.valid) throw new Error(result.errors.join(" "));
}

export function renderSteelSignalDocument(deliverable: Deliverable, world: World): string {
  assertSteelSignalExportable(deliverable, world);
  const body = renderToStaticMarkup(<SteelSignalDocument deliverable={deliverable} world={world} />);
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(deliverable.title)}</title><style>${steelSignalCss()}${documentCss()}</style></head><body>${body}</body></html>`;
  assertNoEmDash(html);
  return html;
}

export function SteelSignalDocument({ deliverable, world }: { deliverable: Deliverable; world: World }) {
  if (deliverable.type === "capabilities_assessment") return <CapabilitiesAssessmentTemplate deliverable={deliverable} world={world} />;
  if (deliverable.type === "outreach") return <OutreachDraftTemplate deliverable={deliverable} world={world} />;
  if (deliverable.type === "weekly_memo") return <MonthlyNewsletterTemplate deliverable={deliverable} world={world} />;
  return <GenericSteelSignalTemplate deliverable={deliverable} world={world} />;
}

export function CapabilitiesAssessmentTemplate({ deliverable, world }: { deliverable: Deliverable; world: World }) {
  const company = companyForId(world, deliverable.entityIds[0]) ?? world.companies[0];
  const relationship = relationshipForCompany(world, company);
  const rows = capacityRows(world);
  return (
    <main className="ss-page ss-capabilities">
      <header className="ss-doc-header">
        <div><BrandMark /><div><p>BTX Precision Machining</p><span>Aerospace & Defense · AS9100D · ITAR</span></div></div>
        <aside><strong>Confidential</strong><span>Prepared for: {company?.name ?? "Target account"}</span></aside>
        <h1>Capabilities Assessment</h1>
      </header>
      <section className="ss-fit-row">
        <div className="ss-card"><p className="ss-eyebrow">Opportunity</p><strong>{stripEmDashes(extractSectionText(deliverable, "likely-need") || `${company?.name ?? "Account"} program support`)}</strong><span>Matched to BTX 5-axis capacity and AS9100 line.</span></div>
        <div className="ss-fit-card"><p className="ss-eyebrow">Capability fit</p><strong>{fitPercent(deliverable)}</strong></div>
      </section>
      <section><h2>Core capabilities</h2><div className="ss-cap-grid">{coreCapabilities().map((item) => <div className="ss-cap-tile" key={item[0]}><i /><strong>{item[0]}</strong><span>{item[1]}</span></div>)}</div></section>
      <section><h2>Certifications & compliance</h2><div className="ss-cert-row">{["AS9100D", "ITAR Registered", "NIST SP 800-171", "CMMC Level 2", "DFARS 252.204", "Nadcap (NDT)"].map((item) => <span key={item}>{item}</span>)}</div></section>
      <section><h2>Current production capacity</h2><CapacityTable rows={rows} /></section>
      <section className="ss-two-col">
        <div className="ss-card"><h2>Materials & tolerances</h2>{["Titanium, Inconel & nickel alloys", "Aluminum, stainless & specialty steels", "Tolerances to +/-0.0002 in", "Part envelope to 40 in, 5-axis"].map((item) => <p key={item}>{item}</p>)}</div>
        <div className="ss-card"><h2>Track record</h2>{["20+ yrs supplying tier-1 aerospace primes", "99.2% on-time delivery", "<15 PPM quality escape rate", "100% ITAR-compliant data handling"].map((item) => <p key={item}>{item}</p>)}</div>
      </section>
      {relationship && <ProvenanceCard relationship={relationship} />}
      <footer>{steelSignal.footer.document}</footer>
    </main>
  );
}

export function OutreachDraftTemplate({ deliverable, world }: { deliverable: Deliverable; world: World }) {
  const company = companyForId(world, deliverable.entityIds[0]) ?? world.companies[0];
  const contact = company ? world.contacts.find((item) => item.company_id === company.id) : undefined;
  const relationship = company ? relationshipForCompany(world, company) : null;
  const subject = extractSectionText(deliverable, "subject") || `${company?.name ?? "Account"} production-capacity conversation`;
  const body = extractSectionText(deliverable, "body") || "Draft body unavailable.";
  return (
    <main className="ss-page ss-outreach">
      <header className="ss-doc-header compact"><div><BrandMark /><div><p>BTX Precision Machining</p><span>Outreach draft · prepared for review before sending</span></div></div><aside><strong>Draft</strong></aside></header>
      <section className="ss-email-meta">
        <p><b>To</b><span>{contact ? `${contact.name}, ${contact.title}, ${company?.name}` : company?.name ?? "Operations team"}</span></p>
        <p><b>From</b><span>VP Sales, BTX Precision Machining</span></p>
        <p><b>Subject</b><span>{stripEmDashes(subject)}</span></p>
      </section>
      <article className="ss-email-body">{body.split("\n").map((line, index) => <p key={index}>{stripEmDashes(line) || "\u00a0"}</p>)}</article>
      {relationship && <ProvenanceCard relationship={relationship} />}
      <p className="ss-note">Draft only. Review recipient, tone, and claims before sending; on approval this creates a HubSpot task and logs the send.</p>
      <footer>BTX Precision Machining  ·  Confidential draft  ·  Illustrative sample</footer>
    </main>
  );
}

export function MonthlyNewsletterTemplate({ deliverable, world }: { deliverable: Deliverable; world: World }) {
  const signals = accountOrMarketSignals(world).slice(0, 3);
  const stories = [0, 1, 2].map((index) => {
    const signal = signals[index];
    return {
      number: `0${index + 1}`,
      title: signal?.artifact?.headline ?? signal?.source_quote ?? newsletterFallbacks[index][0],
      tell: signal?.source_quote ?? newsletterFallbacks[index][1],
      show: index === 0 ? "$2.4B" : index === 1 ? "2 programs" : "+8%",
      showSub: index === 0 ? "award value, multi-year" : index === 1 ? "seeking re-shore capacity" : "YoY in relevant lines",
      soWhat: signal?.scope === "specific_account" ? "Account-linked evidence is ready for a work-item follow-up." : "Portfolio-level signal; keep it market scoped until a relationship record exists.",
    };
  });
  return (
    <main className="ss-page ss-newsletter">
      <header className="ss-doc-header compact"><div><BrandMark /><div><p>BTX Defense Signal</p><span>Monthly market brief for the revenue team</span></div></div><aside><strong>{new Date(deliverable.createdAt).toLocaleString("en-US", { month: "long", year: "numeric" })}</strong><span>Internal</span></aside><h1>Three moves in the defense-machining market, and what each means for BTX pipeline.</h1></header>
      {stories.map((story) => <TellShowSoWhatBlock key={story.number} {...story} />)}
      <aside className="ss-sources"><p className="ss-eyebrow">Sources</p><span>Monitor-engine market artifacts · HubSpot CRM · SAM.gov · DoD budget documents. Account links via canonical relationship records.</span></aside>
      <footer>BTX Defense Signal · Internal monthly brief · Illustrative sample data</footer>
    </main>
  );
}

export function RetentionEarningsHeatmap({ world }: { world: World }) {
  const companies = world.companies.slice(0, 8);
  const quarters = ["Q4 FY25", "Q1 FY26", "Q2 FY26", "Q3 FY26", "Q4 FY26e", "Q1 FY27e"];
  return (
    <Figure
      meta={{
        number: 1,
        title: "Account earnings and retention, Q4 FY25 to Q1 FY27 forecast",
        xAxis: "Fiscal quarter ($K)",
        yAxis: "Account (canonical)",
        caption: "Each cell is one account's revenue in one fiscal quarter; darker cells indicate higher revenue. Source: CRM deals rolled up to canonical accounts. Internal use only.",
        summary: "Revenue concentration and retention status identify accounts needing save or expansion work.",
      }}
    >
      <table className="ss-heatmap" data-internal-only="true">
        <thead><tr><th>Account</th>{quarters.map((q) => <th key={q}>{q}</th>)}<th>Status</th></tr></thead>
        <tbody>{companies.map((company, rowIndex) => <tr key={company.id}><th>{company.name}</th>{quarters.map((quarter, colIndex) => {
          const value = heatValue(world, company, rowIndex, colIndex);
          return <td key={quarter} style={{ background: heatColor(value) }}>${value}K</td>;
        })}<td><span className={`ss-status-dot ${retentionStatus(rowIndex).toLowerCase().replace(/\s+/g, "-")}`} />{retentionStatus(rowIndex)}</td></tr>)}</tbody>
      </table>
    </Figure>
  );
}

function GenericSteelSignalTemplate({ deliverable, world }: { deliverable: Deliverable; world: World }) {
  return (
    <main className="ss-page">
      <header className="ss-doc-header compact"><div><BrandMark /><div><p>BTX Revenue Brain</p><span>{deliverable.audience ?? "Internal"} deliverable</span></div></div><h1>{stripEmDashes(deliverable.title)}</h1></header>
      {deliverable.sections.map((section) => <section key={section.id} className="ss-card"><h2>{stripEmDashes(section.heading)}</h2>{section.blocks.map((block, index) => <p key={index}>{stripEmDashes(block.kind === "text" ? block.text : block.kind === "table" ? block.rows.map((row) => row.join(" · ")).join("\n") : block.title)}</p>)}</section>)}
      {deliverable.entityIds.map((id) => companyForId(world, id)).filter(Boolean).map((company) => {
        const relationship = relationshipForCompany(world, company as Company);
        return relationship ? <ProvenanceCard key={(company as Company).id} relationship={relationship} /> : null;
      })}
      <footer>{steelSignal.footer.document}</footer>
    </main>
  );
}

function deliverableText(deliverable: Deliverable): string {
  return [deliverable.title, ...deliverable.sections.flatMap((section) => [section.heading, ...section.blocks.map((block) => block.kind === "text" ? block.text : block.kind === "table" ? block.rows.flat().join(" ") : block.title)])].join(" ");
}

function extractSectionText(deliverable: Deliverable, sectionId: string): string {
  return deliverable.sections.find((section) => section.id === sectionId)?.blocks.map((block) => block.kind === "text" ? block.text : "").filter(Boolean).join("\n") ?? "";
}

function companyForId(world: World, id: string | undefined): Company | null {
  if (!id) return null;
  return world.companies.find((company) => company.id === id || company.canonical_account_id === id) ?? null;
}

export function relationshipForCompany(world: World, company: Company | null | undefined): SignalRelationship | null {
  if (!company) return null;
  const ids = new Set([company.id, company.canonical_account_id].filter(Boolean));
  const relationships = world.analysis.valid
    .filter((signal) => signal.scope === "specific_account")
    .flatMap((signal) => signal.relationships ?? [])
    .filter((relationship) => ids.has(relationship.canonical_account_id) && relationship.confidence >= PROVENANCE_CONFIDENCE_FLOOR)
    .sort((a, b) => b.confidence - a.confidence);
  return relationships[0] ?? null;
}

export function accountOrMarketSignals(world: World): Signal[] {
  return world.analysis.valid.filter((signal) => signal.scope === "specific_account" || signal.scope === "market" || signal.scope === "program" || signal.scope === "unlinked");
}

export function signalScopeForEvidence(signal: Signal): SignalScope {
  if (signal.scope === "specific_account" && signal.relationships?.some((relationship) => relationship.confidence >= PROVENANCE_CONFIDENCE_FLOOR)) return "specific_account";
  return signal.scope === "program" ? "program" : "market";
}

function capacityRows(world: World): CapacityRow[] {
  const rows = (world.snapshot?.capacity ?? []).slice(0, 3).map((item, index) => ({
    facility: item.facility_name ?? item.city,
    fiveAxisCenters: String(Math.max(3, Math.round(item.available_5_axis_hours_next_30d / 20))),
    shifts: index === 2 ? "1" : "2",
    utilization: `${Math.min(97, Math.max(60, 100 - Math.round(item.available_5_axis_hours_next_30d / 8)))}%`,
    available: item.capacity_status.toLowerCase().includes("available") ? "Now" : item.capacity_status,
  }));
  return rows.length ? rows : [
    { facility: "Fort Worth, TX", fiveAxisCenters: "8", shifts: "2", utilization: "93%", available: "Q1 FY27" },
    { facility: "Wichita, KS", fiveAxisCenters: "5", shifts: "2", utilization: "88%", available: "Limited" },
    { facility: "Tulsa, OK", fiveAxisCenters: "6", shifts: "1", utilization: "71%", available: "Now" },
  ];
}

function coreCapabilities(): Array<[string, string]> {
  return [
    ["5-axis CNC machining", "Complex geometries, single-setup"],
    ["Build-to-print", "From customer models and specs"],
    ["Precision turning", "Swiss + multi-axis, +/-0.0002 in"],
    ["Assembly & kitting", "Sub-assembly, integration, kitting"],
    ["CMM metrology", "Full first-article + in-process"],
    ["Special processes", "Coordinated NDT, finishing, coatings"],
  ];
}

function fitPercent(deliverable: Deliverable): string {
  const text = deliverableText(deliverable);
  return text.match(/\b(\d{2,3})%\b/)?.[0] ?? "91%";
}

const newsletterFallbacks: Array<[string, string]> = [
  ["F-35 sustainment demand rises", "Public award activity points to growing build-to-print spares demand through FY27."],
  ["Structures schedule pressure opens a capacity lane", "A tier-one supplier signal suggests domestic machining capacity may matter this month."],
  ["Budget lines lift precision-component demand", "Defense funding requests show a market-level tailwind for precision aerospace components."],
];

function heatValue(world: World, company: Company, rowIndex: number, colIndex: number): number {
  const base = world.opportunities.filter((opp) => opp.company_id === company.id).reduce((sum, opp) => sum + opp.value, 0) / 1000;
  return Math.round((base || 120 + rowIndex * 85) * (0.72 + colIndex * 0.09));
}

function heatColor(value: number): string {
  if (value > 900) return steelSignal.colors.navy;
  if (value > 550) return steelSignal.colors.teal;
  if (value > 250) return steelSignal.colors.provenanceBorder;
  return steelSignal.colors.bg;
}

function retentionStatus(index: number): string {
  return ["Growing", "Stable", "Stable", "Growing", "At risk", "Stable", "Soft", "Churned"][index] ?? "Stable";
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function documentCss(): string {
  const c = steelSignal.colors;
  return `
@page{size:letter;margin:0}
body{margin:0;background:${c.bg};font-family:${steelSignal.font.family};color:${c.ink};}
.ss-page{box-sizing:border-box;width:816px;min-height:1056px;margin:0 auto;background:${c.white};padding:0 54px 34px;position:relative;font-size:12.5px;line-height:1.35}
.ss-doc-header{margin:0 -54px 34px;padding:42px 54px 26px;background:${c.navy};color:${c.white};display:grid;grid-template-columns:1fr auto;gap:20px;align-items:start}
.ss-doc-header.compact{padding-bottom:34px}.ss-doc-header>div{display:flex;gap:16px;align-items:center}.ss-doc-header p{margin:0;color:${c.teal};font-weight:700;text-transform:uppercase;letter-spacing:2.5px}.ss-doc-header span{color:${c.ice}}.ss-doc-header aside{text-align:right;text-transform:uppercase;letter-spacing:2px;color:${c.ice};font-size:10px}.ss-doc-header aside span{display:block;margin-top:42px;text-transform:none;letter-spacing:0;font-size:12px}.ss-doc-header h1{grid-column:1/-1;margin:16px 0 0;font-size:34px;line-height:1.05;color:${c.white}}
.ss-brand-mark{display:inline-flex;align-items:center;justify-content:center;border-radius:999px;background:${c.teal};color:${c.navy};font-weight:700;flex:none}
.ss-card,.ss-stat,.ss-cap-tile,.ss-story-card{background:${c.white};border:1px solid ${c.line};border-radius:8px;box-shadow:0 8px 18px rgba(18,38,58,.08)}
.ss-fit-row{display:grid;grid-template-columns:1fr 242px;gap:16px;margin-bottom:26px}.ss-fit-row .ss-card{padding:20px 22px}.ss-fit-row strong{display:block;font-size:13.5px}.ss-fit-row span{color:${c.muted}}.ss-fit-card{background:${c.navy};border-radius:8px;padding:18px 20px;color:${c.white}}.ss-fit-card strong{font-size:40px;line-height:1}
.ss-eyebrow{text-transform:uppercase;letter-spacing:1.5px;color:${c.teal};font-size:10px;font-weight:700;margin:0 0 8px}
h2{font-size:17px;margin:20px 0 12px}.ss-cap-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.ss-cap-tile{padding:20px;min-height:74px}.ss-cap-tile i{display:inline-block;width:14px;height:14px;border-radius:50%;background:${c.teal};margin-right:10px}.ss-cap-tile strong{display:block;margin:0 0 8px}.ss-cap-tile span,.ss-card p,.ss-note{color:${c.muted}}
.ss-cert-row{display:flex;gap:10px;flex-wrap:wrap}.ss-cert-row span,.ss-pill{border-radius:999px;padding:7px 12px;background:${c.tint};border:1px solid ${c.provenanceBorder};color:${c.provenanceInk};font-weight:700;font-size:11px}
.ss-capacity-table{border-collapse:collapse;width:100%;font-size:11.5px;border:1px solid ${c.line};border-radius:8px;overflow:hidden}.ss-capacity-table th{background:${c.navy};color:${c.white};text-align:left;padding:10px}.ss-capacity-table td{padding:10px;border-top:1px solid ${c.line}}.ss-capacity-table tr:nth-child(odd) td{background:${c.panel}}
.ss-two-col{display:grid;grid-template-columns:1fr 1fr;gap:18px}.ss-two-col .ss-card{padding:16px 20px}.ss-provenance-card,.ss-sources{margin-top:22px;background:${c.tint};border:1px solid ${c.provenanceBorder};border-radius:8px;padding:14px 18px;color:${c.muted}}.ss-provenance-card strong{display:block;color:${c.provenanceInk};font-size:9px;letter-spacing:2px}.ss-provenance-card b{color:${c.ink}}
footer{position:absolute;right:54px;bottom:24px;color:${c.muted};font-size:9.5px}.ss-email-meta{border-bottom:1px solid ${c.line};padding-bottom:20px}.ss-email-meta p{display:grid;grid-template-columns:70px 1fr}.ss-email-meta b{color:${c.teal};text-transform:uppercase;letter-spacing:1.5px}.ss-email-body{margin:28px 0;font-size:12.5px}.ss-note{font-style:italic}
.ss-story-card{padding:22px;margin:16px 0}.ss-story-head{display:flex;gap:18px;align-items:center}.ss-story-head span{width:34px;height:34px;border-radius:50%;background:${c.teal};color:${c.white};display:inline-flex;align-items:center;justify-content:center;font-weight:700}.ss-story-head h2{margin:0}.ss-story-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.ss-show{background:${c.tint};border-radius:8px;padding:16px}.ss-show strong{font-size:30px}.ss-show span{display:block;color:${c.muted}}.ss-so-what{background:${c.panel};border-radius:8px;padding:16px}
.ss-figure{margin:24px 0}.ss-figure figcaption{font-size:15px;margin-bottom:12px}.ss-axis-row{display:flex;justify-content:space-between;color:${c.muted};font-size:10px;margin-top:8px}.ss-caption{color:${c.muted};font-size:10px}.ss-summary{font-size:10.5px}
`.trim();
}
