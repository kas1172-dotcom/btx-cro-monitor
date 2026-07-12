import { lazy, Suspense } from "react";
import type { BrainResponse } from "../../brain/types.ts";
import { BRAIN_AREA_LABELS } from "../../brain/types.ts";
import type { World } from "../../app/useWorld.ts";
import { OpportunityCards } from "./OpportunityCards.tsx";
import { SignalFeed } from "../feed/SignalFeed.tsx";

const ProspectMap = lazy(() => import("../map/ProspectMap.tsx").then((module) => ({ default: module.ProspectMap })));

export function BrainResponseWorkspace({ response, world }: { response: BrainResponse; world: World }) {
  return (
    <div className="brain-response">
      <div className="brain-response-head">
        <span>{response.activatedBrainAreas.map((area) => BRAIN_AREA_LABELS[area]).join(" + ")}</span>
        <h1>{response.directAnswer}</h1>
      </div>
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
    </div>
  );
}
