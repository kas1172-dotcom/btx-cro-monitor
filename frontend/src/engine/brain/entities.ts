// Entity shapes for the brain. Single source of truth for entity types.
// INDUSTRY-FREE: "supplier"/"competitor"/"target" are generic business
// relationships; capability tags are generic strings. Which concrete company is
// "self", which city it sits in, and what "AS9100" means all live in the data.

/** How an entity relates to the client whose world this brain models. */
export type Relationship = "self" | "customer" | "supplier" | "competitor" | "target";

export type AccountStatus =
  | "current_customer"
  | "active_pipeline"
  | "past_customer"
  | "target_prospect"
  | "new_logo"
  | "partner"
  | "competitor";

export type BusinessMotion =
  | "manage_current_business"
  | "grow_existing_business"
  | "prospect_new_business"
  | "reduce_risk";

export interface Location {
  city: string;
  lat: number;
  lon: number;
  address?: string;
  state?: string;
  postal_code?: string;
  country?: string;
}

export interface Company {
  id: string;
  name: string;
  relationship: Relationship;
  account_status?: AccountStatus;
  business_motion?: BusinessMotion;
  location: Location;
  website_url?: string;
  linkedin_url?: string;
  source_url?: string;
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
  address?: string;
  state?: string;
  postal_code?: string;
  country?: string;
  lat: number;
  lon: number;
  kind: "HQ" | "plant";
  source_url?: string;
}

export type OppStage = "prospecting" | "qualified" | "proposal" | "won" | "lost";

export interface Opportunity {
  id: string;
  company_id: string;
  name: string;
  account_status?: AccountStatus;
  business_motion?: BusinessMotion;
  value: number;
  stage: OppStage;
  source_url?: string;
  contract_url?: string;
  document_url?: string;
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
  account_status?: AccountStatus;
  business_motion?: BusinessMotion;
  event_type: string;
  value?: number;
  source_quote: string;
  source_url?: string;
  document_url?: string;
}
