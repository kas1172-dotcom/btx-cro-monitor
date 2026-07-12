import { useState } from "react";
import { executeHubSpotTask, type WorkItem } from "../../app/workItems.ts";
import type { World } from "../../app/useWorld.ts";

function titleCase(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function WorkItemSourceNote({ source, error }: { source: "backend" | "derived"; error: string | null }) {
  if (source === "backend") return <div className="live-inline-status">Work items: backend API</div>;
  return (
    <div className={error ? "live-inline-status error" : "live-inline-status"}>
      {error ? `Backend work-item API unavailable; showing derived queue. ${error}` : "Work items: derived from current world until backend data is available."}
    </div>
  );
}

function accountName(world: World | undefined, id: string | null): string {
  if (!id) return "Portfolio";
  return world?.companies.find((company) => company.id === id || company.canonical_account_id === id)?.name ?? id;
}

function linkedEvidence(item: WorkItem, world: World | undefined): { text: string; relationship: Record<string, unknown> | null } {
  const signalId = item.source_signal_ids[0];
  const signal = world?.analysis.valid.find((candidate) => candidate.id === signalId);
  const relationship = signal?.relationships?.find((candidate) => candidate.canonical_account_id === item.canonical_account_id) ?? null;
  const parts = [
    signal ? signal.source_quote : null,
    relationship ? `${relationship.match_method} confidence ${relationship.confidence}` : null,
    item.generated_artifact_ref,
  ].filter(Boolean);
  return {
    text: parts.join(" · ") || "No evidence attached.",
    relationship: relationship ? { ...relationship } : null,
  };
}

export function WorkItemList({ items, empty = "No work items yet.", world }: { items: WorkItem[]; empty?: string; world?: World }) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [statusById, setStatusById] = useState<Record<string, string>>({});

  function setStatus(id: string, value: string): void {
    setStatusById((current) => ({ ...current, [id]: value }));
  }

  return (
    <div className="work-item-list">
      {items.map((item) => {
        const evidence = linkedEvidence(item, world);
        const canExecute = item.type === "account_action" && item.status !== "done" && item.status !== "dismissed";
        return (
          <article key={item.id} className="work-item-row">
            <div>
              <strong>{item.recommended_action}</strong>
              <span>{titleCase(item.type)} · {titleCase(item.status)} · {titleCase(item.priority)}</span>
              <em>
                {item.owner ? `Owner ${item.owner}` : "No owner"}
                {item.due_date ? ` · due ${item.due_date}` : ""}
                {item.source_signal_ids.length ? ` · ${item.source_signal_ids.length} evidence signal${item.source_signal_ids.length === 1 ? "" : "s"}` : ""}
              </em>
              {item.external_record_url && <a className="external-link" href={item.external_record_url} target="_blank" rel="noreferrer">Open in HubSpot</a>}
              {item.execution_error && <em className="work-item-error">{item.execution_error}</em>}
              {statusById[item.id] && <em className={statusById[item.id].startsWith("Verified") ? "work-item-success" : "work-item-error"}>{statusById[item.id]}</em>}
              {confirmingId === item.id && (
                <div className="work-item-confirm">
                  <strong>Confirm HubSpot task</strong>
                  <span>Account: {accountName(world, item.canonical_account_id)}</span>
                  <span>Owner: {item.owner ?? "Unassigned"}</span>
                  <span>Due: {item.due_date ?? "3 business days from execution"}</span>
                  <span>Task: {item.recommended_action}</span>
                  <span>Evidence: {evidence.text}</span>
                  <div>
                    <button
                      onClick={() => {
                        setStatus(item.id, "Executing...");
                        void executeHubSpotTask({
                          item,
                          confirmed: true,
                          accountName: accountName(world, item.canonical_account_id),
                          relationshipRecord: evidence.relationship ?? undefined,
                        }).then((result) => {
                          setStatus(item.id, `Verified HubSpot task ${result.hubspot_task.id}.`);
                          setConfirmingId(null);
                        }).catch((error) => {
                          setStatus(item.id, error instanceof Error ? error.message : "HubSpot task execution failed.");
                        });
                      }}
                    >
                      Confirm and create in HubSpot
                    </button>
                    <button onClick={() => setConfirmingId(null)}>Cancel</button>
                  </div>
                </div>
              )}
              {canExecute && confirmingId !== item.id && (
                <button className="work-item-execute" onClick={() => setConfirmingId(item.id)}>
                  Create HubSpot task
                </button>
              )}
            </div>
            <div className="work-item-state">
              <span>{titleCase(item.approval_state)}</span>
              <span>{titleCase(item.execution_state)}</span>
            </div>
          </article>
        );
      })}
      {items.length === 0 && <div className="rail-quiet-empty">{empty}</div>}
    </div>
  );
}
