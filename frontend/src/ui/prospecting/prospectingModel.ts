import { rankingExplanation, type RankingExplanation } from "../../app/rankingExplain.ts";
import { PROFILE } from "../../app/config.ts";
import { signalHeadline, signalSourceDate, signalSourceName } from "../../app/signalProvenance.ts";
import type { World } from "../../app/useWorld.ts";
import { scoreFit } from "../../engine/decision/fit.ts";
import type { Company, Contact, Opportunity } from "../../engine/brain/entities.ts";
import type { Signal, SignalRelationship } from "../../engine/signals/contract.ts";
import {
  canonicalAccountsFromCompanies,
  extractSignalEntities,
  resolveSignalRelationships,
} from "../../identity/canonicalAccounts.ts";

export interface ProspectRankRow {
  rank: number;
  company: Company;
  statusLine: string;
  confidence: number;
  opportunity: number;
  fit: number;
  contact?: Contact;
  openDeals: Opportunity[];
  topSignal?: Signal;
  relationship?: SignalRelationship;
  whyRanked: RankingExplanation;
  whatChanged: string;
  recommendedAction: string;
}

export function prospectCompaniesForWorld(world: World): Company[] {
  return world.companies.filter((company) => company.business_motion === "prospect_new_business");
}

function signalText(signal: Signal): string {
  return [
    signal.artifact?.headline,
    signal.source_quote,
    signal.entities.join(" "),
  ].filter(Boolean).join(" ");
}

function relationshipForSignal(company: Company, signal: Signal): SignalRelationship | undefined {
  const account = canonicalAccountsFromCompanies([company]);
  const entities = extractSignalEntities(signalText(signal), signal.entities);
  const resolved = resolveSignalRelationships(entities, account);
  return resolved.relationships[0] ?? signal.relationships?.find((relationship) =>
    relationship.canonical_account_id === (company.canonical_account_id ?? company.id)
  );
}

function confidenceFor(company: Company, signal: Signal | undefined, opportunity: number, relationship: SignalRelationship | undefined): number {
  if (relationship) return relationship.confidence;
  if (signal) return signal.confidence;
  if (company.known_programs?.length) return 0.7;
  return Math.max(0.4, Math.min(0.69, opportunity / 100));
}

function statusLine(company: Company, opportunity: number, fit: number, openDeals: Opportunity[]): string {
  const pipeline = openDeals.length ? `${openDeals.length} open deal${openDeals.length === 1 ? "" : "s"}` : "no open deals";
  return `${company.location.city} · opportunity ${opportunity} · fit ${fit}% · ${pipeline}`;
}

export function prospectRowsForWorld(world: World): ProspectRankRow[] {
  return prospectCompaniesForWorld(world)
    .map((company) => {
      const prospect = world.prospects.find((candidate) => candidate.company.id === company.id);
      const score = world.analysis.byId.get(company.id);
      const opportunity = prospect?.opportunity ?? score?.dimensions.opportunity.score ?? 0;
      const fit = prospect?.fit.score ?? scoreFit(company.needs, PROFILE.capabilities).score;
      const contact = prospect?.contact ?? world.contacts.find((candidate) => candidate.company_id === company.id);
      const openDeals = world.opportunities
        .filter((opportunityRow) => opportunityRow.company_id === company.id && opportunityRow.stage !== "won" && opportunityRow.stage !== "lost")
        .sort((a, b) => b.value - a.value);
      const topSignal = world.analysis.valid
        .filter((signal) => signal.subject_id === company.id || signal.business_motion === "prospect_new_business")
        .sort((a, b) => b.confidence - a.confidence || b.detected_at.localeCompare(a.detected_at))[0];
      const relationship = topSignal ? relationshipForSignal(company, topSignal) : undefined;
      const fitScore = prospect?.fit.score ?? scoreFit(company.needs, PROFILE.capabilities).score;
      return {
        rank: 0,
        company,
        statusLine: statusLine(company, opportunity, fitScore, openDeals),
        confidence: confidenceFor(company, topSignal, opportunity, relationship),
        opportunity,
        fit: fitScore,
        contact,
        openDeals,
        topSignal,
        relationship,
        whyRanked: rankingExplanation(world, company, { dimension: "opportunity", fitScore }),
        whatChanged: topSignal ? `${signalHeadline(topSignal)} · ${signalSourceName(topSignal)} ${signalSourceDate(topSignal)}` : "No validated prospect signal in the current run.",
        recommendedAction: world.analysis.recById.get(company.id)?.reason ?? "Qualify the buying team and confirm whether this account has active demand.",
      };
    })
    .sort((a, b) =>
      b.opportunity + b.fit + b.confidence * 20 - (a.opportunity + a.fit + a.confidence * 20) ||
      a.company.name.localeCompare(b.company.name)
    )
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

export function industryUpdatesForProspects(world: World): Signal[] {
  const prospectIds = new Set(prospectCompaniesForWorld(world).map((company) => company.id));
  return world.analysis.valid
    .filter((signal) => {
      const programLike =
        signal.scope === "program" ||
        signal.event_type.includes("contract") ||
        signal.event_type.includes("award") ||
        signal.entities.some((entity) => /\b(f-35|b-21|hypersonic|missile|space|program)\b/i.test(entity));
      if (!programLike) return false;
      return (
        prospectIds.has(signal.subject_id) ||
        signal.business_motion === "prospect_new_business" ||
        signal.scope === "market" ||
        signal.scope === "program" ||
        signal.scope === "unlinked"
      );
    })
    .sort((a, b) => b.detected_at.localeCompare(a.detected_at));
}
