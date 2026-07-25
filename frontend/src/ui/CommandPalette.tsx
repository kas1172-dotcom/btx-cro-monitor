import { useEffect, useMemo, useRef, useState } from "react";
import { navigateTo, pathForTab, workItemPath } from "../app/router.ts";
import { TAB_LABELS, type TabId } from "../app/surfaces.ts";
import { contextRibbonItems, demoWorkspaceNotice } from "../app/presentation.ts";
import type { World } from "../app/useWorld.ts";
import { UiIcon } from "./primitives.tsx";

type CommandItem = {
  id: string;
  group: string;
  label: string;
  detail: string;
  path: string;
};

const NAV_ITEMS: TabId[] = ["brief", "work_queue", "accounts", "ask", "programs", "prospecting", "capacity", "analysis", "map", "deliverables", "hubspot", "settings"];

function commandsFor(world: World | null): CommandItem[] {
  const nav = NAV_ITEMS.map((tab) => ({
    id: `nav-${tab}`,
    group: tab === "brief" || tab === "work_queue" || tab === "accounts" || tab === "ask" ? "Primary" : "Workspace",
    label: TAB_LABELS[tab],
    detail: "Open workspace",
    path: pathForTab(tab),
  }));
  if (!world) return nav;
  const accounts = world.companies.slice(0, 20).map((company) => ({
    id: `account-${company.id}`,
    group: "Accounts",
    label: company.name,
    detail: company.relationship === "customer" ? "Customer account" : "Prospect or related organization",
    path: `/accounts/${encodeURIComponent(company.id)}`,
  }));
  const work = (world.worldSnapshot?.workItems ?? []).slice(0, 20).map((item) => ({
    id: `work-${item.id}`,
    group: "Work",
    label: item.recommended_action,
    detail: item.owner ? `${item.owner} · ${item.status.replace(/_/g, " ")}` : `Unassigned · ${item.status.replace(/_/g, " ")}`,
    path: workItemPath(item.id),
  }));
  const quick = [
    { id: "quick-approvals", group: "Quick views", label: "View approvals", detail: "Open work awaiting approval", path: "/work?approval=pending" },
    { id: "quick-overdue", group: "Quick views", label: "View overdue work", detail: "Open work past due", path: "/work?overdue=true" },
    { id: "quick-brief", group: "Quick views", label: "Generate executive brief", detail: "Open deliverables", path: "/deliverables" },
    { id: "quick-ask", group: "Quick views", label: "Ask the assistant", detail: "Open Ask", path: "/ask" },
  ];
  return [...quick, ...nav, ...accounts, ...work];
}

export function ContextRibbon({ world }: { world: World | null }) {
  if (!world) return null;
  const notice = demoWorkspaceNotice(world);
  const items = contextRibbonItems(world);
  return (
    <div className="context-ribbon" aria-label="Relevant system status">
      {notice ? <span className="context-ribbon-notice">{notice}</span> : null}
      {items.map((item) => item.href ? (
        <button key={item.id} type="button" className={`context-ribbon-item ${item.tone}`} onClick={() => navigateTo(item.href ?? "/today")}>{item.label}</button>
      ) : (
        <span key={item.id} className={`context-ribbon-item ${item.tone}`}>{item.label}</span>
      ))}
    </div>
  );
}

export function CommandPalette({ world, open, onClose }: { world: World | null; open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const commands = useMemo(() => commandsFor(world), [world]);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return commands.slice(0, 24);
    return commands
      .filter((item) => `${item.group} ${item.label} ${item.detail}`.toLowerCase().includes(normalized))
      .slice(0, 24);
  }, [commands, query]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    inputRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        previous?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  if (!open) return null;
  return (
    <div className="command-overlay" role="dialog" aria-modal="true" aria-labelledby="command-title">
      <div className="command-palette">
        <div className="command-search">
          <UiIcon name="ask" />
          <label htmlFor="global-command-input" className="sr-only">Search commands, accounts, and work items</label>
          <input
            id="global-command-input"
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search accounts, work, routes, or ask..."
          />
          <button type="button" onClick={onClose}>Close</button>
        </div>
        <h2 id="command-title">Command</h2>
        <div className="command-results">
          {filtered.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                navigateTo(item.path);
                onClose();
              }}
            >
              <span>{item.group}</span>
              <strong>{item.label}</strong>
              <em>{item.detail}</em>
            </button>
          ))}
          {!filtered.length && <p>No matching commands. Try an account, work item, or route name.</p>}
        </div>
      </div>
    </div>
  );
}
