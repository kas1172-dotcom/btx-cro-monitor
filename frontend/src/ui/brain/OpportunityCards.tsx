import type { OpportunityCard } from "../../brain/types.ts";
import { setState, openDemoAction } from "../../store/store.ts";

export function OpportunityCards({ cards }: { cards: OpportunityCard[] }) {
  if (cards.length === 0) return null;
  return (
    <div className="brain-card-list">
      {cards.map((card) => (
        <div
          key={card.companyId}
          className="brain-opportunity-row"
          role="button"
          tabIndex={0}
          onClick={() => setState({ activeCompanyId: card.companyId })}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setState({ activeCompanyId: card.companyId });
            }
          }}
        >
          <strong>{card.companyName}</strong>
          <span>Opportunity {card.opportunityScore} · {card.qualificationLabel ?? card.confidence} · {card.city}</span>
          {card.qualificationGaps?.length ? <span>Missing: {card.qualificationGaps.join(", ")}</span> : null}
          <em>{card.whySurfaced}</em>
          <small>{card.recommendedAction}</small>
          <button
            type="button"
            className="demo-action-btn"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              openDemoAction({
                title: card.recommendedAction,
                accountName: card.companyName,
                accountId: card.companyId,
                action: "crm_task",
                evidence: card.topSignal,
                workItemType: "account_action",
              });
            }}
          >
            Create task
          </button>
        </div>
      ))}
    </div>
  );
}
