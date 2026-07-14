import { useEffect, useMemo, useState } from "react";
import type { World } from "../../app/useWorld.ts";
import {
  deliverableAccountId,
  hasDeliverablesBackend,
  listStoredDeliverables,
  recordToDeliverable,
} from "../../app/deliverablesApi.ts";
import type { Deliverable, DeliverableType } from "../../deliverables/types.ts";
import { useMemory } from "../../memory/localMemory.ts";
import { setState } from "../../store/store.ts";
import { EmptyState, ListRow, SurfaceHeader } from "../primitives.tsx";

export interface LibraryItem {
  deliverable: Deliverable;
  accountId: string | null;
  accountName: string;
  updatedAt: string;
  source: "backend" | "local";
}

const typeLabels: Record<DeliverableType, string> = {
  itinerary: "Itinerary",
  meeting_brief: "Meeting brief",
  board_deck: "Board deck",
  weekly_memo: "Weekly memo",
  analysis_view: "Analysis view",
  outreach: "Outreach",
  sales_pitch: "Sales pitch",
  capabilities_assessment: "Capabilities assessment",
};

function labelType(type: DeliverableType): string {
  return typeLabels[type] ?? type.replace(/_/g, " ");
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function buildLibraryItems(input: {
  backend: Deliverable[];
  local: Deliverable[];
  world: World;
}): LibraryItem[] {
  const byId = new Map<string, LibraryItem>();
  const add = (deliverable: Deliverable, source: LibraryItem["source"]) => {
    const accountId = deliverableAccountId(deliverable);
    const accountName = accountId
      ? input.world.companies.find((company) => company.id === accountId)?.name ?? accountId
      : "Portfolio";
    const updatedAt = deliverable.createdAt;
    byId.set(deliverable.backendRecordId ?? deliverable.id, { deliverable, accountId, accountName, updatedAt, source });
  };
  input.local.forEach((deliverable) => add(deliverable, "local"));
  input.backend.forEach((deliverable) => add(deliverable, "backend"));
  return [...byId.values()].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export function filterLibraryItems(items: LibraryItem[], filters: { accountId: string; type: string }): LibraryItem[] {
  return items.filter((item) => {
    const accountMatch = filters.accountId === "all" || item.accountId === filters.accountId;
    const typeMatch = filters.type === "all" || item.deliverable.type === filters.type;
    return accountMatch && typeMatch;
  });
}

export function DeliverableLibrary({ world }: { world: World }) {
  const memory = useMemory();
  const [backendDeliverables, setBackendDeliverables] = useState<Deliverable[]>([]);
  const [accountFilter, setAccountFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");

  async function refresh() {
    if (!hasDeliverablesBackend()) {
      setStatus("Backend program memory is not configured; showing local library entries.");
      return;
    }
    setLoading(true);
    try {
      const records = await listStoredDeliverables();
      setBackendDeliverables(records.map(recordToDeliverable));
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not load backend deliverables.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const items = useMemo(() => buildLibraryItems({ backend: backendDeliverables, local: memory.deliverables, world }), [backendDeliverables, memory.deliverables, world]);
  const visible = useMemo(() => filterLibraryItems(items, { accountId: accountFilter, type: typeFilter }), [accountFilter, items, typeFilter]);
  const accountOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const item of items) {
      if (item.accountId) seen.set(item.accountId, item.accountName);
    }
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [items]);
  const typeOptions = useMemo(() => [...new Set(items.map((item) => item.deliverable.type))].sort(), [items]);

  return (
    <section className="surface-page deliverable-library" data-surface-component="surface-deliverable-library">
      <SurfaceHeader
        eyebrow="Program memory"
        headline="Deliverable editor"
        subline="Browse saved briefs, decks, memos, and analysis views; open one to edit, download, or create CRM follow-up."
      />

      <div className="surface-panel library-toolbar">
        <label>
          <span>Account</span>
          <select value={accountFilter} onChange={(event) => setAccountFilter(event.target.value)}>
            <option value="all">All accounts</option>
            {accountOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
        <label>
          <span>Type</span>
          <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
            <option value="all">All types</option>
            {typeOptions.map((type) => <option key={type} value={type}>{labelType(type)}</option>)}
          </select>
        </label>
        <button onClick={() => void refresh()} disabled={loading}>{loading ? "Refreshing..." : "Refresh"}</button>
        <p>{visible.length} of {items.length} deliverables</p>
      </div>

      {status && <div className="live-inline-status">{status}</div>}

      <div className="deliverable-library-grid">
        {visible.map((item) => (
          <button
            key={`${item.source}-${item.deliverable.backendRecordId ?? item.deliverable.id}`}
            className="deliverable-library-card"
            onClick={() => setState({
              activeDeliverable: item.deliverable,
              activeDeliverableOrigin: "library",
              activeTab: "deliverables",
              brainResponse: null,
              activeAnalysisSpec: null,
              activeCompanyId: null,
            })}
          >
            <ListRow
              name={item.deliverable.title}
              subtitle={`${labelType(item.deliverable.type)} · ${item.accountName} · ${formatDate(item.updatedAt)} · ${item.source === "backend" ? "Program memory" : "Local draft"}`}
              action="Open"
            />
          </button>
        ))}
      </div>

      {!visible.length && (
        <EmptyState
          icon="document"
          headline={items.length ? "No deliverables match these filters" : "No saved deliverables yet"}
          body={items.length ? "Adjust the account or type filter to widen the list." : "Generate or save a deliverable from another tab, then return here to edit it."}
        />
      )}
    </section>
  );
}
