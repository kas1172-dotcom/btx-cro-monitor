import { actionLabel } from "./actionLabels.ts";
import { PROFILE } from "./config.ts";
import type { World } from "./useWorld.ts";
import { scoreFit } from "../engine/decision/fit.ts";
import type { Company } from "../engine/brain/entities.ts";
import type { OperatingSnapshot } from "../engine/brain/operatingSnapshot.ts";
import type { ScoreDimension } from "../engine/signals/contract.ts";
import { businessContextForCompany } from "./businessContext.ts";

export interface RankingExplanation {
  summary: string;
  scoreLine: string;
  fitLine: string;
  driverLine: string;
  signalLine: string;
  actionLine: string;
  contextLine: string;
  evidenceLine: string;
  businessContextLine: string;
  assumptionsLine: string;
  /** One stitched sentence weaving signals + fit + CRM/ERP/pipeline. Explanation
   *  enrichment only — the underlying scores are unchanged. */
  rationaleLine: string;
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function fitStrength(fit: number): string {
  return fit >= 70 ? "high" : fit >= 40 ? "moderate" : "low";
}

function money(n: number): string {
  return `$${(n / 1e6).toFixed(1)}M`;
}

function labelDimension(dimension: ScoreDimension): string {
  switch (dimension) {
    case "opportunity":
      return "Opportunity";
    case "risk":
      return "Risk";
    case "capacityRisk":
      return "Capacity risk";
    case "competitivePressure":
      return "Competitive pressure";
  }
}

export function rankingExplanation(
  world: World,
  company: Company,
  options: { rank?: number; dimension?: ScoreDimension; fitScore?: number; heading?: string; snapshot?: OperatingSnapshot | null } = {},
): RankingExplanation {
  const score = world.analysis.byId.get(company.id);
  const dimension = options.dimension ?? "opportunity";
  const primary = score?.dimensions[dimension];
  const fit = options.fitScore ?? scoreFit(company.needs, PROFILE.capabilities).score;
  const signals = world.analysis.valid
    .filter((s) => s.subject_id === company.id)
    .sort((a, b) => b.confidence - a.confidence);
  const drivers = primary?.contributions.slice(0, 2).map((c) => `${c.event_type} +${c.delta}`) ?? [];
  const rec = world.analysis.recById.get(company.id);
  const openOpps = world.opportunities.filter((o) => o.company_id === company.id && o.stage !== "won" && o.stage !== "lost");
  const wonOpps = world.opportunities.filter((o) => o.company_id === company.id && o.stage === "won");
  const openValue = openOpps.reduce((sum, o) => sum + o.value, 0);
  const facilities = world.facilities.filter((f) => f.company_id === company.id);
  const rankText = options.rank ? `Rank #${options.rank}` : options.heading ?? "Ranked item";
  const scoreValue = primary?.score ?? 0;
  // Falls back to the snapshot carried on World, so every call site gets the
  // real CRM/ERP/pipeline context without threading a new prop through the UI.
  const businessContext = businessContextForCompany(world, options.snapshot ?? world.snapshot, company);

  const factors: string[] = [];
  if (signals[0]) factors.push(`the public ${signals[0].event_type.replace(/_/g, " ")} signal is live`);
  if (fit) factors.push(`${PROFILE.name} fit is ${fitStrength(fit)} (${fit}%)`);
  factors.push(businessContext.crmClause);
  factors.push(businessContext.capacityClause);
  factors.push(businessContext.pipelineClause);
  const rationaleLine = rec
    ? `${actionLabel(rec.action)} because ${joinList(factors)}.`
    : `Ranked here because ${joinList(factors)}.`;

  return {
    summary: `${rankText}: ${labelDimension(dimension)} ${scoreValue}${fit ? `, fit ${fit}%` : ""}.`,
    scoreLine: `${labelDimension(dimension)} score ${scoreValue}${primary && primary.raw > primary.score ? `, capped from ${primary.raw}` : ""}.`,
    fitLine: fit ? `Fit score ${fit}% against ${PROFILE.name} capabilities.` : "Fit score is not available for this account.",
    driverLine: drivers.length ? `Top drivers: ${drivers.join("; ")}.` : "No score-driver trace moved this ranking dimension.",
    signalLine: signals[0] ? `Top signal: ${signals[0].event_type} - ${signals[0].source_quote}` : "No validated signal is attached to this account.",
    actionLine: rec ? `Recommended action: ${actionLabel(rec.action)} - ${rec.reason}` : "No recommended action is available.",
    contextLine: `${openOpps.length} open pipeline item${openOpps.length === 1 ? "" : "s"}${openValue ? ` worth ${money(openValue)}` : ""}; ${wonOpps.length} won contract${wonOpps.length === 1 ? "" : "s"}; ${facilities.length} facility record${facilities.length === 1 ? "" : "s"}.`,
    evidenceLine: `${score?.signal_count ?? signals.length} scored signal${(score?.signal_count ?? signals.length) === 1 ? "" : "s"}; ${signals.length} validated evidence item${signals.length === 1 ? "" : "s"}.`,
    businessContextLine: businessContext.recommendationLine,
    assumptionsLine: businessContext.assumptionsLine,
    rationaleLine,
  };
}
