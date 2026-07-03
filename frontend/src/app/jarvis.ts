// Jarvis — the conversational brain. It reasons over the DETERMINISTIC engine
// state (scores, recommendations, prospects, alerts) and never invents numbers.
// A real LLM answers when a key-holding proxy is configured (VITE_COPILOT_ENDPOINT);
// otherwise it degrades gracefully to the rule-based resolver so the app still
// works. The engine stays the source of truth — Jarvis is the voice, not the math.

import type { World } from "./useWorld.ts";
import { pipelineHealth, healthLabel } from "../engine/decision/health.ts";
import { answer as deterministicAnswer } from "./copilot.ts";
import { PROFILE } from "./config.ts";
import { actionLabel } from "./actionLabels.ts";
import { GROUNDING_CONTRACT, CURRENT_VS_PROSPECTING } from "./promptContract.ts";

const ENDPOINT = import.meta.env.VITE_COPILOT_ENDPOINT;
export const jarvisLive = Boolean(ENDPOINT);

export interface Msg {
  role: "user" | "assistant";
  content: string;
}

const nameIn = (world: World) => (id: string) =>
  world.companies.find((c) => c.id === id)?.name ?? id;
const companyIn = (world: World) => (id: string) =>
  world.companies.find((c) => c.id === id);

/** Compact factual snapshot — the ground truth Jarvis is allowed to use. */
export function engineContext(world: World): string {
  const nameOf = nameIn(world);
  const companyOf = companyIn(world);
  const lines: string[] = [];
  const persp = world.analysis.persp;
  if (persp) {
    const d = persp.dimensions;
    const ph = pipelineHealth(world.opportunities.filter((o) => o.company_id === persp.subject_id));
    lines.push(
      `${PROFILE.name} (self) — risk ${d.risk}, opportunity ${d.opportunity}, capacityRisk ${d.capacityRisk}, competitivePressure ${d.competitivePressure}, pipelineHealth ${ph} (${healthLabel(ph)}).`,
    );
  }
  lines.push("LEADERBOARD (top accounts; all four objective scores so you can explain any ranking):");
  for (const s of [...world.analysis.scores].sort((a, b) => Math.max(b.dimensions.risk.score, b.dimensions.opportunity.score) - Math.max(a.dimensions.risk.score, a.dimensions.opportunity.score)).slice(0, 12)) {
    const d = s.dimensions;
    const company = companyOf(s.subject_id);
    const topRisk = d.risk.contributions[0]?.event_type;
    const topOpp = d.opportunity.contributions[0]?.event_type;
    lines.push(`- ${nameOf(s.subject_id)}${company?.account_status ? ` [account_status ${company.account_status}]` : ""}${company?.business_motion ? ` [business_motion ${company.business_motion}]` : ""}: risk ${d.risk.score}${topRisk ? ` (top: ${topRisk})` : ""}, opportunity ${d.opportunity.score}${topOpp ? ` (top: ${topOpp})` : ""}, capacityRisk ${d.capacityRisk.score}, competitivePressure ${d.competitivePressure.score}`);
  }
  lines.push("RECOMMENDED ACTIONS (priority order):");
  for (const r of world.analysis.recommendations.filter((r) => r.priority !== "low").slice(0, 8))
    lines.push(`- ${actionLabel(r.action)} ${nameOf(r.subject_id)} (${r.priority}): ${r.reason}`);
  lines.push("TOP PROSPECTS:");
  for (const p of world.prospects.slice(0, 8))
    lines.push(
      `- ${p.company.name} [${p.company.location.city}]${p.company.account_status ? ` account_status ${p.company.account_status}` : ""}${p.company.business_motion ? ` business_motion ${p.company.business_motion}` : ""}, opportunity ${p.opportunity}, fit ${p.fit.score}%` +
        (p.contact ? `, contact ${p.contact.name} (${p.contact.title})` : "") +
        (p.fit.matched.length ? `, serve ${p.fit.matched.join("/")}` : ""),
    );
  lines.push("ACTIVE ALERTS:");
  for (const a of world.analysis.alerts.slice(0, 6))
    lines.push(`- ${nameOf(a.subject_id)}: ${a.dimension} ${a.score} (${a.severity}) — ${a.reason}`);

  const open = world.opportunities.filter((o) => o.stage !== "won" && o.stage !== "lost");
  const pipeline = open.reduce((s, o) => s + o.value, 0);
  lines.push(`OPEN PIPELINE: $${(pipeline / 1e6).toFixed(1)}M across ${open.length} deals in ${world.companies.length} accounts.`);

  // Connected business context (simulated CRM / ERP-capacity / pipeline snapshot).
  const snap = world.snapshot;
  if (snap) {
    lines.push("BUSINESS CONTEXT (simulated CRM / ERP / pipeline — demo snapshot, not scored):");
    lines.push(`- Pipeline: ${snap.pipeline.summary.top_action} ($${(snap.pipeline.summary.open_pipeline_value / 1e6).toFixed(1)}M open, $${(snap.pipeline.summary.weighted_pipeline_value / 1e6).toFixed(1)}M weighted).`);
    for (const c of snap.crm.slice(0, 6))
      lines.push(`- CRM ${nameOf(c.account_id)}: ${c.account_tier}, ${c.relationship_health}, owner ${c.owner}, next step: ${c.next_step}.`);
    for (const cap of snap.capacity.slice(0, 4))
      lines.push(`- Capacity ${cap.facility_name}: ${cap.available_5_axis_hours_next_30d} open 5-axis hrs, lead time ${cap.quoted_lead_time_days}d, ${cap.constraint}.`);
  }

  return lines.join("\n");
}

function systemPrompt(world: World): string {
  return `You are Chatpil, the ${PROFILE.name} Enterprise Brain — the CRO explanation layer over a deterministic scoring engine. You explain scores, rankings, validated signals, and recommendations, and draft outreach. You do not compute, change, or invent the numbers — the engine does that.

${GROUNDING_CONTRACT}

${CURRENT_VS_PROSPECTING}

ENGINE STATE (deterministic facts + connected context — your authoritative source of truth)
${engineContext(world)}`;
}

export async function askJarvis(history: Msg[], world: World): Promise<string> {
  const last = history[history.length - 1]?.content ?? "";
  if (!ENDPOINT) return deterministicAnswer(last, world); // offline fallback

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ system: systemPrompt(world), messages: history }),
    });
    if (!res.ok) return `Jarvis error (${res.status}). ${await res.text()}`;
    const data = (await res.json()) as { text?: string; error?: string };
    return data.text ?? data.error ?? "(no response)";
  } catch (e) {
    return `Couldn't reach Jarvis — falling back to rules.\n\n${deterministicAnswer(last, world)}`;
  }
}

/** Proactive open-brief. Deterministic so it works with or without the LLM. */
export function openingBrief(world: World): string {
  const nameOf = nameIn(world);
  const top = world.analysis.recommendations.filter((r) => r.priority === "high").slice(0, 3);
  if (top.length === 0)
    return `Nothing urgent across ${world.companies.length} accounts — pipeline looks steady. Ask me anything.`;
  const items = top.map((r) => `${actionLabel(r.action)}: ${nameOf(r.subject_id)}`).join("; ");
  return `${top.length} thing${top.length > 1 ? "s" : ""} need your attention: ${items}. Ask me for details or a call plan.`;
}
