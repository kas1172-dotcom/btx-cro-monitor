import type { CSSProperties, ReactNode } from "react";
import type { SurfaceId } from "../app/surfaces.ts";

type IconName = SurfaceId | "document" | "empty" | "chevron" | "signal" | "user";

const iconPaths: Record<IconName, ReactNode> = {
  brief: <path d="M5 5h14M5 10h10M5 15h14M5 20h8" />,
  work_queue: <path d="M7 6h10M7 12h10M7 18h7M4 6h.01M4 12h.01M4 18h.01" />,
  accounts: <path d="M8 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm8 10v-2a5 5 0 0 0-5-5H5a5 5 0 0 0-5 5v2M18 11a3 3 0 1 0 0-6M23 21v-1.5a4 4 0 0 0-3-3.8" />,
  ask: <path d="M6 8a6 6 0 0 1 12 0c0 4-6 5-6 9M12 22h.01" />,
  prospecting: <path d="M4 19l5-10 4 5 3-7 4 12M9 9l-5 10m9-5 7 5M7 19h10" />,
  map: <path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Zm6-3v15m6-12v15" />,
  analysis: <path d="M4 19V5m0 14h17M8 16V9m5 7V6m5 10v-4" />,
  capacity: <path d="M4 18h16M6 18V8l6-4 6 4v10M9 18v-6h6v6" />,
  programs: <path d="M5 4h10l4 4v12H5V4Zm9 0v5h5M8 13h8M8 17h6" />,
  settings: <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm0-13v3m0 13v3M4.6 4.6l2.1 2.1m10.6 10.6 2.1 2.1m2.1-14.8-2.1 2.1M6.7 17.3l-2.1 2.1M1.5 12h3m15 0h3" />,
  document: <path d="M6 3h9l4 4v14H6V3Zm9 0v5h4M9 12h7M9 16h7" />,
  empty: <path d="M5 7h14v12H5V7Zm3-4h8l2 4H6l2-4Zm3 10h2" />,
  chevron: <path d="m9 6 6 6-6 6" />,
  signal: <path d="M4 18h16M7 15l3-4 3 2 4-7" />,
  user: <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9a7 7 0 0 1 14 0" />,
};

export function UiIcon({ name, className = "" }: { name: IconName; className?: string }) {
  return (
    <svg className={["ui-icon", className].filter(Boolean).join(" ")} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {iconPaths[name]}
    </svg>
  );
}

export function AppShell({
  className,
  rightW,
  rail,
  topbar,
  onMainClickCapture,
  children,
  side,
}: {
  className: string;
  rightW: string;
  rail: ReactNode;
  topbar: ReactNode;
  onMainClickCapture?: () => void;
  children: ReactNode;
  side?: ReactNode;
}) {
  return (
    <div className={className} style={{ "--right-w": rightW } as CSSProperties}>
      {rail}
      <main className="quiet-main" onClickCapture={onMainClickCapture}>{topbar}{children}</main>
      {side}
    </div>
  );
}

export function SurfaceHeader({ eyebrow, headline, subline }: { eyebrow: string; headline: ReactNode; subline?: ReactNode }) {
  return (
    <div className="surface-header quiet-view-head">
      <p className="eyebrow">{eyebrow}</p>
      <h1>{headline}</h1>
      {subline ? <p>{subline}</p> : null}
    </div>
  );
}

export function CountBadge({ value }: { value: number }) {
  return <em className="count-badge">{value}</em>;
}

export function StatusChip({ tone = "info", label, value }: { tone?: "success" | "warning" | "danger" | "info"; label: string; value: ReactNode }) {
  return (
    <div className={`status-chip ${tone}`} role="status">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function ScopePill({ scope }: { scope?: string }) {
  const label = scope ?? "market";
  return <span className={`scope-pill scope-${label.replace(/_/g, "-")}`}>{label.replace(/_/g, " ")}</span>;
}

export function ProvenanceStrip({ entity, method, confidence }: { entity?: string; method?: string; confidence?: number }) {
  const percent = typeof confidence === "number" ? `${Math.round(confidence * 100)}%` : "review";
  return (
    <div className="provenance-strip">
      <i />
      <span>{entity || "Portfolio"} · {method || "market evidence"} · {percent}</span>
    </div>
  );
}

export function SignalCard({
  title,
  source,
  date,
  scope,
  body,
  provenance,
  actionLabel = "Review",
}: {
  title: ReactNode;
  source: ReactNode;
  date?: ReactNode;
  scope?: string;
  body: ReactNode;
  provenance?: { entity?: string; method?: string; confidence?: number };
  actionLabel?: string;
}) {
  return (
    <article className="signal-card">
      <div className="signal-card-main">
        <strong>{title}</strong>
        <div className="meta-row"><ScopePill scope={scope} /><span>{source}</span>{date ? <span>{date}</span> : null}</div>
        <p>{body}</p>
        {provenance ? <ProvenanceStrip {...provenance} /> : null}
      </div>
      <a className="accent-action" href="#top" onClick={(event) => event.preventDefault()}>{actionLabel}<UiIcon name="chevron" /></a>
    </article>
  );
}

export function EmptyState({ headline, body, icon = "empty" }: { headline: string; body: string; icon?: IconName }) {
  return (
    <div className="empty-state">
      <span><UiIcon name={icon} /></span>
      <strong>{headline}</strong>
      <p>{body}</p>
    </div>
  );
}

export function ListRow({ name, subtitle, action = "Review" }: { name: ReactNode; subtitle: ReactNode; action?: string }) {
  return (
    <div className="list-row">
      <UiIcon name="document" />
      <div><strong>{name}</strong><span>{subtitle}</span></div>
      <a className="accent-action" href="#top" onClick={(event) => event.preventDefault()}>{action}<UiIcon name="chevron" /></a>
    </div>
  );
}
