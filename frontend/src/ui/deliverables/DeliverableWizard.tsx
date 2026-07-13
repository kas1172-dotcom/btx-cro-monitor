import { useEffect, useMemo, useState } from "react";
import type { World } from "../../app/useWorld.ts";
import { defaultDateAnchor, defaultTripWindow, quarterOptions } from "../../app/dateDefaults.ts";
import { createDeliverableRecord, listDeliverableRecords, patchDeliverableRecord, type BackendDeliverableRecord } from "../../app/deliverablesApi.ts";
import type { MetricId } from "../../metrics/types.ts";
import { DELIVERABLE_AGENT_OPTIONS, deliverableOption, type WizardMode } from "../../agents/deliverableRegistry.ts";
import { runAgent, type AgentId } from "../../agents/runAgent.ts";
import type { Deliverable, DeliverableSection } from "../../deliverables/types.ts";
import { saveDeliverable } from "../../memory/localMemory.ts";
import { setState } from "../../store/store.ts";

interface DeliverableWizardProps {
  mode: WizardMode;
  world: World;
  entityId?: string;
  entityIds?: string[];
  initialAgentId?: AgentId;
  initialInstructions?: string;
  onClose(): void;
}

type WizardStep = "pick" | "confirm" | "done";

function companyName(world: World, id: string | undefined): string {
  if (!id) return "No account selected";
  return world.companies.find((company) => company.id === id)?.name ?? id;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function appendSections(target: Deliverable, addition: Deliverable): Deliverable {
  const now = new Date().toISOString();
  const existingSections = target.sections ?? [];
  const appended: DeliverableSection[] = addition.sections.map((section) => ({
    ...section,
    id: `${addition.id}-${section.id}`,
    heading: `${addition.title}: ${section.heading}`,
  }));
  return {
    ...target,
    title: target.title,
    createdAt: target.createdAt ?? now,
    entityIds: unique([...(target.entityIds ?? []), ...addition.entityIds]),
    sections: [...existingSections, ...appended],
    sources: [...(target.sources ?? []), ...(addition.sources ?? [])],
    actions: target.actions ?? [],
  };
}

export function DeliverableWizard({
  mode,
  world,
  entityId,
  entityIds,
  initialAgentId,
  initialInstructions = "",
  onClose,
}: DeliverableWizardProps) {
  const anchor = defaultDateAnchor(world);
  const tripDefaults = defaultTripWindow(anchor);
  const quarters = quarterOptions(anchor);
  const defaultAgent = initialAgentId ?? "meeting_brief";
  const [step, setStep] = useState<WizardStep>("pick");
  const [selectedAgents, setSelectedAgents] = useState<AgentId[]>([defaultAgent]);
  const [accountId, setAccountId] = useState(entityId ?? entityIds?.[0] ?? world.prospects[0]?.company.id ?? world.companies[0]?.id ?? "");
  const [instructions, setInstructions] = useState(initialInstructions || deliverableOption(defaultAgent).defaultInstructions || "");
  const [tripCity, setTripCity] = useState(world.city ?? world.companies[0]?.location.city ?? "");
  const [startDate, setStartDate] = useState(tripDefaults.startDate);
  const [endDate, setEndDate] = useState(tripDefaults.endDate);
  const [quarter, setQuarter] = useState(quarters[0]);
  const [metric, setMetric] = useState<MetricId>("revenue");
  const [existing, setExisting] = useState<BackendDeliverableRecord[]>([]);
  const [selectedExistingId, setSelectedExistingId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saved, setSaved] = useState<Deliverable[]>([]);

  const accounts = useMemo(() => {
    const seen = new Set<string>();
    return [...world.prospects.map((p) => p.company), ...world.companies].filter((company) => {
      if (seen.has(company.id)) return false;
      seen.add(company.id);
      return true;
    });
  }, [world]);
  const cities = useMemo(() => unique(world.companies.map((company) => company.location.city).filter(Boolean)).sort(), [world]);
  const selectedOptions = selectedAgents.map((id) => deliverableOption(id));
  const requiresAccount = selectedOptions.some((option) => option.requiresAccount);
  const requiresTrip = selectedOptions.some((option) => option.requiresTrip);
  const requiresQuarter = selectedOptions.some((option) => option.requiresQuarter);
  const requiresMetric = selectedOptions.some((option) => option.requiresMetric);
  const canSelectMultiple = mode === "multi-select";

  useEffect(() => {
    if (mode !== "insert-into-existing") return;
    let alive = true;
    void listDeliverableRecords()
      .then((result) => {
        if (!alive) return;
        setExisting(result.records);
        setSelectedExistingId((current) => current || result.records[0]?.id || "");
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setError(err instanceof Error ? err.message : "Could not load saved deliverables.");
      });
    return () => {
      alive = false;
    };
  }, [mode]);

  function toggleAgent(id: AgentId) {
    setSelectedAgents((current) => {
      if (!canSelectMultiple) return [id];
      if (current.includes(id)) return current.length === 1 ? current : current.filter((item) => item !== id);
      return [...current, id];
    });
    const option = deliverableOption(id);
    if (!instructions && option.defaultInstructions) setInstructions(option.defaultInstructions);
  }

  function inputsFor(id: AgentId): Record<string, unknown> {
    const trimmedInstructions = instructions.trim();
    if (id === "itinerary") {
      return { city: tripCity, startDate, endDate, focus: "mixed", instructions: trimmedInstructions || undefined };
    }
    if (id === "board_deck") {
      return { quarter, audience: "board", instructions: trimmedInstructions || undefined };
    }
    if (id === "analysis_annotation") {
      return { metric, quarter, instructions: trimmedInstructions || undefined };
    }
    if (id === "weekly_memo") {
      return { instructions: trimmedInstructions || undefined };
    }
    return { accountId, instructions: trimmedInstructions || deliverableOption(id).defaultInstructions || undefined };
  }

  async function saveGenerated(generated: Deliverable[]) {
    if (mode === "insert-into-existing") {
      const target = existing.find((record) => record.id === selectedExistingId);
      if (!target) throw new Error("Choose an existing deliverable to update.");
      let merged = target.document;
      for (const deliverable of generated) {
        merged = appendSections(merged, deliverable);
      }
      try {
        const patched = await patchDeliverableRecord(target.id, {
          document: merged,
          entity_ids: merged.entityIds,
          title: merged.title,
        });
        setSaved([patched.document]);
        setNotice(null);
      } catch {
        generated.forEach(saveDeliverable);
        setSaved(generated);
        setNotice("saved locally - backend unavailable");
      }
      return;
    }

    const localFallbacks: Deliverable[] = [];
    const persisted: Deliverable[] = [];
    for (const deliverable of generated) {
      try {
        const savedRecord = await createDeliverableRecord(deliverable);
        persisted.push(savedRecord.document);
      } catch {
        saveDeliverable(deliverable);
        localFallbacks.push(deliverable);
      }
    }
    setSaved([...persisted, ...localFallbacks]);
    setNotice(localFallbacks.length ? "saved locally - backend unavailable" : null);
  }

  async function generate() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const generated: Deliverable[] = [];
      for (const id of selectedAgents) {
        generated.push(await runAgent(id, inputsFor(id), world));
      }
      await saveGenerated(generated);
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create deliverable.");
    } finally {
      setBusy(false);
    }
  }

  function openDeliverable(deliverable: Deliverable) {
    setState({
      activeDeliverable: deliverable,
      activeCompanyId: null,
      activeBrainArea: deliverable.brainArea,
      brainResponse: null,
      activeAnalysisSpec: null,
    });
    onClose();
  }

  return (
    <div className="demo-action-overlay deliverable-wizard-overlay" role="presentation">
      <div className="demo-action-modal deliverable-wizard" role="dialog" aria-modal="true" aria-label="Generate deliverable">
        <button className="deliverable-wizard-close" onClick={onClose} aria-label="Close">×</button>
        <p className="deliverable-wizard-kicker">{mode.replace(/-/g, " ")}</p>
        <h2>Generate deliverable</h2>
        {notice && <div className="deliverable-wizard-notice" role="status">{notice}</div>}
        {error && <div className="deliverable-wizard-error" role="alert">{error}</div>}

        {step === "pick" && (
          <>
            <div className="deliverable-wizard-options">
              {DELIVERABLE_AGENT_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={selectedAgents.includes(option.id) ? "selected" : ""}
                  onClick={() => toggleAgent(option.id)}
                >
                  <strong>{option.label}</strong>
                  <span>{option.description}</span>
                </button>
              ))}
            </div>
            <div className="demo-action-modal-actions">
              <button type="button" onClick={() => setStep("confirm")}>Continue</button>
              <button type="button" onClick={onClose}>Cancel</button>
            </div>
          </>
        )}

        {step === "confirm" && (
          <>
            <div className="deliverable-wizard-summary">
              <span>Types</span>
              <strong>{selectedOptions.map((option) => option.label).join(", ")}</strong>
              {requiresAccount && (
                <>
                  <span>Account</span>
                  {entityId ? (
                    <strong>{companyName(world, entityId)}</strong>
                  ) : (
                    <select value={accountId} onChange={(event) => setAccountId(event.target.value)}>
                      {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
                    </select>
                  )}
                </>
              )}
              {mode === "insert-into-existing" && (
                <>
                  <span>Existing deliverable</span>
                  <select value={selectedExistingId} onChange={(event) => setSelectedExistingId(event.target.value)}>
                    {existing.map((record) => <option key={record.id} value={record.id}>{record.title}</option>)}
                  </select>
                </>
              )}
              {requiresTrip && (
                <>
                  <span>Trip</span>
                  <div className="deliverable-wizard-inline">
                    <select value={tripCity} onChange={(event) => setTripCity(event.target.value)}>
                      {cities.map((city) => <option key={city} value={city}>{city}</option>)}
                    </select>
                    <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
                    <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
                  </div>
                </>
              )}
              {requiresQuarter && (
                <>
                  <span>Quarter</span>
                  <select value={quarter} onChange={(event) => setQuarter(event.target.value)}>
                    {quarters.map((item) => <option key={item}>{item}</option>)}
                  </select>
                </>
              )}
              {requiresMetric && (
                <>
                  <span>Metric</span>
                  <select value={metric} onChange={(event) => setMetric(event.target.value as MetricId)}>
                    <option value="revenue">Revenue</option>
                    <option value="bookings">Bookings</option>
                    <option value="backlog">Backlog</option>
                    <option value="capacity_utilization">Capacity utilization</option>
                  </select>
                </>
              )}
            </div>
            <label className="deliverable-wizard-instructions">
              Instructions
              <textarea
                value={instructions}
                onChange={(event) => setInstructions(event.target.value)}
                placeholder="Optional: emphasize, include, or avoid anything..."
              />
            </label>
            <div className="demo-action-modal-actions">
              <button type="button" onClick={() => void generate()} disabled={busy || !selectedAgents.length}>
                {busy ? "Generating..." : "Generate"}
              </button>
              <button type="button" onClick={() => setStep("pick")} disabled={busy}>Back</button>
            </div>
          </>
        )}

        {step === "done" && (
          <div className="deliverable-wizard-done">
            <strong>{saved.length} deliverable{saved.length === 1 ? "" : "s"} saved</strong>
            <ul>
              {saved.map((deliverable) => <li key={deliverable.id}>{deliverable.title}</li>)}
            </ul>
            <div className="demo-action-modal-actions">
              <button type="button" onClick={() => saved[0] ? openDeliverable(saved[0]) : onClose()}>Open latest</button>
              <button type="button" onClick={onClose}>Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
