import { lazy, Suspense, useMemo, useState } from "react";
import type { World } from "../../app/useWorld.ts";
import { saveStoredDeliverable, recordToDeliverable } from "../../app/deliverablesApi.ts";
import { runAgent } from "../../agents/runAgent.ts";
import type { Deliverable } from "../../deliverables/types.ts";
import { saveDeliverable } from "../../memory/localMemory.ts";
import { setState } from "../../store/store.ts";
import { TripInputForm, type TripFormValues } from "../trips/TripInputForm.tsx";
import { EmptyState, SurfaceHeader } from "../primitives.tsx";
import { formatAddress } from "../../app/format.ts";

const ProspectMap = lazy(() => import("../map/ProspectMap.tsx").then((module) => ({ default: module.ProspectMap })));

function tripId(values: TripFormValues): string {
  return `trip-${values.city.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${values.startDate}`;
}

function itineraryStops(deliverable: Deliverable): Array<{ entityId: string; label: string; day: number }> {
  return deliverable.sections
    .flatMap((section) => section.blocks)
    .filter((block) => block.kind === "map-ref")
    .flatMap((block) => block.stops ?? [])
    .map((stop) => ({ entityId: stop.entityId, label: stop.label, day: stop.day }));
}

async function saveItinerary(deliverable: Deliverable): Promise<Deliverable> {
  const local = saveDeliverable(deliverable);
  try {
    const record = await saveStoredDeliverable(local);
    const persisted = recordToDeliverable(record);
    saveDeliverable(persisted);
    return persisted;
  } catch {
    return local;
  }
}

export function TripPlanner({ world }: { world: World }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [itinerary, setItinerary] = useState<Deliverable | null>(null);
  const stops = useMemo(() => itinerary ? itineraryStops(itinerary) : [], [itinerary]);

  async function generate(values: TripFormValues) {
    setBusy(true);
    setError(null);
    try {
      const generated = await runAgent("itinerary", {
        city: values.city,
        startDate: values.startDate,
        endDate: values.endDate,
        focus: values.focus,
        instructions: values.instructions,
      }, world);
      const saved = await saveItinerary({
        ...generated,
        tripId: tripId(values),
      });
      setItinerary(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate the itinerary.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="surface-page trip-planner-surface" data-surface-component="surface-trip-planner">
      <SurfaceHeader
        eyebrow="Trip planner"
        headline="Build a field itinerary from geography, priority, and validated account context."
        subline="Generate a candidate route, inspect the stops, then open the itinerary as a saved deliverable with calendar export."
      />

      <TripInputForm world={world} onSubmit={(values) => void generate(values)} busy={busy} />
      {error && <div className="live-inline-status error">{error}</div>}

      {!itinerary && (
        <EmptyState headline="No itinerary yet" body="Generate a trip to see ranked stops, map context, and a saved itinerary deliverable." icon="map" />
      )}

      {itinerary && (
        <div className="trip-planner-layout">
          <section className="surface-panel trip-map-panel">
            <div className="panel-head">
              <h2>Market map</h2>
              <span>{stops.length} itinerary stops</span>
            </div>
            <Suspense fallback={<div className="loading">loading map...</div>}>
              <ProspectMap world={world} />
            </Suspense>
          </section>

          <section className="surface-panel trip-stop-list">
            <div className="panel-head">
              <h2>Itinerary stops</h2>
              <button
                type="button"
                onClick={() => setState({
                  activeDeliverable: itinerary,
                  activeDeliverableOrigin: "generation",
                  activeTab: "deliverables",
                  activeCompanyId: null,
                  brainResponse: null,
                  activeAnalysisSpec: null,
                })}
              >
                Open itinerary
              </button>
            </div>
            {stops.map((stop, index) => {
              const company = world.companies.find((item) => item.id === stop.entityId || item.canonical_account_id === stop.entityId);
              return (
                <button key={`${stop.entityId}-${index}`} className="trip-stop-row" type="button" onClick={() => setState({ activeCompanyId: stop.entityId })}>
                  <span className="rank-badge">D{stop.day}</span>
                  <strong>{stop.label}</strong>
                  <em>{company ? formatAddress(company.location) ?? company.location.city : "Address unavailable"}</em>
                </button>
              );
            })}
          </section>
        </div>
      )}
    </section>
  );
}
