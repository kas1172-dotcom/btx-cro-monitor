import { useMemo, useState } from "react";
import { TAB_LABELS, type TabId } from "../../app/surfaces.ts";
import { useMemory } from "../../memory/localMemory.ts";

const AREAS: Array<TabId | "all"> = ["all", "brief", "work_queue", "accounts", "ask", "map", "analysis", "capacity", "programs", "settings"];

export function MemoryPanel() {
  const memory = useMemory();
  const [query, setQuery] = useState("");
  const [area, setArea] = useState<TabId | "all">("all");
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return memory.activity.filter((entry) => {
      if (area !== "all" && entry.brainArea !== area) return false;
      if (!q) return true;
      return `${entry.title} ${entry.summary} ${entry.entityIds.join(" ")}`.toLowerCase().includes(q);
    });
  }, [area, memory.activity, query]);

  return (
    <section className="memory-panel">
      <div className="quiet-view-head">
        <p className="eyebrow">Decision Brain</p>
        <h1>{rows.length} saved decisions, notes, and actions</h1>
      </div>
      <div className="memory-controls">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search memory..." />
        <select value={area} onChange={(event) => setArea(event.target.value as TabId | "all")}>
          {AREAS.map((item) => <option key={item} value={item}>{item === "all" ? "All areas" : TAB_LABELS[item]}</option>)}
        </select>
      </div>
      <div className="memory-list">
        {rows.slice(0, 20).map((entry) => (
          <article key={entry.id} className="memory-row">
            <span>{TAB_LABELS[entry.brainArea]}</span>
            <strong>{entry.title}</strong>
            <em>{entry.summary}</em>
          </article>
        ))}
        {rows.length === 0 && <div className="memory-empty">No saved memory yet.</div>}
      </div>
    </section>
  );
}
