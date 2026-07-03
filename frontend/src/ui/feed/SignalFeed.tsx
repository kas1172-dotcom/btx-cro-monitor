// Signal Feed — shows the extraction layer end to end: unstructured news on the
// left, the strict validated signal the engine pulled from it on the right.
// Reads the frozen artifacts (news + the LLM-extracted signals baked in CI). If
// extraction hasn't run yet, the articles still show with "awaiting extraction".

import news from "../../../data/mock/news.json";
import extracted from "../../../data/mock/extracted-signals.json";

interface Article { id: string; source: string; published_date: string; headline: string; body: string }
interface ExtractedRow {
  news_id: string;
  headline: string;
  extracted: { event_type: string; entities: string[]; value?: number; confidence: number; source_quote: string } | null;
  valid: boolean;
  reason: string;
}

const NEWS = news as unknown as Article[];
const ROWS = extracted as unknown as ExtractedRow[];
const byNews = new Map(ROWS.map((r) => [r.news_id, r]));

export function SignalFeed() {
  return (
    <div className="feed">
      <div className="feed-head">
        Signal extraction — unstructured news → validated signals
        {ROWS.length === 0 && <span className="muted"> · extraction not run yet (run the “Bake LLM artifacts” workflow)</span>}
      </div>
      {NEWS.map((a) => {
        const row = byNews.get(a.id);
        return (
          <div key={a.id} className="feed-item">
            <div className="feed-news">
              <div className="feed-src">{a.source} · {a.published_date}</div>
              <div className="feed-headline">{a.headline}</div>
              <div className="feed-body">{a.body}</div>
            </div>
            <div className="feed-arrow">→</div>
            <div className="feed-signal">
              {!row ? (
                <div className="muted">awaiting extraction</div>
              ) : row.valid && row.extracted ? (
                <div className="sig-card valid">
                  <div className="sig-type">{row.extracted.event_type}</div>
                  <div className="sig-meta">
                    conf {row.extracted.confidence.toFixed(2)}
                    {row.extracted.value ? ` · $${(row.extracted.value / 1e6).toFixed(1)}M` : ""}
                  </div>
                  <div className="sig-entities">{row.extracted.entities.join(", ")}</div>
                  <div className="sig-quote">“{row.extracted.source_quote}”</div>
                </div>
              ) : (
                <div className="sig-card rejected">
                  <div className="sig-type">rejected</div>
                  <div className="muted">{row.reason}{row.extracted ? ` (${row.extracted.event_type})` : ""}</div>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
