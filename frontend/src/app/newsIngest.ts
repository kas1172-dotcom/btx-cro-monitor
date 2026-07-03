// The join that closes the loop: News -> Signal -> (Validation) -> Engine.
// Turns each market event into an engine Signal.
//   - If the LLM extracted this article (extracted-signals.json populated): honor
//     that result — valid+resolvable => a signal; rejected/unresolvable => nothing
//     (the validation gate is real).
//   - Otherwise (no LLM run): fall back to the embedded ground truth so the loop
//     still works offline.
// Only signals whose subject is in `companies` are returned (handles city scoping).
// The result is merged into the stream validation + scoring run on — so a news
// article genuinely moves a score.

import type { Company, MarketEvent } from "../engine/brain/entities.ts";
import type { Signal } from "../engine/signals/contract.ts";

export interface ExtractedRow {
  news_id: string;
  extracted: { event_type: string; entities: string[]; value?: number; confidence: number; source_quote: string } | null;
  valid: boolean;
  reason?: string;
}

export function deriveNewsSignals(companies: Company[], news: MarketEvent[], extracted: ExtractedRow[]): Signal[] {
  const byId = new Map(companies.map((c) => [c.id, c]));
  const byName = new Map(companies.map((c) => [c.name.toLowerCase(), c.id]));
  const exByNews = new Map(extracted.map((r) => [r.news_id, r]));
  const out: Signal[] = [];

  for (const n of news) {
    const ex = exByNews.get(n.id);
    let subject_id: string;
    let event_type: string;
    let value: number | undefined;
    let confidence: number;
    let source_quote: string;

    if (ex) {
      // LLM ran for this article — honor its validation result.
      if (!ex.valid || !ex.extracted) continue; // rejected by the gate
      const resolved = ex.extracted.entities.map((e) => byName.get(e.toLowerCase())).find(Boolean);
      if (!resolved) continue; // couldn't resolve the entity to a company
      subject_id = resolved;
      event_type = ex.extracted.event_type;
      value = ex.extracted.value;
      confidence = ex.extracted.confidence;
      source_quote = ex.extracted.source_quote;
    } else {
      // No LLM extraction — offline fallback to the embedded ground truth.
      subject_id = n.subject_id;
      event_type = n.event_type;
      value = n.value;
      confidence = 0.9;
      source_quote = n.source_quote;
    }

    const company = byId.get(subject_id);
    if (!company) continue;
    out.push({
      id: `news-sig-${n.id}`,
      event_type,
      entities: [company.name],
      subject_id,
      ...(value !== undefined ? { value } : {}),
      confidence,
      source_quote,
      detected_at: new Date(n.published_date).toISOString(),
    });
  }
  return out;
}
