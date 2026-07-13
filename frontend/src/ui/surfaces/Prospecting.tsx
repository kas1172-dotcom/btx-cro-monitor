import { useEffect, useMemo, useState } from "react";
import type { World } from "../../app/useWorld.ts";
import { markProspectGenerated, prospectHasGenerated } from "../../app/prospectingMemory.ts";
import { setState } from "../../store/store.ts";
import { signalHeadline, signalSourceDate, signalSourceName } from "../../app/signalProvenance.ts";
import { DeliverableWizard } from "../deliverables/DeliverableWizard.tsx";
import { ProspectDetail } from "../prospecting/ProspectDetail.tsx";
import { industryUpdatesForProspects, prospectRowsForWorld } from "../prospecting/prospectingModel.ts";
import { EmptyState, SignalCard, SurfaceHeader } from "../primitives.tsx";

const INITIAL_VISIBLE = 20;

export function Prospecting({ world }: { world: World }) {
  const [showAll, setShowAll] = useState(false);
  const rows = useMemo(() => prospectRowsForWorld(world), [world]);
  const updates = useMemo(() => industryUpdatesForProspects(world), [world]);
  const [selectedId, setSelectedId] = useState(rows[0]?.company.id ?? "");
  const [generatedById, setGeneratedById] = useState<Record<string, boolean>>({});
  const [wizardOpen, setWizardOpen] = useState(false);
  const visibleRows = showAll ? rows : rows.slice(0, INITIAL_VISIBLE);
  const selected = rows.find((row) => row.company.id === selectedId) ?? rows[0];

  useEffect(() => {
    let alive = true;
    void Promise.all(rows.map(async (row) => [row.company.id, await prospectHasGenerated(row.company.id)] as const))
      .then((pairs) => {
        if (!alive) return;
        setGeneratedById(Object.fromEntries(pairs));
      });
    return () => {
      alive = false;
    };
  }, [rows]);

  useEffect(() => {
    if (!selectedId && rows[0]) setSelectedId(rows[0].company.id);
  }, [rows, selectedId]);

  async function markGenerated(prospectId: string) {
    await markProspectGenerated(prospectId);
    setGeneratedById((current) => ({ ...current, [prospectId]: true }));
  }

  function navigateToDeliverables() {
    setState({
      activeSurface: "settings",
      activeSettings: true,
      activeSettingsSection: "memory",
      activeCompanyId: null,
      brainResponse: null,
      activeDeliverable: null,
      activeAnalysisSpec: null,
    });
  }

  return (
    <section className="surface-page prospecting-surface" data-surface-component="surface-prospecting">
      <SurfaceHeader
        eyebrow="Prospecting"
        headline={`${rows.length} new-business prospects ranked for focused follow-up.`}
        subline="List rows stay intentionally shallow; relationship evidence and confidence details live inside the expanded detail panel."
      />

      <section className="surface-panel prospecting-updates" aria-labelledby="prospecting-updates-title">
        <div className="panel-head">
          <h2 id="prospecting-updates-title">Industry updates</h2>
          <span>{updates.length} updates</span>
        </div>
        <div className="signal-mini-list">
          {updates.slice(0, 4).map((signal) => (
            <SignalCard
              key={signal.id}
              title={signalHeadline(signal)}
              scope={signal.scope}
              source={`${signal.subject_id === "__portfolio__" ? "Market / program" : "Prospect motion"} · ${signalSourceName(signal)}`}
              date={signalSourceDate(signal)}
              body={signal.source_quote}
              provenance={{
                entity: signal.entities[0] ?? "Market / program",
                method: signal.relationships?.[0]?.match_method,
                confidence: signal.relationships?.[0]?.confidence ?? signal.confidence,
              }}
            />
          ))}
          {updates.length === 0 && <EmptyState headline="No prospecting updates" body="Prospect-motion contract and program updates will appear here after validation." icon="signal" />}
        </div>
      </section>

      <div className="prospecting-layout">
        <section className="surface-panel prospecting-list" aria-labelledby="prospecting-list-title">
          <div className="panel-head">
            <h2 id="prospecting-list-title">Ranked prospects</h2>
            <span>{visibleRows.length} shown</span>
          </div>
          <div className="prospecting-list-rows">
            {visibleRows.map((row) => (
              <button
                key={row.company.id}
                type="button"
                className={selected?.company.id === row.company.id ? "prospecting-list-row active" : "prospecting-list-row"}
                onClick={() => setSelectedId(row.company.id)}
              >
                <span className="prospecting-rank">#{row.rank}</span>
                <strong>{row.company.name}</strong>
                <em>{row.statusLine}</em>
                <span className="confidence-chip">{Math.round(row.confidence * 100)}%</span>
              </button>
            ))}
            {rows.length === 0 && <EmptyState headline="No prospecting accounts" body="Prospect records require business_motion set to prospect_new_business." icon="empty" />}
          </div>
          {rows.length > INITIAL_VISIBLE && (
            <button type="button" className="accent-action-button" onClick={() => setShowAll((value) => !value)}>
              {showAll ? "Show fewer" : "Show more"}
            </button>
          )}
        </section>

        <ProspectDetail
          world={world}
          row={selected}
          hasGenerated={Boolean(selected && generatedById[selected.company.id])}
          onGenerate={() => setWizardOpen(true)}
          onNavigateDeliverables={navigateToDeliverables}
        />
      </div>

      {wizardOpen && selected && (
        <DeliverableWizard
          mode="multi-select"
          world={world}
          entityId={selected.company.id}
          actions={["deliverable", "hubspot_task"]}
          onComplete={() => markGenerated(selected.company.id)}
          onClose={() => setWizardOpen(false)}
        />
      )}
    </section>
  );
}
