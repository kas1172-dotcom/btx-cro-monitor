import { lazy, Suspense, useMemo, useState } from "react";
import type { World } from "../../app/useWorld.ts";
import { createDeliverableRecord } from "../../app/deliverablesApi.ts";
import { saveDeliverable } from "../../memory/localMemory.ts";
import { setState } from "../../store/store.ts";
import { PROFILE } from "../../app/config.ts";
import { rankingExplanation } from "../../app/rankingExplain.ts";
import { buildItineraryContext, itineraryAgent, type RankedTripCandidate } from "../../agents/itineraryAgent.ts";
import { runAgent } from "../../agents/runAgent.ts";
import type { Deliverable } from "../../deliverables/types.ts";
import { scoreFit } from "../../engine/decision/fit.ts";
import { TripInputForm, type TripFormValues } from "../trips/TripInputForm.tsx";
import { ProspectDetail } from "../prospecting/ProspectDetail.tsx";
import { prospectRowsForWorld, type ProspectRankRow } from "../prospecting/prospectingModel.ts";
import { DeliverableWizard } from "../deliverables/DeliverableWizard.tsx";
import { EmptyState, SurfaceHeader } from "../primitives.tsx";

const ProspectMap = lazy(() => import("../map/ProspectMap.tsx").then((module) => ({ default: module.ProspectMap })));

function confidenceTier(confidence: number): "High" | "Medium" | "Low" {
  if (confidence >= 0.85) return "High";
  if (confidence >= 0.72) return "Medium";
  return "Low";
}

function candidateRow(world: World, worldRows: ProspectRankRow[], candidate: RankedTripCandidate, rank: number): ProspectRankRow | undefined {
  const row = worldRows.find((item) => item.company.id === candidate.companyId || item.company.canonical_account_id === candidate.companyId);
  if (row) return { ...row, rank, confidence: candidate.confidence, relationship: candidate.relationship ?? row.relationship };
  const company = world.companies.find((item) => item.id === candidate.companyId || item.canonical_account_id === candidate.companyId);
  if (!company) return undefined;
  const score = world.analysis.byId.get(company.id) ?? (company.canonical_account_id ? world.analysis.byId.get(company.canonical_account_id) : undefined);
  const prospect = world.prospects.find((item) => item.company.id === company.id);
  const fit = prospect?.fit.score ?? scoreFit(company.needs, PROFILE.capabilities).score;
  const opportunity = prospect?.opportunity ?? score?.dimensions.opportunity.score ?? 0;
  const contact = world.contacts.find((item) => item.company_id === company.id);
  const openDeals = world.opportunities
    .filter((item) => item.company_id === company.id && item.stage !== "won" && item.stage !== "lost")
    .sort((a, b) => b.value - a.value);
  const topSignal = world.analysis.valid
    .filter((signal) => signal.subject_id === company.id || signal.relationships?.some((relationship) => relationship.canonical_account_id === (company.canonical_account_id ?? company.id)))
    .sort((a, b) => b.confidence - a.confidence || b.detected_at.localeCompare(a.detected_at))[0];
  return {
    rank,
    company,
    statusLine: `${company.location.city} · opportunity ${opportunity} · fit ${fit}% · ${openDeals.length} open deal${openDeals.length === 1 ? "" : "s"}`,
    confidence: candidate.confidence,
    opportunity,
    fit,
    contact,
    openDeals,
    topSignal,
    relationship: candidate.relationship,
    whyRanked: rankingExplanation(world, company, { rank, dimension: "opportunity", fitScore: fit }),
    whatChanged: topSignal ? `${topSignal.event_type.replace(/_/g, " ")} · ${topSignal.source_quote}` : "No validated account-specific signal in the current run.",
    recommendedAction: world.analysis.recById.get(company.id)?.reason ?? "Schedule the visit only if the account owner confirms a current business reason.",
  };
}

async function saveTripBrief(deliverable: Deliverable): Promise<void> {
  try {
    await createDeliverableRecord(deliverable);
  } catch {
    saveDeliverable(deliverable);
  }
}

export function TripPlanner({ world }: { world: World }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [itinerary, setItinerary] = useState<Deliverable | null>(null);
  const [candidates, setCandidates] = useState<RankedTripCandidate[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [wizardStopId, setWizardStopId] = useState<string | null>(null);
  const [meetingBriefs, setMeetingBriefs] = useState<Deliverable[]>([]);
  const [tripBrief, setTripBrief] = useState<Deliverable | null>(null);
  const worldRows = useMemo(() => prospectRowsForWorld(world), [world]);
  const selectedCandidate = candidates.find((candidate) => candidate.companyId === selectedId) ?? candidates[0];
  const selectedRow = selectedCandidate ? candidateRow(world, worldRows, selectedCandidate, candidates.indexOf(selectedCandidate) + 1) : undefined;
  const candidateMeta = Object.fromEntries(candidates.map((candidate, index) => [
    candidate.companyId,
    { rank: index + 1, confidence: candidate.confidence },
  ]));

  async function generateTrip(values: TripFormValues) {
    setBusy(true);
    setError(null);
    setTripBrief(null);
    setMeetingBriefs([]);
    try {
      const context = buildItineraryContext(values, world);
      if (context.rankedCandidates.length === 0) {
        throw new Error("No ranked candidates matched that region, radius, and goal mix.");
      }
      const draft = await itineraryAgent.compose(context);
      const validation = itineraryAgent.validate(draft, context);
      if (!validation.valid) throw new Error(validation.errors.join("; "));
      setItinerary(draft);
      setCandidates(context.rankedCandidates);
      setSelectedId(context.rankedCandidates[0]?.companyId ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate trip plan.");
    } finally {
      setBusy(false);
    }
  }

  async function compileTripBrief(nextMeetingBriefs: Deliverable[]) {
    if (!itinerary) return;
    const compiled = await runAgent("trip_brief", {
      itinerary,
      meetingBriefs: nextMeetingBriefs,
      logistics: "Confirm local drive times, meeting owners, security requirements, and meal buffers before departure.",
    }, world);
    await saveTripBrief(compiled);
    setTripBrief(compiled);
  }

  return (
    <section className="surface-page trip-planner-surface" data-surface-component="surface-trip-planner">
      <SurfaceHeader
        eyebrow="Trip planner"
        headline="Build a field plan from goals, geography, and validated account context."
        subline="Generate a candidate set first, inspect stop details second, then compile one trip brief."
      />
      <TripInputForm world={world} onSubmit={(values) => void generateTrip(values)} busy={busy} />
      {error && <div className="live-inline-status error">{error}</div>}

      {!itinerary && (
        <EmptyState headline="No trip generated yet" body="Fill the form to create ranked candidate stops, then the filtered map and stop list will appear." icon="map" />
      )}

      {itinerary && candidates.length > 0 && (
        <div className="trip-planner-layout">
          <section className="surface-panel trip-map-panel">
            <div className="panel-head">
              <h2>Candidate map</h2>
              <span>{candidates.length} ranked stops</span>
            </div>
            <Suspense fallback={<div className="loading">loading map...</div>}>
              <ProspectMap
                world={world}
                candidateIds={candidates.map((candidate) => candidate.companyId)}
                candidateMeta={candidateMeta}
                selectedCompanyId={selectedId}
                onCompanyClick={setSelectedId}
              />
            </Suspense>
          </section>

          <section className="surface-panel trip-candidate-list" aria-labelledby="trip-candidates-title">
            <div className="panel-head">
              <h2 id="trip-candidates-title">Ranked candidates</h2>
              <span>Rank + confidence only</span>
            </div>
            <div className="trip-candidate-rows">
              {candidates.map((candidate, index) => {
                const company = world.companies.find((item) => item.id === candidate.companyId || item.canonical_account_id === candidate.companyId);
                return (
                  <button
                    key={candidate.companyId}
                    type="button"
                    className={selectedCandidate?.companyId === candidate.companyId ? "trip-candidate-row active" : "trip-candidate-row"}
                    onClick={() => setSelectedId(candidate.companyId)}
                  >
                    <span>#{index + 1}</span>
                    <strong>{company?.name ?? candidate.companyId}</strong>
                    <em>{confidenceTier(candidate.confidence)}</em>
                  </button>
                );
              })}
            </div>
          </section>

          <ProspectDetail
            world={world}
            row={selectedRow}
            hasGenerated={false}
            onGenerate={() => selectedCandidate && setWizardStopId(selectedCandidate.companyId)}
            onNavigateDeliverables={() => undefined}
          />

          <section className="surface-panel trip-brief-panel">
            <div className="panel-head">
              <h2>Trip brief</h2>
              <span>{meetingBriefs.length} stop brief{meetingBriefs.length === 1 ? "" : "s"}</span>
            </div>
            {tripBrief ? (
              <>
                <p>Compiled as one saved item with logistics plus {meetingBriefs.length} stop section{meetingBriefs.length === 1 ? "" : "s"}.</p>
                <button type="button" className="accent-action-button" onClick={() => setState({ activeDeliverable: tripBrief, activeCompanyId: null, brainResponse: null, activeAnalysisSpec: null })}>
                  Open Trip Brief
                </button>
              </>
            ) : (
              <p className="muted">Generate at least one stop meeting brief to compile the trip brief.</p>
            )}
          </section>
        </div>
      )}

      {wizardStopId && (
        <DeliverableWizard
          mode="single"
          world={world}
          entityId={wizardStopId}
          initialAgentId="meeting_brief"
          onComplete={(result) => {
            const next = [...meetingBriefs, ...result.deliverables];
            setMeetingBriefs(next);
            void compileTripBrief(next);
          }}
          onClose={() => setWizardStopId(null)}
        />
      )}
    </section>
  );
}
