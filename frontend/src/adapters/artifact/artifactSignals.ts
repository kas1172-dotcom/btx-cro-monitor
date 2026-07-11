import type { Company } from "../../engine/brain/entities.ts";
import { PORTFOLIO_SIGNAL_SUBJECT_ID, type Signal } from "../../engine/signals/contract.ts";

interface ArtifactMeta {
  run_id?: unknown;
  run_at?: unknown;
  items_collected?: unknown;
  items_after_prefilter?: unknown;
  items_analyzed?: unknown;
  estimated_cost_usd?: unknown;
  engine_version?: unknown;
}

interface ArtifactEdition {
  relevance_score?: unknown;
  so_what?: unknown;
  now_what?: unknown;
  categories?: unknown;
}

interface ArtifactFact {
  label?: unknown;
  value?: unknown;
  kind?: unknown;
  number?: unknown;
  url?: unknown;
}

interface ArtifactItem {
  item_id?: unknown;
  title?: unknown;
  raw_title?: unknown;
  url?: unknown;
  source_id?: unknown;
  published_at?: unknown;
  collected_at?: unknown;
  per_edition?: { bd?: ArtifactEdition; exec?: ArtifactEdition };
  dollar_amount?: unknown;
  affected_population?: unknown;
  action_deadline?: unknown;
  confidence_note?: unknown;
  unverified_claims?: unknown;
  deep_analysis?: unknown;
  also_covered_by?: unknown;
  entities?: unknown;
  enrichment?: { facts?: ArtifactFact[]; queried_entities?: unknown };
  related?: unknown;
  importance_score?: unknown;
}

export interface ArtifactRunOutput {
  meta?: ArtifactMeta;
  items?: ArtifactItem[];
  whats_new?: unknown;
  editorial?: unknown;
  site_config?: unknown;
  source_health?: unknown;
  entity_index?: unknown;
}

export interface ArtifactArchive {
  runs?: Array<{ run_id?: unknown; run_at?: unknown; items?: ArtifactItem[] }>;
  pinned?: unknown;
}

export interface ArtifactMappingResult {
  signals: Signal[];
  runAt: string;
  latestPublishedAt: string | null;
  sourceCount: number;
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[$,]/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function categories(item: ArtifactItem): string[] {
  const raw = item.per_edition?.bd?.categories;
  return Array.isArray(raw) ? raw.filter((entry): entry is string => typeof entry === "string") : [];
}

function entityNames(item: ArtifactItem): string[] {
  const raw = item.entities;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entity) => text((entity as { name?: unknown }).name))
    .filter(Boolean);
}

function deepText(value: unknown): string {
  const sections = (value as { sections?: unknown } | null)?.sections;
  if (!sections || typeof sections !== "object") return "";
  const parts: string[] = [];
  for (const entry of Object.values(sections as Record<string, unknown>)) {
    if (typeof entry === "string") parts.push(entry);
    else if (Array.isArray(entry)) parts.push(...entry.filter((item): item is string => typeof item === "string"));
  }
  return parts.join(" ");
}

function artifactText(item: ArtifactItem): string {
  return [
    item.title,
    item.raw_title,
    item.per_edition?.bd?.so_what,
    item.per_edition?.bd?.now_what,
    item.per_edition?.exec?.so_what,
    item.per_edition?.exec?.now_what,
    item.confidence_note,
    deepText(item.deep_analysis),
    ...entityNames(item),
    ...categories(item),
  ].map((value) => text(value)).filter(Boolean).join(" ");
}

function eventType(item: ArtifactItem): string {
  const cats = categories(item).join(" ").toLowerCase();
  const body = artifactText(item).toLowerCase();
  if (cats.includes("contract award") || cats.includes("subcontracting")) return "government_contract_award";
  if (cats.includes("supply chain") || body.includes("supply-chain") || body.includes("supply chain")) return "supplier_delay";
  if (body.includes("airworthiness") || body.includes("regulatory") || body.includes("compliance") || body.includes("itar") || body.includes("cui")) return "regulatory_change";
  if (body.includes("china") || body.includes("competitive")) return "competitor_expansion";
  if (body.includes("demand") || body.includes("rfq") || body.includes("rfp")) return "demand_spike";
  return "regulatory_change";
}

function stableScore(seed: string): number {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash / 0xffffffff;
}

export const ARTIFACT_ACCOUNT_FIT_THRESHOLD = 20;

function companyRealFit(company: Company, item: ArtifactItem): number {
  const body = artifactText(item).toLowerCase();
  let score = 0;
  if (body.includes(company.name.toLowerCase())) score += 200;
  for (const need of company.needs) {
    if (body.includes(need.toLowerCase())) score += 20;
  }
  return score;
}

function companySortFit(company: Company, item: ArtifactItem, type: string): number {
  let score = companyRealFit(company, item);
  if (["government_contract_award", "demand_spike", "competitor_expansion"].includes(type) && company.relationship === "target") score += 25;
  if (["supplier_delay", "regulatory_change"].includes(type) && company.relationship === "customer") score += 20;
  if (company.account_status === "active_pipeline" || company.account_status === "target_prospect") score += 8;
  return score + stableScore(`${text(item.item_id)}:${company.id}`);
}

function subjectFor(item: ArtifactItem, companies: Company[], type: string): Company | undefined {
  const ranked = [...companies]
    .map((company) => ({ company, realFit: companyRealFit(company, item), sortFit: companySortFit(company, item, type) }))
    .sort((a, b) => b.sortFit - a.sortFit || a.company.id.localeCompare(b.company.id));
  const best = ranked[0];
  return best && best.realFit >= ARTIFACT_ACCOUNT_FIT_THRESHOLD ? best.company : undefined;
}

function confidenceFromScore(score: number): number {
  return Math.max(0.72, Math.min(0.98, score / 100));
}

function dollars(item: ArtifactItem): number[] {
  const out: number[] = [];
  const direct = numberValue(item.dollar_amount);
  if (direct !== undefined) out.push(direct);
  for (const fact of item.enrichment?.facts ?? []) {
    const value = numberValue(fact.number ?? fact.value);
    if (value !== undefined && (fact.kind === "money" || text(fact.label).toLowerCase().includes("award"))) out.push(value);
  }
  return [...new Set(out)];
}

function sourceQuote(item: ArtifactItem): string {
  const soWhat = text(item.per_edition?.bd?.so_what) || text(item.per_edition?.exec?.so_what);
  const nowWhat = text(item.per_edition?.bd?.now_what);
  const base = soWhat || text(item.title, "Monitor-engine artifact item");
  return `${base}${nowWhat ? ` Action: ${nowWhat}` : ""}`;
}

export function assertArtifactRunOutput(value: unknown): asserts value is ArtifactRunOutput {
  const payload = value as ArtifactRunOutput;
  if (!payload || typeof payload !== "object") throw new Error("artifact run_output is not an object");
  if (!payload.meta || typeof payload.meta !== "object") throw new Error("artifact run_output missing meta");
  if (!Array.isArray(payload.items)) throw new Error("artifact run_output missing items");
  if (!text(payload.meta.run_at)) throw new Error("artifact run_output missing meta.run_at");
}

export function buildArtifactSignals(runOutput: unknown, companies: Company[]): ArtifactMappingResult {
  assertArtifactRunOutput(runOutput);
  const runAt = text(runOutput.meta?.run_at);
  const signals: Signal[] = [];

  for (const item of runOutput.items ?? []) {
    const itemId = text(item.item_id);
    const headline = text(item.raw_title) || text(item.title);
    const sourceName = text(item.source_id, "Monitor engine artifact");
    const publishedAt = text(item.published_at) || text(item.collected_at) || runAt;
    if (!itemId || !headline || !publishedAt) continue;

    const type = eventType(item);
    const subject = subjectFor(item, companies, type);
    const linked = Boolean(subject);

    const score = numberValue(item.per_edition?.bd?.relevance_score) ?? numberValue(item.importance_score) ?? 70;
    const figures = dollars(item);
    const affectedEntities = entityNames(item);
    const analysisText = [
      text(item.per_edition?.bd?.so_what),
      text(item.per_edition?.bd?.now_what),
      deepText(item.deep_analysis),
    ].filter(Boolean).join(" ");

    signals.push({
      id: `artifact-sig-${itemId}`,
      event_type: type,
      entities: affectedEntities.length ? affectedEntities : subject ? [subject.name] : [sourceName],
      subject_id: subject?.id ?? PORTFOLIO_SIGNAL_SUBJECT_ID,
      scope: linked ? "account" : "unlinked",
      ...(subject?.account_status ? { account_status: subject.account_status } : {}),
      ...(subject?.business_motion ? { business_motion: subject.business_motion } : {}),
      ...(figures[0] !== undefined ? { value: figures[0] } : {}),
      confidence: confidenceFromScore(score),
      source_quote: sourceQuote(item),
      ...(text(item.url) ? { source_url: text(item.url) } : {}),
      detected_at: new Date(publishedAt).toISOString(),
      artifact: {
        item_id: itemId,
        headline,
        source_name: sourceName,
        source_date: publishedAt,
        run_at: runAt,
        signal_type: type,
        relevance_score: score,
        analysis_text: analysisText,
        ...(text(item.url) ? { source_url: text(item.url) } : {}),
        dollar_figures: figures,
        affected_entities: affectedEntities,
        provenance: {
          meta: runOutput.meta,
          item,
        },
      },
    });
  }

  const latestPublishedAt = signals.map((signal) => signal.detected_at).sort().at(-1) ?? null;
  const sourceCount = new Set(signals.map((signal) => signal.artifact?.source_name).filter(Boolean)).size;
  return { signals, runAt, latestPublishedAt, sourceCount };
}

export function artifactFigureText(signals: Signal[]): string {
  return signals
    .flatMap((signal) => signal.artifact?.dollar_figures ?? [])
    .map((figure) => String(figure))
    .join(" ");
}
