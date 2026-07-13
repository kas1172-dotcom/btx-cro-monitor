import type { World } from "../app/useWorld.ts";
import { PROFILE } from "../app/config.ts";
import { actionLabel } from "../app/actionLabels.ts";
import { displayLabel } from "../app/displayLabels.ts";
import type { Prospect } from "../app/intelligence.ts";
import type { BrainResponse, OpportunityCard, SavedBrainNote, ScoreBreakdownItem } from "./types.ts";
import type { RetrievedContext } from "./retrieveContext.ts";

const money = (value: number) => `$${(value / 1e6).toFixed(1)}M`;

function confidence(score: number): "low" | "medium" | "high" {
  if (score >= 0.78) return "high";
  if (score >= 0.55) return "medium";
  return "low";
}

function cardFor(prospect: Prospect, world: World): OpportunityCard {
  const rec = world.analysis.recById.get(prospect.company.id);
  const score = prospect.score;
  const breakdown: ScoreBreakdownItem[] = [
    { label: "Capability fit", value: prospect.fit.score, note: prospect.fit.matched.length ? prospect.fit.matched.slice(0, 3).join(", ") : "No matched capability", positive: prospect.fit.score >= 50 },
    { label: "Market signal", value: Math.round((prospect.topSignal?.confidence ?? 0) * 100), note: prospect.topSignal ? displayLabel(prospect.topSignal.event_type) : "No top signal", positive: Boolean(prospect.topSignal) },
    { label: "Revenue potential", value: score.dimensions.opportunity.score, note: "Opportunity score from deterministic engine", positive: score.dimensions.opportunity.score >= 40 },
    { label: "Production feasibility", value: Math.max(0, 100 - score.dimensions.capacityRisk.score), note: `Capacity risk ${score.dimensions.capacityRisk.score}`, positive: score.dimensions.capacityRisk.score < 50 },
  ];
  return {
    companyId: prospect.company.id,
    companyName: prospect.company.name,
    city: prospect.company.location.city,
    relationship: prospect.company.relationship,
    accountStatus: displayLabel(prospect.company.account_status),
    opportunityScore: prospect.opportunity,
    fitScore: prospect.fit.score,
    whySurfaced: rec?.reason ?? prospect.topSignal?.source_quote ?? "Ranked by opportunity and fit.",
    matchedCapabilities: prospect.fit.matched,
    capabilityGaps: prospect.fit.missing,
    topSignal: prospect.topSignal?.source_quote,
    confidence: confidence(prospect.topSignal?.confidence ?? 0.55),
    recommendedAction: rec ? actionLabel(rec.action) : "Monitor",
    contactName: prospect.contact?.name,
    contactTitle: prospect.contact?.title,
    scoreBreakdown: breakdown,
  };
}

export function generateBrainResponse(ctx: RetrievedContext, world: World): BrainResponse {
  let directAnswer = "";
  let whyThisMatters = "";
  let recommendedActions: string[] = [];
  let suggestedNextQuestions: string[] = [];
  let relatedOpportunities: OpportunityCard[] = [];
  let focusView: BrainResponse["focusView"] = "accounts";
  let noteArea: SavedBrainNote["brainArea"] = ctx.activatedTabs[0] ?? "analysis";
  let noteTitle = "Revenue Brain note";

  if (ctx.intent === "market_signals") {
    const names = ctx.topSignals.slice(0, 3).map((s) => `${world.companies.find((c) => c.id === s.subject_id)?.name ?? s.subject_id}: ${s.value ? money(s.value) : displayLabel(s.event_type)}`).join(", ");
    directAnswer = `${ctx.topSignals.length} validated market signals are active. The strongest: ${names || "none"}.`;
    whyThisMatters = `These signals affect where ${PROFILE.name} should focus capacity, outreach, and account attention.`;
    recommendedActions = ["Review signal-connected accounts", "Brief sales on the strongest market moves", "Draft outreach for the top signal account"];
    suggestedNextQuestions = ["Which accounts connect to these signals?", "Who should BTX call first?", "Draft outreach for the top signal account."];
    relatedOpportunities = ctx.topProspects.slice(0, 4).map((p) => cardFor(p, world));
    focusView = "signals";
    noteArea = "programs";
    noteTitle = "Market signal review";
  } else if (ctx.intent === "geographic_prospecting") {
    const city = ctx.city ?? "selected market";
    directAnswer = `${ctx.topProspects.length} scored prospect${ctx.topProspects.length === 1 ? "" : "s"} in ${city}. Top targets: ${ctx.topProspects.slice(0, 3).map((p) => p.company.name).join(", ") || "none"}.`;
    whyThisMatters = "A market visit is highest-value when it clusters fit, buying signals, contacts, and geography.";
    recommendedActions = ctx.topProspects.slice(0, 3).map((p) => `Call ${p.contact?.name ?? p.company.name} at ${p.company.name}`);
    suggestedNextQuestions = [`Draft outreach for the top ${city} target.`, `Show all ${city} targets on the map.`, "Create a meeting brief for the first stop."];
    relatedOpportunities = ctx.topProspects.map((p) => cardFor(p, world));
    focusView = "map";
    noteArea = "map";
    noteTitle = `${city} prospecting plan`;
  } else if (ctx.intent === "account_risk") {
    directAnswer = `${ctx.atRiskAccounts.length} accounts show elevated risk. Priority: ${ctx.atRiskAccounts.slice(0, 3).map((c) => c.name).join(", ") || "none"}.`;
    whyThisMatters = "Account risk can become delivery risk, revenue slippage, or competitive loss if the team waits too long.";
    recommendedActions = ["Review top at-risk account", "Create a CRM follow-up task", "Prepare a defensive account brief"];
    suggestedNextQuestions = ["What is driving the top risk?", "Draft a check-in for the top risk account.", "Which deals are exposed?"];
    relatedOpportunities = ctx.atRiskAccounts
      .map((account) => world.prospects.find((p) => p.company.id === account.id))
      .filter((p): p is Prospect => Boolean(p))
      .map((p) => cardFor(p, world));
    focusView = "accounts";
    noteArea = "analysis";
    noteTitle = "Account risk review";
  } else if (ctx.intent === "capabilities") {
    const hours = world.snapshot?.capacity.reduce((sum, row) => sum + row.available_5_axis_hours_next_30d, 0) ?? 0;
    directAnswer = `${PROFILE.name} should lead with ${PROFILE.capabilities.slice(0, 4).join(", ")}. Current demo capacity shows ${hours} available 5-axis hours next 30 days.`;
    whyThisMatters = "Sales focus should match what production can actually support, so BTX avoids overpromising while pursuing high-fit work.";
    recommendedActions = ["Lead with high-fit accounts", "Avoid capability-gap accounts unless teaming", "Use available 5-axis capacity in outreach"];
    suggestedNextQuestions = ["Which accounts best match BTX capabilities?", "What should BTX not sell right now?", "Draft capability-led outreach."];
    relatedOpportunities = ctx.topProspects.filter((p) => p.fit.score >= 60).slice(0, 5).map((p) => cardFor(p, world));
    focusView = "capabilities";
    noteArea = "capacity";
    noteTitle = "Production-fit sales focus";
  } else if (ctx.intent === "weekly_brief") {
    const top = ctx.topProspects[0];
    const risk = ctx.atRiskAccounts[0];
    directAnswer = `Weekly CRO brief: top opportunity ${top?.company.name ?? "not available"}, top risk ${risk?.name ?? "not available"}, ${ctx.topSignals.length} active signals, ${money(ctx.pipelineValue)} open pipeline.`;
    whyThisMatters = "This combines market movement, account risk, capacity context, and pipeline into one leadership view.";
    recommendedActions = ["Call the top opportunity", "Review the top risk account", "Brief sales on the strongest market signal"];
    suggestedNextQuestions = ["Generate a board-ready summary.", "Create a meeting brief for the top risk.", "Show the top opportunity on the map."];
    relatedOpportunities = ctx.topProspects.slice(0, 4).map((p) => cardFor(p, world));
    focusView = "brief";
    noteArea = "brief";
    noteTitle = "Weekly CRO brief";
  } else {
    directAnswer = `${PROFILE.name} has ${ctx.topProspects.length} priority opportunities, ${ctx.topSignals.length} active signals, and ${money(ctx.pipelineValue)} open pipeline across ${ctx.openDealCount} deals.`;
    whyThisMatters = "The engine ranks where revenue attention should go next using fit, signals, risk, and production context.";
    recommendedActions = ["Review top opportunities", "Ask for a city plan", "Ask for account risk"];
    suggestedNextQuestions = ["Who should I target in Austin?", "Which accounts are at risk?", "What market signals matter this week?"];
    relatedOpportunities = ctx.topProspects.slice(0, 5).map((p) => cardFor(p, world));
    focusView = "accounts";
    noteArea = "analysis";
    noteTitle = "Revenue focus";
  }

  return {
    question: ctx.question,
    directAnswer,
    whyThisMatters,
    activatedTabs: ctx.activatedTabs,
    contextUsed: ctx.contextUsed,
    recommendedActions: recommendedActions.slice(0, 4),
    savedNote: {
      title: noteTitle,
      brainArea: noteArea,
      summary: directAnswer.slice(0, 220),
      entities: relatedOpportunities.slice(0, 3).map((o) => o.companyName),
    },
    suggestedNextQuestions: suggestedNextQuestions.slice(0, 4),
    relatedOpportunities,
    confidence: ctx.topSignals.length > 2 || relatedOpportunities.length > 2 ? "high" : "medium",
    focusView,
  };
}
