// Entity shapes for the brain. Single source of truth for entity types.
// INDUSTRY-FREE: "supplier"/"competitor"/"target" are generic business
// relationships; capability tags are generic strings. Which concrete company is
// "self", which city it sits in, and what "AS9100" means all live in the data.

/** How an entity relates to the client whose world this brain models. */
export type Relationship = "self" | "customer" | "supplier" | "competitor" | "target";

export interface Location {
  city: string;
  lat: number;
  lon: number;
}

export interface Company {
  id: string;
  name: string;
  relationship: Relationship;
  location: Location;
  /** Capability tags this company needs from a supplier — matched for fit. */
  needs: string[];
}

export interface Contact {
  id: string;
  company_id: string;
  name: string;
  title: string;
}

export interface Facility {
  id: string;
  company_id: string;
  city: string;
  lat: number;
  lon: number;
  kind: "HQ" | "plant";
}

export type OppStage = "prospecting" | "qualified" | "proposal" | "won" | "lost";

export interface Opportunity {
  id: string;
  company_id: string;
  name: string;
  value: number;
  stage: OppStage;
  /** ISO date (YYYY-MM-DD). */
  close_date: string;
}

/** A news article + its ground-truth signal. The extraction layer re-derives the
 *  signal from headline/body via the LLM; the embedded fields are the offline
 *  fallback so the news→signal→score loop works without a key. */
export interface MarketEvent {
  id: string;
  source: string;
  published_date: string;
  headline: string;
  body: string;
  subject_id: string;
  event_type: string;
  value?: number;
  source_quote: string;
}
