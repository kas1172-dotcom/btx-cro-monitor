// Signal Feed — the loop, visible end to end: unstructured news on the left, the
// strict validated signal in the middle, and the score it moves on the right.
// The same signals shown here are the ones the engine actually scored (via
// deriveNewsSignals in useWorld), so this isn't a display — it's the pipeline.

import news from "../../../data/mock/news.json";
import extracted from "../../../data/mock/extracted-signals.json";
import { CONFIG } from "../../app/config.ts";
import { deriveNewsSignals } from "../../app/newsIngest.ts";
import type { ExtractedRow } from "../../app/newsIngest.ts";
import type { World } from "../../app/useWorld.ts";
import type { MarketEvent } from "../../engine/brain/entities.ts";
import { SCORE_DIMENSIONS } from "../../engine/signals/contract.ts";

const NEWS = news as unknown as MarketEvent[];
const EXTRACTED = extracted as unknown as ExtractedRow[];

function effect(eventType: string): string {
  const row = CONFIG.weights[eventType];
  if (!row) return "no scored effect";
  return SCORE_DIMENSIONS.filter((d) => row[d]).map((d) => `${d} +${row[d]}`).join(", ");
}

export function SignalFeed({ world }: { world: World }) {
  const nameOf = (id: string) => world.companies.find((c) => c.id === id)?.name ?? id;
  const exByNews = new Map(EXTRACTED.map((r) => [r.news_id, r]));
  const derived = new Map(deriveNewsSignals(world.companies, NEWS, EXTRACTED).map((s) => [s.id, s]));
  const hasLLM = EXTRACTED.length > 0;

  return (
    <div className="feed">
      <div className="feed-head">
        Signal extraction — news → validated signal → score
        {!hasLLM && <span className="muted"> · offline extraction (run “Update demo” for live LLM extraction)</span>}
      </div>
      {NEWS.map((a) => {
        const ex = exByNews.get(a.id);
        const sig = derived.get(`news-sig-${a.id}`);
        return (
          <div key={a.id} className="feed-item">
            <div className="feed-news">
              <div className="feed-src">{a.source} · {a.published_date}</div>
              <div className="feed-headline">{a.headline}</div>
              <div className="feed-body">{a.body}</div>
            </div>
            <div className="feed-arrow">→</div>
            <div className="feed-signal">
              {sig ? (
                <div className="sig-card valid">
                  <div className="sig-type">{sig.event_type}</div>
                  <div className="sig-meta">
                    conf {sig.confidence.toFixed(2)}
                    {sig.value ? ` · $${(sig.value / 1e6).toFixed(1)}M` : ""}
                    {ex ? " · LLM" : " · offline"}
                  </div>
                  <div className="sig-quote">“{sig.source_quote}”</div>
                  <div className="sig-effect">→ {nameOf(sig.subject_id)}: {effect(sig.event_type)}</div>
                </div>
              ) : ex && !ex.valid ? (
                <div className="sig-card rejected">
                  <div className="sig-type">rejected</div>
                  <div className="muted">{ex.reason ?? "failed validation"}</div>
                </div>
              ) : (
                <div className="sig-card"><div className="muted">no signal</div></div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
