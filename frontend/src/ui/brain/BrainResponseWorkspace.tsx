import { lazy, Suspense } from "react";
import type { BrainResponse } from "../../brain/types.ts";
import { TAB_LABELS } from "../../app/surfaces.ts";
import type { World } from "../../app/useWorld.ts";
import { OpportunityCards } from "./OpportunityCards.tsx";
import { SignalFeed } from "../feed/SignalFeed.tsx";
import { AskBrainBar } from "./AskBrainBar.tsx";
import { openDeliverableWizard, openDemoAction, setState } from "../../store/store.ts";

const ProspectMap = lazy(() => import("../map/ProspectMap.tsx").then((module) => ({ default: module.ProspectMap })));

export function BrainResponseWorkspace({ response, world }: { response: BrainResponse; world: World }) {
  const primaryCompanyId = response.relatedOpportunities[0]?.companyId ?? world.prospects[0]?.company.id ?? world.companies[0]?.id;
  function confirmAction(action: string): void {
    const lower = action.toLowerCase();
    const namedCompany = world.companies.find((company) => lower.includes(company.name.toLowerCase()));
    const accountId = namedCompany?.id ?? primaryCompanyId;
    if (lower.includes("open prospect")) {
      setState({ activeTab: "prospecting", brainResponse: null, activeCompanyId: accountId });
      return;
    }
    if (lower.includes("open") && accountId) {
      setState({ activeTab: "accounts", brainResponse: null, activeCompanyId: accountId });
      return;
    }
    if (lower.includes("deliverable") || lower.includes("brief") || lower.includes("pitch")) {
      openDeliverableWizard({ accountId, startStep: "pick" });
      return;
    }
    openDemoAction({ title: action, action: "crm_task", accountId, accountName: world.companies.find((company) => company.id === accountId)?.name });
  }

  return (
    <div className="brain-response">
      <div className="brain-response-head">
        <span>{response.activatedTabs.map((area) => TAB_LABELS[area]).join(" + ")}</span>
        <h1>{response.directAnswer}</h1>
      </div>
      {response.recommendedActions.length > 0 && (
        <section className="brain-chat-actions">
          <h2>Suggested next steps</h2>
          <div>
            {response.recommendedActions.map((action) => (
              <button key={action} type="button" onClick={() => confirmAction(action)}>{action}</button>
            ))}
          </div>
        </section>
      )}
      <section>
        <h2>Why This Matters</h2>
        <p>{response.whyThisMatters}</p>
      </section>
      {response.focusView === "map" && (
        <div className="brain-map-wrap">
          <Suspense fallback={<div className="loading">loading map…</div>}>
            <ProspectMap world={world} />
          </Suspense>
        </div>
      )}
      {response.focusView === "signals" && <div className="brain-embedded-view"><SignalFeed world={world} /></div>}
      {response.focusView === "brief" && (
        <div className="weekly-brief-grid">
          <div><span>Opportunity</span><strong>{response.relatedOpportunities[0]?.companyName ?? "None"}</strong></div>
          <div><span>Risk</span><strong>{response.savedNote.entities[0] ?? "Review accounts"}</strong></div>
          <div><span>Confidence</span><strong>{response.confidence}</strong></div>
        </div>
      )}
      <OpportunityCards cards={response.relatedOpportunities} />
      <section className="brain-follow-up">
        <h2>Continue the conversation</h2>
        <AskBrainBar key={response.conversation?.map((message) => message.content).join("|") ?? response.question} world={world} large initialMessages={response.conversation ?? []} />
      </section>
    </div>
  );
}
