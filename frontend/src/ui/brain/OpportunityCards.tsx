import type { OpportunityCard } from "../../brain/types.ts";
import { setState, openDemoAction } from "../../store/store.ts";

export function OpportunityCards({ cards }: { cards: OpportunityCard[] }) {
  if (cards.length === 0) return null;
  return (
    <div className="brain-card-list">
      {cards.map((card) => (
        <button key={card.companyId} className="brain-opportunity-row" onClick={() => setState({ activeCompanyId: card.companyId })}>
          <strong>{card.companyName}</strong>
          <span>Opportunity {card.opportunityScore} · fit {card.fitScore}% · {card.city}</span>
          <em>{card.whySurfaced}</em>
          <small>{card.recommendedAction}</small>
          <span
            role="button"
            tabIndex={0}
            className="demo-action-btn"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              openDemoAction({ title: card.recommendedAction, accountName: card.companyName, action: "crm_task", evidence: card.topSignal });
            }}
          >
            Create task
          </span>
        </button>
      ))}
    </div>
  );
}
