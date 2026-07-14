import type { World } from "../app/useWorld.ts";
import type { TabId } from "../app/surfaces.ts";
import type { ContextSource, QuestionIntent } from "./types.ts";
import type { Company } from "../engine/brain/entities.ts";
import type { Prospect } from "../app/intelligence.ts";

export interface RetrievedContext {
  question: string;
  intent: QuestionIntent;
  activatedTabs: TabId[];
  city: string | null;
  topProspects: Prospect[];
  atRiskAccounts: Company[];
  topSignals: World["analysis"]["valid"];
  contextUsed: ContextSource[];
  pipelineValue: number;
  openDealCount: number;
}

export function retrieveContext(question: string, intent: QuestionIntent, activatedTabs: TabId[], world: World): RetrievedContext {
  const q = question.toLowerCase();
  const city = [...new Set(world.companies.map((c) => c.location.city))].find((c) => q.includes(c.toLowerCase())) ?? world.city;
  const prospectPool = city ? world.prospects.filter((p) => p.company.location.city === city) : world.prospects;
  const topProspects = prospectPool.slice(0, 6);
  const atRiskAccounts = [...world.analysis.scores]
    .filter((s) => s.dimensions.risk.score >= 50 || s.dimensions.competitivePressure.score >= 50)
    .sort((a, b) => Math.max(b.dimensions.risk.score, b.dimensions.competitivePressure.score) - Math.max(a.dimensions.risk.score, a.dimensions.competitivePressure.score))
    .slice(0, 6)
    .map((s) => world.companies.find((c) => c.id === s.subject_id))
    .filter((c): c is Company => Boolean(c));
  const topSignals = [...world.analysis.valid]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 8);
  const openDeals = world.opportunities.filter((o) => o.stage !== "won" && o.stage !== "lost");
  const contextUsed: ContextSource[] = [];
  const signalSource = world.snapshot?.publicSignals.source_mode === "artifact" ? "monitor-engine artifacts" : "signals.json + news.json";
  const signalReason = world.snapshot?.publicSignals.source_mode === "artifact"
    ? `Real monitor-engine signals from ${world.snapshot.publicSignals.artifact_path}, run ${world.snapshot.publicSignals.run_at}.`
    : "Validated market signals and source quotes.";
  if (activatedTabs.includes("programs") || activatedTabs.includes("brief")) contextUsed.push({ source: signalSource, reason: signalReason });
  if (activatedTabs.includes("accounts")) contextUsed.push({ source: "companies.json + contacts.json", reason: "Account roster, relationships, and contacts." });
  if (activatedTabs.includes("analysis")) contextUsed.push({ source: "opportunities.json + scoring trace", reason: "Pipeline, opportunity scores, risk scores, and recommendations." });
  if (activatedTabs.includes("capacity")) contextUsed.push({ source: "client-profile.json + erp_capacity.json", reason: "BTX capabilities and demo capacity snapshot." });
  if (activatedTabs.includes("map")) contextUsed.push({ source: "companies.json + facilities.json", reason: "Addresses and map coordinates." });
  if (activatedTabs.includes("settings")) contextUsed.push({ source: "recommendation engine", reason: "Prioritized deterministic actions." });
  if (activatedTabs.includes("work_queue")) contextUsed.push({ source: "workflow simulator", reason: "Demo-only task and outreach actions." });

  return {
    question,
    intent,
    activatedTabs,
    city,
    topProspects,
    atRiskAccounts,
    topSignals,
    contextUsed,
    pipelineValue: openDeals.reduce((sum, deal) => sum + deal.value, 0),
    openDealCount: openDeals.length,
  };
}
