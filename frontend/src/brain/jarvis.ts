// Chatpil brain — the CRO's chief-of-staff layer over the deterministic engine.
// LLM path: proxy call with a grounded context snapshot, personal-assistant behavior,
// action-dispatch offers, and full error isolation.
// Offline path: rule-based resolver. No debug text ever renders in the thread.

import type { World } from "../app/useWorld.ts";
import { pipelineHealth, healthLabel } from "../engine/decision/health.ts";
import { answer as deterministicAnswer } from "./copilot.ts";
import { PROFILE } from "../app/config.ts";
import { actionLabel } from "../app/actionLabels.ts";
import { GROUNDING_CONTRACT, CURRENT_VS_PROSPECTING } from "../app/promptContract.ts";
import { LLM_MODELS, LLM_TIMEOUT_MS } from "../app/llmConfig.ts";
import { setState } from "../store/store.ts";
import { backendHeaders } from "../app/backendApi.ts";

const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
const processEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
const ENDPOINT = env?.VITE_COPILOT_ENDPOINT ?? processEnv?.VITE_COPILOT_ENDPOINT;

// ── Live/offline state — driven by health-check results ──────────────────────

type LiveStatus = "unknown" | "live" | "offline";
let _liveStatus: LiveStatus = "unknown";
let _liveListeners = new Set<() => void>();
let _healthCheckPromise: Promise<boolean> | null = null;

function notifyLiveListeners() {
  _liveListeners.forEach((l) => l());
}

export function subscribeToLiveStatus(fn: () => void): () => void {
  _liveListeners.add(fn);
  return () => _liveListeners.delete(fn);
}

export function getLiveStatus(): LiveStatus {
  return _liveStatus;
}

async function healthCheck(): Promise<boolean> {
  if (!ENDPOINT) return false;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: await backendHeaders({ "content-type": "application/json" }),
      signal: ctrl.signal,
      body: JSON.stringify({
        model: LLM_MODELS.chatpil,
        system: "Reply with the single word: ok",
        messages: [{ role: "user", content: "ping" }],
      }),
    });
    clearTimeout(timer);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[Chatpil health-check] HTTP ${res.status}:`, body);
      return false;
    }
    const data = (await res.json()) as { text?: string; error?: string };
    if (data.error) {
      console.error("[Chatpil health-check] API error:", data.error);
      return false;
    }
    return typeof data.text === "string" && data.text.length > 0;
  } catch (e) {
    console.error("[Chatpil health-check] failed:", e);
    return false;
  }
}

export async function runHealthCheck(): Promise<boolean> {
  if (!ENDPOINT) {
    if (_liveStatus !== "offline") { _liveStatus = "offline"; notifyLiveListeners(); }
    return false;
  }
  if (_healthCheckPromise) return _healthCheckPromise;
  _healthCheckPromise = healthCheck().then((ok) => {
    _healthCheckPromise = null;
    const next: LiveStatus = ok ? "live" : "offline";
    if (_liveStatus !== next) { _liveStatus = next; notifyLiveListeners(); }
    return ok;
  });
  return _healthCheckPromise;
}

// ── Action-dispatch: map intent to store actions ──────────────────────────────

export interface ChatpilOffer {
  label: string;
  action: "open_dossier" | "open_area" | "run_agent";
  payload: string;
}

// Detect action intent in an LLM reply or user message.
// Returns null if no action is dispatched; returns the action label if fired.
export function dispatchChatpilAction(intent: string, world: World): string | null {
  const lower = intent.toLowerCase();

  // "show me the map" / "open the map"
  if (/(show|open|go to).*(map|geographic)/.test(lower)) {
    setState({ activeBrainArea: "geographic" });
    return "Opened the map view.";
  }
  // "show accounts" / "open current business"
  if (/(show|open).*(account|current business|customer)/.test(lower)) {
    setState({ activeBrainArea: "customer" });
    return "Opened the accounts view.";
  }
  // "open <company name>"
  const company = world.companies
    .sort((a, b) => b.name.length - a.name.length)
    .find((c) => lower.includes(c.name.toLowerCase()) || lower.includes(c.id));
  if (company && /(open|show|pull up|dossier)/.test(lower)) {
    setState({ activeCompanyId: company.id });
    return `Opened dossier for ${company.name}.`;
  }
  // "open top risk account"
  if (/(top risk|riskiest)/.test(lower)) {
    const top = [...world.analysis.scores].sort((a, b) => b.dimensions.risk.score - a.dimensions.risk.score)[0];
    if (top) {
      const name = world.companies.find((c) => c.id === top.subject_id)?.name ?? top.subject_id;
      setState({ activeCompanyId: top.subject_id });
      return `Opened dossier for ${name} (highest risk account).`;
    }
  }
  return null;
}

// Extract offers from the context snapshot to append as action buttons.
function offersForContext(world: World): ChatpilOffer[] {
  const offers: ChatpilOffer[] = [];
  const topRec = world.analysis.recommendations.find((r) => r.priority === "high");
  if (topRec) {
    const name = world.companies.find((c) => c.id === topRec.subject_id)?.name ?? topRec.subject_id;
    offers.push({ label: `Open ${name} dossier`, action: "open_dossier", payload: topRec.subject_id });
  }
  const topProspect = world.prospects[0];
  if (topProspect) {
    offers.push({ label: `Draft outreach — ${topProspect.company.name}`, action: "run_agent", payload: `outreach:${topProspect.company.id}` });
  }
  return offers.slice(0, 2);
}

// ── Context snapshot ──────────────────────────────────────────────────────────

const nameIn = (world: World) => (id: string) =>
  world.companies.find((c) => c.id === id)?.name ?? id;
const companyIn = (world: World) => (id: string) =>
  world.companies.find((c) => c.id === id);

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
  return `You are Chatpil, the revenue chief-of-staff for ${PROFILE.name} Precision's CRO. You are grounded exclusively in the ENGINE STATE context below.

${GROUNDING_CONTRACT}

${CURRENT_VS_PROSPECTING}

BEHAVIORAL RULES:
- Answer the question directly from context. At the end of your answer, include a compact "based on: …" line citing the specific facts used (keep it to one line, comma-separated).
- When natural, close with ONE useful offer as a question (e.g. "Want me to draft the outreach?" or "Should I pull the capabilities assessment?") — mark it clearly with "OFFER:" at the start of the line so the UI can render it as a button.
- Navigation: if the user says "open X" or "show me Y", respond with "ACTION:open_dossier:<company_id>" or "ACTION:open_area:<area>" on its own line, then confirm in one sentence what you did.
- Know your limits: if a question asks for data not in the context (European churn, pricing history, etc.), say exactly: "That data isn't in my context. What I do have: [list 1-2 relevant things that ARE available]." Never fabricate.
- Be concise and warm-professional. No preamble, no bullet-soup unless comparing 3+ items. Lead with the recommendation.

ENGINE STATE (your only source of truth):
${engineContext(world)}`;
}

// ── Debug-text guard ──────────────────────────────────────────────────────────

const DEBUG_MARKERS = ["model:", "error:", "status:", "{\"", "stack trace", "TypeError", "SyntaxError", "claude-"];

function looksLikeDebugText(text: string): boolean {
  const lower = text.toLowerCase();
  return DEBUG_MARKERS.some((m) => lower.includes(m.toLowerCase()));
}

// ── Public message type ───────────────────────────────────────────────────────

export interface Msg {
  role: "user" | "assistant";
  content: string;
  // Set when this turn triggered an action
  actionConfirmation?: string;
  // Offer button for the user to accept
  offer?: { label: string };
  // "offline" note shown at most once per session
  offlineNote?: string;
}

// ── Main ask function ─────────────────────────────────────────────────────────

export async function askJarvis(
  history: Msg[],
  world: World,
  options?: { currentArea?: string; selectedCompanyId?: string | null },
): Promise<Msg> {
  const last = history[history.length - 1]?.content ?? "";

  // Check for action intent first (works offline too)
  const actionResult = dispatchChatpilAction(last, world);
  if (actionResult) {
    return { role: "assistant", content: actionResult, actionConfirmation: actionResult };
  }

  if (!ENDPOINT) {
    return { role: "assistant", content: deterministicAnswer(last, world) };
  }

  // Ensure health is known
  const isLive = _liveStatus === "live" || (await runHealthCheck());
  if (!isLive) {
    return {
      role: "assistant",
      content: deterministicAnswer(last, world),
      offlineNote: "Assistant offline — using local answers (proxy unreachable)",
    };
  }

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), LLM_TIMEOUT_MS.chatpil);

    // Build the message list for the API: strip internal metadata fields
    const apiMessages = history.map((m) => ({ role: m.role, content: m.content }));

    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: await backendHeaders({ "content-type": "application/json" }),
      signal: ctrl.signal,
      body: JSON.stringify({
        model: LLM_MODELS.chatpil,
        system: systemPrompt(world),
        messages: apiMessages,
      }),
    });
    clearTimeout(timer);

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.error(`[Chatpil] proxy HTTP ${res.status}:`, errBody);
      // Mark offline
      if (_liveStatus !== "offline") { _liveStatus = "offline"; notifyLiveListeners(); }
      return {
        role: "assistant",
        content: deterministicAnswer(last, world),
        offlineNote: `Assistant offline — using local answers (proxy returned ${res.status})`,
      };
    }

    const data = (await res.json()) as { text?: string; error?: string };

    if (data.error || !data.text || looksLikeDebugText(data.text)) {
      console.error("[Chatpil] suspicious response:", data);
      if (_liveStatus !== "offline") { _liveStatus = "offline"; notifyLiveListeners(); }
      return {
        role: "assistant",
        content: deterministicAnswer(last, world),
        offlineNote: "Assistant offline — using local answers (invalid response received)",
      };
    }

    // Mark live on success
    if (_liveStatus !== "live") { _liveStatus = "live"; notifyLiveListeners(); }

    // Parse the structured response
    return parseAssistantReply(data.text, world);

  } catch (e) {
    const isTimeout = e instanceof Error && e.name === "AbortError";
    console.error("[Chatpil] call failed:", e);
    if (_liveStatus !== "offline") { _liveStatus = "offline"; notifyLiveListeners(); }
    return {
      role: "assistant",
      content: deterministicAnswer(last, world),
      offlineNote: isTimeout
        ? "Assistant offline — using local answers (response timed out)"
        : "Assistant offline — using local answers (network error)",
    };
  }
}

// Parse ACTION: and OFFER: markers out of the raw LLM text.
function parseAssistantReply(raw: string, world: World): Msg {
  const lines = raw.split("\n");
  const contentLines: string[] = [];
  let offer: Msg["offer"];
  let actionConfirmation: string | undefined;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("ACTION:")) {
      const parts = trimmed.slice(7).split(":");
      const actionType = parts[0];
      const payload = parts.slice(1).join(":");
      if (actionType === "open_dossier") {
        const company = world.companies.find((c) => c.id === payload);
        if (company) {
          setState({ activeCompanyId: company.id });
          actionConfirmation = `Opened dossier for ${company.name}.`;
        }
      } else if (actionType === "open_area") {
        const validAreas = ["revenue", "customer", "market", "geographic", "capability", "decision", "workflow"];
        if (validAreas.includes(payload)) {
          setState({ activeBrainArea: payload as Parameters<typeof setState>[0]["activeBrainArea"] });
          actionConfirmation = `Navigated to ${payload} view.`;
        }
      }
      // Don't add ACTION: lines to the visible content
    } else if (trimmed.startsWith("OFFER:")) {
      offer = { label: trimmed.slice(6).trim() };
      // Don't add OFFER: lines to visible content
    } else {
      contentLines.push(line);
    }
  }

  const content = contentLines.join("\n").trim();
  return { role: "assistant", content, offer, actionConfirmation };
}

/** Proactive opening brief — deterministic so it works without LLM. */
export function openingBrief(world: World): string {
  const nameOf = nameIn(world);
  const top = world.analysis.recommendations.filter((r) => r.priority === "high").slice(0, 3);
  if (top.length === 0)
    return `Nothing urgent across ${world.companies.length} accounts — pipeline looks steady. Ask me anything.`;
  const items = top.map((r) => `${actionLabel(r.action)}: ${nameOf(r.subject_id)}`).join("; ");
  return `${top.length} thing${top.length > 1 ? "s" : ""} need your attention: ${items}. Ask me for details or a call plan.`;
}
