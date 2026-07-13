import { useState } from "react";
import { signalSourceName } from "../../app/signalProvenance.ts";
import type { World } from "../../app/useWorld.ts";
import { formatAddress } from "../../app/format.ts";
import { EmptyState } from "../primitives.tsx";
import type { ProspectRankRow } from "./prospectingModel.ts";

function money(value: number): string {
  return value >= 1_000_000 ? `$${(value / 1_000_000).toFixed(1)}M` : `$${Math.round(value / 1000)}k`;
}

export function ProspectDetail({
  world,
  row,
  hasGenerated,
  onGenerate,
  onNavigateDeliverables,
}: {
  world: World;
  row: ProspectRankRow | undefined;
  hasGenerated: boolean;
  onGenerate(): void;
  onNavigateDeliverables(): void;
}) {
  const [showWhy, setShowWhy] = useState(false);
  const [showMore, setShowMore] = useState(false);

  if (!row) {
    return (
      <section className="surface-panel prospect-detail">
        <EmptyState headline="No prospect selected" body="Choose a ranked prospect to inspect the shallow detail view." icon="empty" />
      </section>
    );
  }

  const company = row.company;
  const contacts = world.contacts.filter((contact) => contact.company_id === company.id);
  const deals = world.opportunities.filter((opportunity) => opportunity.company_id === company.id);
  const facilities = world.facilities.filter((facility) => facility.company_id === company.id);

  return (
    <section className="surface-panel prospect-detail" aria-labelledby="prospect-detail-title">
      <div className="prospect-detail-head">
        <div>
          <span>Rank #{row.rank}</span>
          <h2 id="prospect-detail-title">{company.name}</h2>
          <p>{formatAddress(company.location) ?? company.location.city}</p>
        </div>
        <button type="button" className="accent-action-button" onClick={hasGenerated ? onNavigateDeliverables : onGenerate}>
          {hasGenerated ? "Navigate to Deliverables tab" : "Generate"}
        </button>
      </div>

      <div className="prospect-primary-fields">
        <div>
          <span>What changed</span>
          <strong>{row.whatChanged}</strong>
        </div>
        <div>
          <span>Recommended action</span>
          <strong>{row.recommendedAction}</strong>
        </div>
        <div>
          <span>Confidence</span>
          <strong>{Math.round(row.confidence * 100)}%</strong>
        </div>
      </div>

      <div className="prospect-detail-toggles">
        <button type="button" onClick={() => setShowWhy((value) => !value)} aria-expanded={showWhy}>
          Why this ranks here
        </button>
        <button type="button" onClick={() => setShowMore((value) => !value)} aria-expanded={showMore}>
          See more
        </button>
      </div>

      {showWhy && (
        <div className="prospect-why" data-prospect-expanded="why">
          <p>{row.whyRanked.summary}</p>
          <p>{row.whyRanked.scoreLine}</p>
          <p>{row.whyRanked.fitLine}</p>
          <p>{row.whyRanked.contextLine}</p>
          <p>{row.whyRanked.businessContextLine}</p>
          <p>
            Evidence: {row.relationship?.evidence ?? row.topSignal?.source_quote ?? "No account-specific relationship record yet."}
          </p>
          <p>
            Confidence: {Math.round(row.confidence * 100)}%
            {row.relationship ? ` · ${row.relationship.match_method}` : ""}
            {row.topSignal ? ` · ${signalSourceName(row.topSignal)}` : ""}
          </p>
        </div>
      )}

      {showMore && (
        <div className="prospect-more" data-prospect-expanded="more">
          <section>
            <h3>Contacts</h3>
            {contacts.slice(0, 4).map((contact) => <p key={contact.id}><strong>{contact.name}</strong> · {contact.title}</p>)}
            {contacts.length === 0 && <p className="muted">No contacts on file.</p>}
          </section>
          <section>
            <h3>Deals</h3>
            {deals.slice(0, 4).map((deal) => <p key={deal.id}><strong>{deal.name}</strong> · {deal.stage} · {money(deal.value)}</p>)}
            {deals.length === 0 && <p className="muted">No deals on file.</p>}
          </section>
          <section>
            <h3>Facilities</h3>
            <p>{facilities.length} facility record{facilities.length === 1 ? "" : "s"} available.</p>
          </section>
        </div>
      )}
    </section>
  );
}
