import type { BrainResponse } from "../../brain/types.ts";
import { BRAIN_AREA_LABELS } from "../../brain/types.ts";
import { openDemoAction, setState } from "../../store/store.ts";

export function RightContextPanel({ response }: { response: BrainResponse | null }) {
  if (!response) return null;
  return (
    <aside className="right-context">
      <div className="right-context-head">
        <span />
        <button className="right-context-close" onClick={() => setState({ brainResponse: null })} aria-label="Close context panel">×</button>
      </div>
      <section>
        <h3>Activated Brain Areas</h3>
        {response.activatedBrainAreas.map((area) => <p key={area}>{BRAIN_AREA_LABELS[area]}</p>)}
      </section>
      <section>
        <h3>Context Used</h3>
        {response.contextUsed.map((entry) => <p key={entry.source}><strong>{entry.source}</strong><br />{entry.reason}</p>)}
      </section>
      <section>
        <h3>Saved to Brain</h3>
        <p><strong>{response.savedNote.title}</strong><br />{response.savedNote.summary}</p>
      </section>
      <section>
        <h3>Recommended Actions</h3>
        {response.recommendedActions.map((action) => (
          <button key={action} onClick={() => openDemoAction({ title: action, action: "crm_task" })}>{action}</button>
        ))}
      </section>
      <section>
        <h3>Suggested Next Questions</h3>
        {response.suggestedNextQuestions.map((q) => <p key={q}>{q}</p>)}
      </section>
      <section>
        <h3>Confidence</h3>
        <p>{response.confidence}</p>
      </section>
    </aside>
  );
}
