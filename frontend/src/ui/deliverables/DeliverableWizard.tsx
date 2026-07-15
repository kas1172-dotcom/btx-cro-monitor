import { useMemo, useState } from "react";
import type { World } from "../../app/useWorld.ts";
import { saveStoredDeliverable, hasDeliverablesBackend } from "../../app/deliverablesApi.ts";
import { DELIVERABLE_TEMPLATE_OPTIONS, deliverableTemplateOption } from "../../agents/deliverableRegistry.ts";
import { runAgent, type AgentId } from "../../agents/runAgent.ts";
import { buildWizardPrefill, validatePrefillProvenance, type WizardPrefill } from "../../deliverables/wizardPrefill.ts";
import type { Deliverable } from "../../deliverables/types.ts";
import { saveDeliverable } from "../../memory/localMemory.ts";
import { setState } from "../../store/store.ts";
import { ScopePill } from "../primitives.tsx";

type WizardStep = "pick" | "confirm" | "preview" | "saved";

interface DeliverableWizardProps {
  world: World;
  initialAccountId?: string;
  onClose(): void;
}

function blockExcerpt(deliverable: Deliverable): Array<{ heading: string; text: string }> {
  return deliverable.sections.map((section) => {
    const firstText = section.blocks.find((block) => block.kind === "text");
    const table = section.blocks.find((block) => block.kind === "table");
    const text = firstText && firstText.kind === "text"
      ? firstText.text
      : table && table.kind === "table"
        ? `Table: ${table.columns.join(", ")} (${table.rows.length} rows)`
        : `${section.blocks.length} block${section.blocks.length === 1 ? "" : "s"}`;
    return { heading: section.heading, text };
  });
}

export function DeliverableWizard({ world, initialAccountId, onClose }: DeliverableWizardProps) {
  const [step, setStep] = useState<WizardStep>("pick");
  const [agentId, setAgentId] = useState<AgentId>("meeting_brief");
  const [accountId, setAccountId] = useState(initialAccountId ?? world.companies[0]?.id ?? "");
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<Deliverable | null>(null);

  const option = deliverableTemplateOption(agentId);
  const accounts = useMemo(
    () => [...world.companies].sort((a, b) => a.name.localeCompare(b.name)),
    [world],
  );
  const prefill: WizardPrefill = useMemo(
    () => buildWizardPrefill(agentId, world, option.requiresAccount ? accountId : undefined),
    [agentId, world, accountId, option.requiresAccount],
  );
  const provenanceViolations = validatePrefillProvenance(prefill.fields);

  function pickTemplate(id: AgentId) {
    setAgentId(id);
    const picked = deliverableTemplateOption(id);
    setInstructions(picked.defaultInstructions ?? "");
    setError(null);
  }

  async function generatePreview() {
    if (provenanceViolations.length) {
      setError(`Provenance check failed: ${provenanceViolations.join(" ")}`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const inputs = { ...prefill.inputs, instructions: instructions.trim() || prefill.inputs.instructions };
      const deliverable = await runAgent(agentId, inputs, world);
      setPreview(deliverable);
      setStep("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate the deliverable.");
    } finally {
      setBusy(false);
    }
  }

  async function saveToLibrary() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      if (hasDeliverablesBackend()) {
        try {
          const record = await saveStoredDeliverable(preview);
          setPreview({ ...preview, backendRecordId: record.id });
          setNotice(null);
        } catch {
          saveDeliverable(preview);
          setNotice("Saved locally — backend program memory is unavailable.");
        }
      } else {
        saveDeliverable(preview);
        setNotice("Saved locally — backend program memory is not configured.");
      }
      setStep("saved");
    } finally {
      setBusy(false);
    }
  }

  function openInEditor() {
    if (!preview) return;
    setState({
      activeDeliverable: preview,
      activeDeliverableOrigin: "generation",
      activeTab: "deliverables",
      brainResponse: null,
      activeAnalysisSpec: null,
      activeCompanyId: null,
    });
    onClose();
  }

  return (
    <div className="demo-action-overlay deliverable-wizard-overlay" role="presentation">
      <div className="demo-action-modal deliverable-wizard" role="dialog" aria-modal="true" aria-label="New deliverable">
        <button className="deliverable-wizard-close" onClick={onClose} aria-label="Close">×</button>
        <p className="eyebrow">New deliverable</p>

        {error && <div className="deliverable-wizard-error" role="alert">{error}</div>}
        {notice && <div className="deliverable-wizard-notice" role="status">{notice}</div>}

        {step === "pick" && (
          <>
            <h2>Pick a template</h2>
            <div className="deliverable-wizard-options">
              {DELIVERABLE_TEMPLATE_OPTIONS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={agentId === item.id ? "selected" : ""}
                  onClick={() => pickTemplate(item.id)}
                >
                  <strong>{item.label}</strong>
                  <span>{item.description}</span>
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
            <h2>{option.label}</h2>
            <p className="deliverable-wizard-hint">
              Confirm the inputs below. Each value shows where it came from; nothing is generated until you ask for a preview.
            </p>
            {option.requiresAccount && (
              <label className="deliverable-wizard-field">
                <span>Account</span>
                <select value={accountId} onChange={(event) => setAccountId(event.target.value)}>
                  {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
                </select>
              </label>
            )}
            <div className="deliverable-wizard-provenance">
              {prefill.fields.map((field) => (
                <div key={field.field} className="deliverable-wizard-provenance-row">
                  <span className="deliverable-wizard-provenance-label">{field.label}</span>
                  <strong>{field.value}</strong>
                  <span className="deliverable-wizard-provenance-meta">
                    <ScopePill scope={field.scope === "account" ? "specific_account" : "market"} />
                    {field.source} · {field.method.replace(/_/g, " ")}
                    {field.confidence !== null ? ` · ${Math.round(field.confidence * 100)}%` : ""}
                  </span>
                </div>
              ))}
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
              <button type="button" onClick={() => void generatePreview()} disabled={busy}>
                {busy ? "Generating preview..." : "Preview"}
              </button>
              <button type="button" onClick={() => setStep("pick")} disabled={busy}>Back</button>
            </div>
          </>
        )}

        {step === "preview" && preview && (
          <>
            <h2>{preview.title}</h2>
            <p className="deliverable-wizard-hint">
              Preview only — nothing is saved until you confirm. Confidence: {preview.confidence}
              {preview.confidenceReason ? ` (${preview.confidenceReason})` : ""}.
            </p>
            <div className="deliverable-wizard-preview">
              {blockExcerpt(preview).map((section) => (
                <div key={section.heading} className="deliverable-wizard-preview-section">
                  <strong>{section.heading}</strong>
                  <p>{section.text}</p>
                </div>
              ))}
            </div>
            <div className="deliverable-wizard-sources">
              <span>Sources</span>
              <ul>
                {preview.sources.map((source, index) => (
                  <li key={`${source.source}-${index}`}>{source.source}: {source.reason}</li>
                ))}
              </ul>
            </div>
            <div className="demo-action-modal-actions">
              <button type="button" onClick={() => void saveToLibrary()} disabled={busy}>
                {busy ? "Saving..." : "Save to library"}
              </button>
              <button type="button" onClick={() => setStep("confirm")} disabled={busy}>Back</button>
              <button type="button" onClick={onClose} disabled={busy}>Discard</button>
            </div>
          </>
        )}

        {step === "saved" && preview && (
          <div className="deliverable-wizard-done">
            <h2>Saved</h2>
            <p>“{preview.title}” is in the deliverable library.</p>
            <div className="demo-action-modal-actions">
              <button type="button" onClick={openInEditor}>Open in editor</button>
              <button type="button" onClick={onClose}>Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
