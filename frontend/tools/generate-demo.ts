// Deterministic BTX demo-world generator. Run offline and commit the output.
// Same seed + AS_OF produces byte-identical JSON. Demo data lives here, never
// inside React components or the scoring engine.
//
//   npm run gen

import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SEED = 0x42784358;
const AS_OF = "2026-07-03";
const AS_OF_MS = Date.parse(`${AS_OF}T12:00:00Z`);
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "../data/demo/btx");

type Relationship = "self" | "customer" | "target";
type AccountStatus = "current_customer" | "active_pipeline" | "past_customer" | "target_prospect" | "new_logo";
type BusinessMotion = "manage_current_business" | "grow_existing_business" | "prospect_new_business" | "reduce_risk";
type Stage = "prospecting" | "qualified" | "proposal" | "won" | "lost";

interface AccountSeed {
  id: string;
  name: string;
  relationship: Relationship;
  account_status: AccountStatus;
  business_motion: BusinessMotion;
  city: string;
  state: string;
  postal_code: string;
  lat: number;
  lon: number;
  address: string;
  needs: string[];
  tier: "Strategic" | "Priority" | "Core" | "Watch";
}

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rnd = mulberry32(SEED);
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)];
const int = (min: number, max: number): number => min + Math.floor(rnd() * (max - min + 1));
const round2 = (n: number): number => Math.round(n * 100) / 100;
const round4 = (n: number): number => Math.round(n * 10000) / 10000;
const isoDaysAgo = (days: number): string => new Date(AS_OF_MS - days * 86400000).toISOString();
const monthKey = (offsetFromAsOf: number): string => {
  const d = new Date(Date.UTC(2026, 6 - offsetFromAsOf, 1));
  return d.toISOString().slice(0, 7);
};
const provenance = (source_name: string) => ({ source_type: "demo", source_name, source_mode: "static_snapshot" });
const demoUrl = (path: string): string => `https://demo.btx.example/${path}`;
const fictionalDomain = (slug: string): string => `${slug}.example`;
const emailLocalPart = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "");
const contactEmail = (name: string, companySlug: string): string => `${emailLocalPart(name)}@${companySlug}.example.com`;

const ACCOUNTS: AccountSeed[] = [
  { id: "btx-precision", name: "BTX Precision", relationship: "self", account_status: "current_customer", business_motion: "manage_current_business", city: "Dallas", state: "TX", postal_code: "75201", lat: 32.7767, lon: -96.797, address: "1200 Precision Way", needs: ["5-axis CNC", "precision machining", "build-to-print", "AS9100", "ITAR", "titanium", "aluminum"], tier: "Strategic" },
  { id: "lonestar-aero-systems", name: "Lonestar Aero Systems", relationship: "customer", account_status: "current_customer", business_motion: "grow_existing_business", city: "Austin", state: "TX", postal_code: "78758", lat: 30.4014, lon: -97.7132, address: "9401 Metric Blvd", needs: ["5-axis CNC", "AS9100", "aluminum", "assembly"], tier: "Strategic" },
  { id: "trinity-defense-components", name: "Trinity Defense Components", relationship: "customer", account_status: "current_customer", business_motion: "manage_current_business", city: "Dallas", state: "TX", postal_code: "75247", lat: 32.8141, lon: -96.8738, address: "2210 Commonwealth Dr", needs: ["ITAR", "precision machining", "titanium"], tier: "Strategic" },
  { id: "pecan-valley-machining", name: "Pecan Valley Machining", relationship: "customer", account_status: "current_customer", business_motion: "grow_existing_business", city: "San Antonio", state: "TX", postal_code: "78219", lat: 29.4442, lon: -98.3831, address: "4810 Industry Park Dr", needs: ["build-to-print", "5-axis CNC", "aluminum"], tier: "Priority" },
  { id: "clearfork-turbine-works", name: "Clearfork Turbine Works", relationship: "customer", account_status: "current_customer", business_motion: "reduce_risk", city: "Fort Worth", state: "TX", postal_code: "76106", lat: 32.8031, lon: -97.3539, address: "2650 Railhead Rd", needs: ["NADCAP", "titanium", "precision machining"], tier: "Priority" },
  { id: "bluebonnet-avionics", name: "Bluebonnet Avionics", relationship: "customer", account_status: "active_pipeline", business_motion: "grow_existing_business", city: "Austin", state: "TX", postal_code: "78744", lat: 30.2016, lon: -97.7079, address: "6300 Burleson Rd", needs: ["assembly", "AS9100", "sheet metal"], tier: "Core" },
  { id: "gulf-coast-propulsion", name: "Gulf Coast Propulsion", relationship: "customer", account_status: "current_customer", business_motion: "manage_current_business", city: "Houston", state: "TX", postal_code: "77034", lat: 29.6175, lon: -95.2048, address: "9100 Aerospace Ave", needs: ["precision machining", "ITAR", "aluminum"], tier: "Strategic" },
  { id: "brazos-precision-castings", name: "Brazos Precision Castings", relationship: "customer", account_status: "current_customer", business_motion: "reduce_risk", city: "Waco", state: "TX", postal_code: "76712", lat: 31.5132, lon: -97.2104, address: "1501 Foundry Loop", needs: ["AS9100", "titanium", "NADCAP"], tier: "Core" },
  { id: "red-river-assemblies", name: "Red River Assemblies", relationship: "customer", account_status: "current_customer", business_motion: "grow_existing_business", city: "Dallas", state: "TX", postal_code: "75212", lat: 32.7812, lon: -96.8886, address: "7700 Singleton Blvd", needs: ["assembly", "sheet metal", "build-to-print"], tier: "Core" },
  { id: "high-plains-actuation", name: "High Plains Actuation", relationship: "customer", account_status: "past_customer", business_motion: "manage_current_business", city: "Amarillo", state: "TX", postal_code: "79111", lat: 35.2233, lon: -101.7059, address: "3400 Tradewind St", needs: ["precision machining", "aluminum", "5-axis CNC"], tier: "Watch" },
  { id: "alamo-composite-tooling", name: "Alamo Composite Tooling", relationship: "customer", account_status: "active_pipeline", business_motion: "grow_existing_business", city: "San Antonio", state: "TX", postal_code: "78216", lat: 29.5331, lon: -98.4698, address: "11600 Huebner Rd", needs: ["tooling", "AS9100", "build-to-print"], tier: "Priority" },
  { id: "hill-country-aerostructures", name: "Hill Country Aerostructures", relationship: "target", account_status: "target_prospect", business_motion: "prospect_new_business", city: "Austin", state: "TX", postal_code: "78728", lat: 30.4444, lon: -97.6816, address: "15820 Bratton Ln", needs: ["5-axis CNC", "ITAR", "aluminum"], tier: "Strategic" },
  { id: "caprock-guidance-systems", name: "Caprock Guidance Systems", relationship: "target", account_status: "target_prospect", business_motion: "prospect_new_business", city: "Lubbock", state: "TX", postal_code: "79404", lat: 33.563, lon: -101.8377, address: "2801 Slaton Rd", needs: ["precision machining", "electronics assembly", "AS9100"], tier: "Priority" },
  { id: "cypress-creek-fabrication", name: "Cypress Creek Fabrication", relationship: "target", account_status: "new_logo", business_motion: "prospect_new_business", city: "Houston", state: "TX", postal_code: "77041", lat: 29.8617, lon: -95.5711, address: "10800 Tanner Rd", needs: ["sheet metal", "assembly", "aluminum"], tier: "Core" },
  { id: "mesquite-defense-manufacturing", name: "Mesquite Defense Manufacturing", relationship: "target", account_status: "target_prospect", business_motion: "prospect_new_business", city: "Dallas", state: "TX", postal_code: "75150", lat: 32.8151, lon: -96.6336, address: "3200 Skyline Dr", needs: ["ITAR", "build-to-print", "5-axis CNC"], tier: "Strategic" },
  { id: "violet-crown-micro-precision", name: "Violet Crown Micro Precision", relationship: "target", account_status: "new_logo", business_motion: "prospect_new_business", city: "Austin", state: "TX", postal_code: "78741", lat: 30.2317, lon: -97.7137, address: "2400 Montopolis Dr", needs: ["precision machining", "titanium", "NADCAP"], tier: "Priority" },
  { id: "ranger-landing-gear", name: "Ranger Landing Gear", relationship: "target", account_status: "target_prospect", business_motion: "prospect_new_business", city: "Fort Worth", state: "TX", postal_code: "76177", lat: 32.9811, lon: -97.3193, address: "9700 North Fwy", needs: ["5-axis CNC", "titanium", "AS9100"], tier: "Strategic" },
  { id: "live-oak-sensor-housings", name: "Live Oak Sensor Housings", relationship: "target", account_status: "new_logo", business_motion: "prospect_new_business", city: "San Marcos", state: "TX", postal_code: "78666", lat: 29.8833, lon: -97.9414, address: "1550 Clovis Barker Rd", needs: ["aluminum", "precision machining", "build-to-print"], tier: "Core" },
  { id: "blackland-hydraulics", name: "Blackland Hydraulics", relationship: "target", account_status: "target_prospect", business_motion: "prospect_new_business", city: "Waco", state: "TX", postal_code: "76705", lat: 31.6057, lon: -97.1147, address: "7300 Imperial Dr", needs: ["hydraulic blocks", "5-axis CNC", "AS9100"], tier: "Priority" },
  { id: "mesa-verde-aerosystems", name: "Mesa Verde Aerosystems", relationship: "target", account_status: "target_prospect", business_motion: "prospect_new_business", city: "Phoenix", state: "AZ", postal_code: "85034", lat: 33.4301, lon: -112.0115, address: "3801 E Air Lane", needs: ["titanium", "precision machining", "ITAR"], tier: "Strategic" },
  { id: "rocky-mountain-flight-controls", name: "Rocky Mountain Flight Controls", relationship: "target", account_status: "new_logo", business_motion: "prospect_new_business", city: "Denver", state: "CO", postal_code: "80216", lat: 39.7847, lon: -104.9717, address: "4600 York St", needs: ["assembly", "AS9100", "aluminum"], tier: "Priority" },
  { id: "carolina-nacelle-works", name: "Carolina Nacelle Works", relationship: "target", account_status: "target_prospect", business_motion: "prospect_new_business", city: "Greenville", state: "SC", postal_code: "29605", lat: 34.8047, lon: -82.385, address: "2100 Perimeter Rd", needs: ["sheet metal", "build-to-print", "NADCAP"], tier: "Core" },
  { id: "chesapeake-rotor-systems", name: "Chesapeake Rotor Systems", relationship: "target", account_status: "target_prospect", business_motion: "prospect_new_business", city: "Baltimore", state: "MD", postal_code: "21224", lat: 39.2787, lon: -76.5488, address: "5900 Holabird Ave", needs: ["5-axis CNC", "titanium", "ITAR"], tier: "Strategic" },
  { id: "great-lakes-engine-cases", name: "Great Lakes Engine Cases", relationship: "target", account_status: "new_logo", business_motion: "prospect_new_business", city: "Cincinnati", state: "OH", postal_code: "45246", lat: 39.287, lon: -84.4696, address: "10100 Alliance Rd", needs: ["precision machining", "aluminum", "AS9100"], tier: "Priority" },
  { id: "cascade-actuator-products", name: "Cascade Actuator Products", relationship: "target", account_status: "target_prospect", business_motion: "prospect_new_business", city: "Seattle", state: "WA", postal_code: "98108", lat: 47.5447, lon: -122.3131, address: "7200 East Marginal Way", needs: ["assembly", "5-axis CNC", "build-to-print"], tier: "Core" },
  { id: "desert-sky-machining", name: "Desert Sky Machining", relationship: "target", account_status: "new_logo", business_motion: "prospect_new_business", city: "Tucson", state: "AZ", postal_code: "85756", lat: 32.118, lon: -110.9363, address: "6600 S Country Club Rd", needs: ["precision machining", "ITAR", "aluminum"], tier: "Priority" },
];

const PROGRAMS = ["F-35", "T-7A", "CH-53K", "KC-46", "B-21", "GE9X", "T408", "Patriot", "SM-6", "JASSM"];
const PARTS = ["bracket assembly", "actuator housing", "structural fitting", "manifold", "bulkhead fitting", "engine mount", "hydraulic block", "landing-gear pin"];
const TITLES = ["VP Supply Chain", "Director of Procurement", "Program Manager", "Commodity Manager", "Director of Operations", "Sourcing Lead", "Quality Director"];
const FIRST = [
  "Maria", "David", "Linda", "Omar", "Priya", "Wei", "Sofia", "Marcus", "Elena", "Kevin", "Grace", "Nadia",
  "Alyssa", "Jordan", "Camila", "Ethan", "Noah", "Maya", "Andre", "Hannah", "Victor", "Leah", "Ravi", "Teresa",
  "Miles", "Diana", "Jamal", "Kara", "Anika", "Reid", "Monica", "Samuel",
];
const LAST = [
  "Reed", "Nguyen", "Carter", "Patel", "Brooks", "Flores", "Hayes", "Vargas", "Diaz", "Chen", "Foster", "Malik",
  "Hart", "Raman", "Bennett", "Singh", "Morales", "Kim", "Wright", "Fischer", "Alvarez", "Stone", "Khan", "Ellis",
  "Cooper", "Sato", "Mendez", "Price", "Bishop", "Lin", "Hughes", "Walker",
];
const BUYING_EVENTS = ["government_contract_award", "contract_win", "demand_spike", "hiring_surge"] as const;
const RISK_EVENTS = ["supplier_delay", "quality_escape", "capacity_constraint", "pricing_pressure", "regulatory_change", "contract_loss"] as const;
const STAGES: Stage[] = ["prospecting", "qualified", "proposal", "won", "lost"];

function signalQuote(eventType: string, name: string, value?: number): string {
  const money = value ? `$${(value / 1_000_000).toFixed(1)}M ` : "";
  const quote: Record<string, string> = {
    government_contract_award: `${name} was awarded a ${money}government production contract.`,
    contract_win: `${name} booked a ${money}multi-year production program.`,
    demand_spike: `Demand for ${name}'s assemblies increased after new program starts.`,
    hiring_surge: `${name} posted a surge of manufacturing and supply-chain openings.`,
    supplier_delay: `${name} notified buyers of multi-week shipment delays.`,
    quality_escape: `A customer quality hold was opened after a quality escape at ${name}.`,
    capacity_constraint: `${name} is quoting longer lead times because its production floor is near capacity.`,
    pricing_pressure: `${name} raised quoted prices because of material and labor pressure.`,
    regulatory_change: `New compliance requirements affect certified work at ${name}.`,
    contract_loss: `${name} lost a ${money}recompete it had held for years.`,
  };
  return quote[eventType] ?? `${name}: ${eventType}.`;
}

function sentence(text: string): string {
  return `${text.replace(/[.?!]\s*$/u, "")}.`;
}

function headline(eventType: string, name: string, value?: number): string {
  const money = value ? ` ($${(value / 1_000_000).toFixed(1)}M)` : "";
  const phrases: Record<string, string> = {
    government_contract_award: `wins government production award${money}`,
    contract_win: `books multi-year production program${money}`,
    demand_spike: "sees demand rise on new starts",
    hiring_surge: "adds manufacturing and sourcing roles",
    capacity_constraint: "quotes longer lead times",
    supplier_delay: "flags shipment delays",
    quality_escape: "faces customer quality hold",
  };
  return `${name} ${phrases[eventType] ?? eventType.replace(/_/g, " ")}`;
}

const ACCOUNT_ROWS = ACCOUNTS.filter((account) => account.relationship !== "self");

const companies = ACCOUNT_ROWS.map((a) => ({
  id: a.id,
  name: a.name,
  relationship: a.relationship,
  account_status: a.account_status,
  business_motion: a.business_motion,
  location: {
    city: a.city,
    lat: round4(a.lat),
    lon: round4(a.lon),
    address: a.address,
    state: a.state,
    postal_code: a.postal_code,
    country: "USA",
  },
  domain: fictionalDomain(a.id),
  website_url: `https://${a.id}.example`,
  linkedin_url: demoUrl(`linkedin/company/${a.id}`),
  source_url: demoUrl(`crm/accounts/${a.id}`),
  needs: [...new Set([
    ...a.needs,
    ...(a.relationship === "self" ? [] : [pick(["NADCAP", "sheet metal", "assembly", "tooling", "electronics assembly", "hydraulic blocks"])]),
  ])].slice(0, 5),
  ...provenance("Simulated CRM Account Snapshot"),
}));

const contacts: unknown[] = [];
const facilities: unknown[] = [];
const opportunities: unknown[] = [];
const signals: unknown[] = [];
const news: unknown[] = [];
const extractedSignals: unknown[] = [];
const insights: Record<string, { opportunity: string; findings: Record<string, string> }> = {};
const usedContactNames = new Set<string>();
let contactSeq = 0;
let facilitySeq = 0;
let opportunitySeq = 0;
let signalSeq = 0;
let newsSeq = 0;

function contactName(): string {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const name = `${pick(FIRST)} ${pick(LAST)}`;
    if (!usedContactNames.has(name)) {
      usedContactNames.add(name);
      return name;
    }
  }
  const fallback = `${pick(FIRST)} ${pick(LAST)} ${usedContactNames.size + 1}`;
  usedContactNames.add(fallback);
  return fallback;
}

for (const account of ACCOUNT_ROWS) {
  const publicAccount = account.relationship !== "self";
  const contactCount = account.relationship === "self" ? 2 : int(2, 3);
  const accountFindings: Record<string, string> = {};

  for (let i = 0; i < contactCount; i += 1) {
    contactSeq += 1;
    const name = contactName();
    contacts.push({
      id: `con-${String(contactSeq).padStart(4, "0")}`,
      company_id: account.id,
      name,
      title: pick(TITLES),
      email: contactEmail(name, account.id),
      ...provenance("Simulated CRM Contacts"),
    });
  }

  facilitySeq += 1;
  facilities.push({
    id: `fac-${String(facilitySeq).padStart(4, "0")}`,
    company_id: account.id,
    city: account.city,
    address: account.address,
    state: account.state,
    postal_code: account.postal_code,
    country: "USA",
    lat: round4(account.lat + (rnd() - 0.5) * 0.035),
    lon: round4(account.lon + (rnd() - 0.5) * 0.035),
    kind: "HQ",
    source_url: demoUrl(`erp/facilities/${String(facilitySeq).padStart(4, "0")}`),
    ...provenance("Simulated ERP Facility Master"),
  });

  const oppCount = account.relationship === "self" ? 1 : int(1, 3);
  for (let i = 0; i < oppCount; i += 1) {
    opportunitySeq += 1;
    const stage = account.relationship === "target" ? pick(["prospecting", "qualified", "proposal"] as const) : pick(STAGES);
    opportunities.push({
      id: `opp-${String(opportunitySeq).padStart(4, "0")}`,
      company_id: account.id,
      name: `${pick(PROGRAMS)} ${pick(PARTS)}`,
      account_status: stage === "won" ? "current_customer" : stage === "lost" ? "past_customer" : account.account_status,
      business_motion: account.relationship === "target" ? "prospect_new_business" : stage === "lost" ? "manage_current_business" : account.business_motion,
      value: int(5, 200) * 10_000,
      stage,
      source_url: demoUrl(`pipeline/${String(opportunitySeq).padStart(4, "0")}`),
      contract_url: demoUrl(`contracts/${String(opportunitySeq).padStart(4, "0")}`),
      document_url: demoUrl(`documents/opportunities/${String(opportunitySeq).padStart(4, "0")}.pdf`),
      close_date: new Date(AS_OF_MS + int(-90, 180) * 86400000).toISOString().slice(0, 10),
      ...provenance("Simulated CRM Opportunities"),
    });
  }

  const eventPool = account.relationship === "target" ? BUYING_EVENTS : [...BUYING_EVENTS, ...RISK_EVENTS];
  const signalCount = account.relationship === "self" ? 4 : int(2, 4);
  for (let i = 0; i < signalCount; i += 1) {
    signalSeq += 1;
    const eventType = pick(eventPool);
    const value = eventType === "government_contract_award" || eventType === "contract_win" || eventType === "contract_loss" ? int(5, 200) * 10_000 : undefined;
    const quote = signalQuote(eventType, account.name, value);
    const id = `sig-${String(signalSeq).padStart(4, "0")}`;
    signals.push({
      id,
      event_type: eventType,
      entities: [account.name],
      subject_id: account.id,
      account_status: account.account_status,
      business_motion: RISK_EVENTS.includes(eventType as (typeof RISK_EVENTS)[number]) ? "reduce_risk" : account.business_motion,
      ...(value !== undefined ? { value } : {}),
      confidence: round2(0.72 + rnd() * 0.25),
      source_quote: quote,
      source_url: demoUrl(`signals/${id}`),
      document_url: demoUrl(`documents/signals/${id}.pdf`),
      detected_at: isoDaysAgo(int(1, 45)),
      ...provenance("Simulated Market Signal Feed"),
    });
    accountFindings[id] = quote;
  }

  if (publicAccount && newsSeq < 14) {
    newsSeq += 1;
    const eventType = pick(account.relationship === "target" ? BUYING_EVENTS : [...BUYING_EVENTS, "capacity_constraint", "quality_escape"] as const);
    const value = eventType === "government_contract_award" || eventType === "contract_win" ? int(5, 200) * 10_000 : undefined;
    const quote = signalQuote(eventType, account.name, value);
    const newsId = `news-${String(newsSeq).padStart(2, "0")}`;
    news.push({
      id: newsId,
      source: pick(["GovCon Beat", "AeroSupply News", "Manufacturing Today", "Quality Digest"]),
      published_date: isoDaysAgo(int(1, 28)).slice(0, 10),
      headline: headline(eventType, account.name, value),
      body: `${sentence(quote)} The static demo article is shaped like a public source that would be ingested by the monitor.`,
      subject_id: account.id,
      account_status: account.account_status,
      business_motion: RISK_EVENTS.includes(eventType as (typeof RISK_EVENTS)[number]) ? "reduce_risk" : account.business_motion,
      event_type: eventType,
      ...(value !== undefined ? { value } : {}),
      source_quote: quote,
      source_url: demoUrl(`public-news/${newsId}`),
      document_url: demoUrl(`documents/news/${newsId}.pdf`),
      ...provenance("Simulated Public News Snapshot"),
    });
    extractedSignals.push({
      news_id: newsId,
      headline: headline(eventType, account.name, value),
      extracted: {
        event_type: eventType,
        entities: [account.name],
        ...(value !== undefined ? { value } : {}),
        confidence: round2(0.78 + rnd() * 0.18),
        source_quote: quote,
      },
      valid: true,
      reason: "",
    });
  }

  insights[account.id] = {
    opportunity: `${account.name} is a ${account.tier.toLowerCase()} ${account.relationship === "target" ? "prospecting" : "current-business"} account in ${account.city}. Use the deterministic scores, validated signals, CRM context, and capacity context before committing resources.`,
    findings: accountFindings,
  };
}

const crm = ACCOUNT_ROWS.slice(0, 14).map((a, index) => {
  const openOppValue = (opportunities as Array<{ company_id: string; value: number; stage: Stage }>)
    .filter((o) => o.company_id === a.id && o.stage !== "won" && o.stage !== "lost")
    .reduce((sum, o) => sum + o.value, 0);
  return {
    account_id: a.id,
    crm_account_name: a.name,
    owner: a.relationship === "target" ? "BTX Growth Team" : pick(["Alyssa Hart", "Marcus Lee", "Priya Raman"]),
    account_tier: a.tier,
    last_activity_at: isoDaysAgo(1 + (index % 18)),
    next_step: a.relationship === "target" ? "Validate decision-maker and capacity need" : "Review account plan and confirm next production window",
    relationship_health: a.business_motion === "reduce_risk" ? "needs attention" : a.relationship === "target" ? "new" : "active",
    open_pipeline_value: openOppValue,
    ...provenance("Simulated CRM"),
  };
});

const capacity = [
  { facility_id: "btx-dallas-main", facility_name: "BTX Dallas Main", city: "Dallas", available_5_axis_hours_next_30d: 420, available_turning_hours_next_30d: 260, constraint: "inspection queue", quoted_lead_time_days: 24, capacity_status: "selective_capacity" },
  { facility_id: "btx-austin-cell", facility_name: "BTX Austin Partner Cell", city: "Austin", available_5_axis_hours_next_30d: 180, available_turning_hours_next_30d: 140, constraint: "material availability", quoted_lead_time_days: 18, capacity_status: "available_for_overflow" },
  { facility_id: "btx-san-antonio-partner", facility_name: "BTX San Antonio Partner Cell", city: "San Antonio", available_5_axis_hours_next_30d: 115, available_turning_hours_next_30d: 95, constraint: "programmer availability", quoted_lead_time_days: 21, capacity_status: "limited_capacity" },
].map((r) => ({ ...r, ...provenance("Simulated ERP Capacity") }));

const openPipeline = (opportunities as Array<{ company_id: string; value: number; stage: Stage }>)
  .filter((o) => o.stage !== "won" && o.stage !== "lost");
const pipeline = {
  as_of: AS_OF,
  summary: {
    open_pipeline_value: openPipeline.reduce((sum, o) => sum + o.value, 0),
    weighted_pipeline_value: Math.round(openPipeline.reduce((sum, o) => sum + o.value * (o.stage === "proposal" ? 0.55 : o.stage === "qualified" ? 0.35 : 0.15), 0)),
    priority_accounts: ["lonestar-aero-systems", "hill-country-aerostructures", "mesquite-defense-manufacturing"],
    top_action: "Prioritize accounts with validated demand signals and available BTX capacity.",
  },
  records: ["lonestar-aero-systems", "clearfork-turbine-works", "hill-country-aerostructures", "mesquite-defense-manufacturing", "ranger-landing-gear"].map((company_id) => ({
    company_id,
    recommended_action: company_id.includes("hill") || company_id.includes("mesquite") || company_id.includes("ranger") ? "Pursue Revenue" : "Expand Relationship",
    reason: "Static demo context combines CRM status, public signals, fit, and capacity availability.",
    ...provenance("Simulated Pipeline Snapshot"),
  })),
  ...provenance("Simulated Pipeline Snapshot"),
};

const integrations = [
  ["crm", "CRM", "CRM", "demo_connected", "crm.json", "OAuth-connected CRM REST/Bulk APIs via backend adapter", "Simulated account, contact, activity, and opportunity context."],
  ["erp-capacity", "ERP / Capacity", "Operations", "demo_connected", "erp_capacity.json", "Authenticated ERP/MES adapter normalizing work-center capacity and backlog", "Simulated capacity, lead time, and constraint context."],
  ["pipeline-history", "Pipeline History", "Revenue Operations", "demo_connected", "pipeline_snapshots.json", "CRM opportunity history snapshots", "Simulated 24-month pipeline trend data."],
  ["public-news", "Public News / Market Signals", "Market Intelligence", "demo_connected", "news.json", "Monitor ingestion of RSS, APIs, and validated extracted signals", "Static market events shaped for signal extraction."],
  ["email-calendar", "Email / Calendar", "Productivity", "future", "contacts.json", "Microsoft Graph or Google Workspace OAuth", "Future relationship activity and meeting recency signals."],
].map(([id, name, category, status, demo_file, production_method, description]) => ({
  id,
  name,
  category,
  status,
  demo_file,
  production_method,
  description,
  is_demo: true,
}));

const assumptions = {
  as_of: AS_OF,
  is_static_demo: true,
  summary: "CRM, ERP/capacity, contacts, opportunities, pipeline, and operating history are simulated for demo purposes.",
  assumptions: [
    "All account names, addresses, contacts, values, and operating history are fictional demo records.",
    "Opportunity values are deterministic illustrative values between $50k and $2M.",
    "Capacity values demonstrate prioritization logic and are not production shop commitments.",
    "Future production adapters should preserve stable IDs and provenance while replacing static snapshots with authenticated API data.",
  ],
  ...provenance("BTX Demo Assumptions"),
};

const months = Array.from({ length: 24 }, (_, i) => monthKey(23 - i));
const currentAccounts = ACCOUNTS.filter((a) => a.relationship === "customer");
const prospectAccounts = ACCOUNTS.filter((a) => a.relationship === "target");
const customerRevenueWeights = [0.24, 0.13, 0.11, 0.1, 0.09, 0.08, 0.075, 0.07, 0.06, 0.045];
const accountMonthlyRevenue = months.flatMap((month, monthIndex) =>
  currentAccounts.map((a, accountIndex) => {
    const totalMonthlyRevenue = 2_450_000 + monthIndex * 22_000 + int(-5, 5) * 12_000;
    const seasonal = 1 + ((monthIndex % 6) - 2) * 0.012;
    return {
      month,
      account_id: a.id,
      revenue: Math.round(totalMonthlyRevenue * (customerRevenueWeights[accountIndex] ?? 0.04) * seasonal),
      gross_margin_pct: round2(0.23 + ((accountIndex + monthIndex) % 6) * 0.012),
      ...provenance("Simulated Monthly Revenue"),
    };
  }),
);
const monthlyRevenueByMonth = new Map<string, number>();
for (const row of accountMonthlyRevenue as Array<{ month: string; revenue: number }>) {
  monthlyRevenueByMonth.set(row.month, (monthlyRevenueByMonth.get(row.month) ?? 0) + row.revenue);
}
let backlog = 6_100_000;
const bookingsBacklog = months.map((month, index) => {
  const revenue = monthlyRevenueByMonth.get(month) ?? 2_700_000;
  const bookToBill = 0.94 + (index % 5) * 0.055;
  const shipments = Math.round(revenue * (0.94 + (index % 3) * 0.018));
  const bookings = Math.round(shipments * bookToBill);
  backlog = Math.max(4_800_000, backlog + bookings - shipments);
  return {
    month,
    bookings,
    backlog: Math.round(backlog),
    shipments,
    ...provenance("Simulated Bookings Backlog"),
  };
});
const pipelineSnapshots = months.map((month, index) => {
  const revenue = monthlyRevenueByMonth.get(month) ?? 2_700_000;
  return {
    month,
    open_pipeline_value: Math.round(revenue * (3.5 + (index % 4) * 0.22)),
    weighted_pipeline_value: Math.round(revenue * (2.6 + (index % 3) * 0.18)),
    prospect_count: Math.max(5, prospectAccounts.length - (23 - index % 5)),
    ...provenance("Simulated Pipeline History"),
  };
});
const capacityUtilization = months.flatMap((month, index) =>
  capacity.map((facility, facilityIndex) => ({
    month,
    facility_id: facility.facility_id,
    utilization_pct: Math.min(96, 63 + facilityIndex * 7 + (index % 8) * 2),
    available_5_axis_hours: Math.max(60, 460 - index * 5 - facilityIndex * 80 + int(0, 30)),
    quoted_lead_time_days: 14 + facilityIndex * 4 + (index % 6),
    ...provenance("Simulated Capacity History"),
  })),
);
const winLossHistory = months.map((month, index) => {
  const wins = index % 4 === 0 ? 1 : index % 4 === 1 ? 2 : 1;
  const losses = index % 4 === 1 ? 3 : 2;
  return {
    month,
    wins,
    losses,
    win_value: wins * (140_000 + (index % 5) * 35_000),
    loss_value: losses * (90_000 + (index % 4) * 30_000),
    ...provenance("Simulated Win Loss History"),
  };
});

const cachedFlows = [
  {
    id: "defense-signals",
    question: "What defense funding signals should BTX care about?",
    intent: "market_signals",
    activatedBrainAreas: ["market", "capability", "revenue", "customer"],
    deliverableType: null,
    deterministicFallback: "Structured response from generateBrainResponse using validated signals.",
    ...provenance("Offline Demo Flow Cache"),
  },
  {
    id: "austin-trip",
    question: "I'm in Austin next week. Who should I talk to?",
    intent: "geographic_prospecting",
    activatedBrainAreas: ["geographic", "customer", "market", "capability", "revenue"],
    deliverableType: "itinerary",
    deterministicFallback: "itineraryAgent selects scored nearby prospects and embeds meeting-prep sections.",
    ...provenance("Offline Demo Flow Cache"),
  },
  {
    id: "at-risk-deals",
    question: "Which deals are at risk this quarter?",
    intent: "account_risk",
    activatedBrainAreas: ["revenue", "customer", "decision"],
    deliverableType: null,
    deterministicFallback: "Structured response from risk scores and validated signal traces.",
    ...provenance("Offline Demo Flow Cache"),
  },
  {
    id: "production-fit",
    question: "What should sales focus on based on what we can actually produce?",
    intent: "capabilities",
    activatedBrainAreas: ["capability", "revenue", "market"],
    deliverableType: null,
    deterministicFallback: "Structured response from client-profile capabilities and ERP capacity snapshot.",
    ...provenance("Offline Demo Flow Cache"),
  },
  {
    id: "weekly-brief",
    question: "What should I care about this week?",
    intent: "weekly_brief",
    activatedBrainAreas: ["market", "revenue", "customer", "capability"],
    deliverableType: "weekly_memo",
    deterministicFallback: "weeklyMemoAgent composes a validated memo from deterministic engine context.",
    ...provenance("Offline Demo Flow Cache"),
  },
];

function assertReferentialIntegrity(): void {
  const companyIds = new Set(ACCOUNTS.map((a) => a.id));
  const failures: string[] = [];
  for (const row of contacts as Array<{ id: string; company_id: string }>) if (!companyIds.has(row.company_id)) failures.push(`contact ${row.id}`);
  for (const row of facilities as Array<{ id: string; company_id: string }>) if (!companyIds.has(row.company_id)) failures.push(`facility ${row.id}`);
  for (const row of opportunities as Array<{ id: string; company_id: string }>) if (!companyIds.has(row.company_id)) failures.push(`opportunity ${row.id}`);
  for (const row of signals as Array<{ id: string; subject_id: string }>) if (!companyIds.has(row.subject_id)) failures.push(`signal ${row.id}`);
  for (const row of news as Array<{ id: string; subject_id: string }>) if (!companyIds.has(row.subject_id)) failures.push(`news ${row.id}`);
  for (const row of accountMonthlyRevenue as Array<{ account_id: string }>) if (!companyIds.has(row.account_id)) failures.push(`monthly revenue ${row.account_id}`);
  if (failures.length) throw new Error(`Referential integrity failed: ${failures.join(", ")}`);
}

function write(file: string, data: unknown): void {
  writeFileSync(join(OUT_DIR, file), `${JSON.stringify(data, null, 2)}\n`);
}

mkdirSync(OUT_DIR, { recursive: true });
assertReferentialIntegrity();
write("companies.json", companies);
write("contacts.json", contacts);
write("facilities.json", facilities);
write("opportunities.json", opportunities);
write("signals.json", signals);
write("news.json", news);
write("extracted-signals.json", extractedSignals);
write("insights.json", insights);
write("crm.json", crm);
write("erp_capacity.json", capacity);
write("pipeline.json", pipeline);
write("integrations.json", integrations);
write("assumptions.json", assumptions);
write("account_monthly_revenue.json", accountMonthlyRevenue);
write("pipeline_snapshots.json", pipelineSnapshots);
write("bookings_backlog.json", bookingsBacklog);
write("capacity_utilization.json", capacityUtilization);
write("win_loss_history.json", winLossHistory);
write("cached_flows.json", cachedFlows);

console.log(`generated ${companies.length} companies (${currentAccounts.length} current customers, ${prospectAccounts.length} prospects), ${signals.length} signals, ${contacts.length} contacts, ${facilities.length} facilities, ${opportunities.length} opportunities, ${news.length} news events`);
console.log(`generated 24 months each for revenue, pipeline, backlog, capacity, and win/loss history; referential integrity passed (seed ${SEED})`);
