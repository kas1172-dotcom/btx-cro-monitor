// Seeded, deterministic demo-world generator. Run OFFLINE, commit the output.
// Same SEED + AS_OF => byte-identical JSON. All client/industry content lives
// here in the demo layer, never in src/engine/.
//
//   npm run demo:generate
//
// Scaled to feel like a real enterprise system: ~50 companies across 10 cities,
// ~500 contacts, a few hundred signals. (Facility/Contract/Opportunity/
// MarketEvent entities + news→signal extraction are the next layer.)

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SEED = 0x42784358;
const AS_OF = Date.parse("2026-06-30T00:00:00Z");
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "../data/demo/btx");

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
const pick = <T>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];
const int = (min: number, max: number): number => min + Math.floor(rnd() * (max - min + 1));
const round2 = (n: number): number => Math.round(n * 100) / 100;
const round4 = (n: number): number => Math.round(n * 10000) / 10000;
const provenance = (source_name: string) => ({
  source_type: "demo",
  source_name,
  source_mode: "static_snapshot",
});

const CITY: Record<string, { lat: number; lon: number }> = {
  Dallas:     { lat: 32.7767, lon: -96.7970 },
  Austin:     { lat: 30.2672, lon: -97.7431 },
  Wichita:    { lat: 37.6872, lon: -97.3301 },
  Phoenix:    { lat: 33.4484, lon: -112.0740 },
  Hartford:   { lat: 41.7658, lon: -72.6734 },
  Huntsville: { lat: 34.7304, lon: -86.5861 },
  "San Diego": { lat: 32.7157, lon: -117.1611 },
  Tulsa:      { lat: 36.1540, lon: -95.9928 },
  Cincinnati: { lat: 39.1031, lon: -84.5120 },
  Greenville: { lat: 34.8526, lon: -82.3940 },
};
const CITY_STATE: Record<string, { state: string; postal: string }> = {
  Dallas: { state: "TX", postal: "75201" },
  Austin: { state: "TX", postal: "78701" },
  Wichita: { state: "KS", postal: "67202" },
  Phoenix: { state: "AZ", postal: "85004" },
  Hartford: { state: "CT", postal: "06103" },
  Huntsville: { state: "AL", postal: "35801" },
  "San Diego": { state: "CA", postal: "92101" },
  Tulsa: { state: "OK", postal: "74103" },
  Cincinnati: { state: "OH", postal: "45202" },
  Greenville: { state: "SC", postal: "29601" },
};
const CITIES = Object.keys(CITY);

const PREFIX = ["Apex", "Vanguard", "Titan", "Cobalt", "Granite", "Meridian", "Harbor", "Continental", "Northwind", "Beacon", "Summit", "Delta", "Orion", "Ironclad", "Strata", "Cascade", "Redstone", "Pinnacle", "Axiom", "Vertex", "Sentinel", "Keystone", "Falcon", "Aegis", "Nimbus", "Cardinal", "Lattice", "Foundry", "Monarch", "Halcyon", "Bastion", "Crestline", "Torque", "Sterling", "Anvil", "Meridian"];
const SUFFIX = ["Aerospace", "Machining", "Components", "Systems", "Precision", "Industries", "Manufacturing", "Technologies", "Fabrication", "Defense", "Turbine", "Propulsion", "Castings", "Forgings", "Tooling", "Alloys", "Dynamics", "Metalworks", "Aerosystems", "Controls"];

const FIRST = ["James", "Maria", "David", "Linda", "Robert", "Susan", "Michael", "Karen", "Daniel", "Nancy", "Paul", "Lisa", "Omar", "Priya", "Wei", "Sofia", "Marcus", "Elena", "Kevin", "Grace"];
const LAST = ["Reed", "Nguyen", "Carter", "Patel", "Brooks", "Flores", "Hayes", "Cole", "Vargas", "Sharpe", "Diaz", "Knox", "Okafor", "Weber", "Santos", "Bauer", "Rivera", "Chen", "Foster", "Malik"];
const TITLES = ["VP Supply Chain", "Director of Procurement", "Chief Engineer", "Program Manager", "Commodity Manager", "Director of Operations", "Sr. Buyer", "VP Manufacturing", "Quality Director", "Sourcing Lead"];

const CAPABILITY_UNIVERSE = ["5-axis CNC", "precision machining", "build-to-print", "AS9100", "ITAR", "titanium", "aluminum", "sheet metal", "assembly", "NADCAP"];

const PROGRAMS = ["F-35", "F-15EX", "CH-53K", "T-7A", "KC-46", "B-21", "GE9X", "LEAP-1B", "T408", "Black Hawk", "Patriot", "SM-6", "JASSM", "Gray Wolf"];
const PARTS = ["bracket assembly", "actuator housing", "turbine blade", "structural fitting", "gearbox component", "manifold", "bulkhead fitting", "engine mount", "hydraulic block", "landing-gear pin"];
const STAGES = ["prospecting", "qualified", "proposal", "won", "lost"];

const REL_POOL: Record<string, string[]> = {
  self:       ["government_contract_award", "contract_win", "contract_loss", "capacity_constraint", "quality_escape", "demand_spike", "pricing_pressure", "competitor_won_deal"],
  supplier:   ["supplier_delay", "quality_escape", "capacity_constraint", "pricing_pressure", "regulatory_change"],
  competitor: ["government_contract_award", "contract_win", "competitor_expansion", "hiring_surge"],
  customer:   ["demand_spike", "government_contract_award", "contract_win", "hiring_surge"],
  target:     ["demand_spike", "government_contract_award", "hiring_surge", "contract_win"],
};
const VALUE_EVENTS = new Set(["government_contract_award", "contract_win", "contract_loss"]);
const RISK_EVENTS = new Set([
  "quality_escape",
  "capacity_constraint",
  "contract_loss",
  "pricing_pressure",
  "supplier_delay",
  "regulatory_change",
  "competitor_expansion",
]);

// Weighted relationship mix (excludes self).
function pickRelationship(): string {
  const r = rnd();
  if (r < 0.42) return "target";
  if (r < 0.62) return "customer";
  if (r < 0.82) return "competitor";
  return "supplier";
}

function accountStatusForRelationship(relationship: string): string {
  if (relationship === "self" || relationship === "customer") return "current_customer";
  if (relationship === "supplier") return "partner";
  if (relationship === "competitor") return "competitor";
  return "target_prospect";
}

function businessMotionForRelationship(relationship: string): string {
  if (relationship === "self") return "manage_current_business";
  if (relationship === "customer") return "grow_existing_business";
  if (relationship === "target") return "prospect_new_business";
  return "reduce_risk";
}

function businessMotionForSignal(relationship: string, eventType: string): string {
  return RISK_EVENTS.has(eventType) ? "reduce_risk" : businessMotionForRelationship(relationship);
}

function businessMotionForOpportunity(relationship: string, stage: string): string {
  if (stage === "lost") return "manage_current_business";
  if (relationship === "target") return "prospect_new_business";
  if (relationship === "customer" || relationship === "self") return "grow_existing_business";
  return "reduce_risk";
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function demoUrl(path: string): string {
  return `https://demo.btx.example/${path}`;
}

function addressFor(city: string, n: number): { address: string; state: string; postal_code: string; country: string } {
  const meta = CITY_STATE[city];
  return {
    address: `${1000 + n * 17} Industrial Pkwy`,
    state: meta.state,
    postal_code: meta.postal,
    country: "USA",
  };
}

function sample<T>(pool: T[], k: number): T[] {
  const copy = [...pool];
  const out: T[] = [];
  for (let i = 0; i < k && copy.length > 0; i++) out.push(copy.splice(Math.floor(rnd() * copy.length), 1)[0]);
  return out;
}

interface Co { id: string; name: string; relationship: string; city: string; }

// ── Companies ────────────────────────────────────────────────────────────
const COMPANIES: Co[] = [{ id: "btx-precision", name: "BTX Precision", relationship: "self", city: "Dallas" }];
const usedNames = new Set<string>(["BTX Precision"]);
while (COMPANIES.length < 50) {
  const name = `${pick(PREFIX)} ${pick(SUFFIX)}`;
  if (usedNames.has(name)) continue;
  usedNames.add(name);
  COMPANIES.push({ id: slug(name), name, relationship: pickRelationship(), city: pick(CITIES) });
}
const COMPETITORS = COMPANIES.filter((c) => c.relationship === "competitor");

function quote(ev: string, name: string, value: number | undefined, rival: string): string {
  const m = value ? `$${(value / 1e6).toFixed(1)}M ` : "";
  switch (ev) {
    case "supplier_delay": return `${name} notified customers of a multi-week slip on shipments.`;
    case "quality_escape": return `A quality escape at ${name} triggered a customer source-inspection hold.`;
    case "capacity_constraint": return `${name} is quoting extended lead times, indicating its floor is near capacity.`;
    case "pricing_pressure": return `${name} raised quoted prices, citing material and labor cost inflation.`;
    case "regulatory_change": return `New compliance requirements affect ${name}'s certified processes.`;
    case "government_contract_award": return `${name} was awarded a ${m}government contract.`;
    case "contract_win": return `${name} booked a ${m}multi-year production contract.`;
    case "contract_loss": return `${name} lost a ${m}recompete it had held for years.`;
    case "demand_spike": return `Demand for ${name}'s products spiked on new program starts.`;
    case "competitor_expansion": return `${name} announced a facility expansion to add machining capacity.`;
    case "hiring_surge": return `${name} posted a surge of openings, signaling a growth push.`;
    case "competitor_won_deal": return `${rival} won a deal ${name} had been pursuing.`;
    default: return `${name}: ${ev}.`;
  }
}

const companies: unknown[] = [];
const signals: unknown[] = [];
const contacts: unknown[] = [];
const facilities: unknown[] = [];
const opportunities: unknown[] = [];
let sn = 0;
let cn = 0;
let fn = 0;
let on = 0;

for (const c of COMPANIES) {
  const base = CITY[c.city];
  const companyAddress = addressFor(c.city, companies.length + 1);
  companies.push({
    id: c.id,
    name: c.name,
    relationship: c.relationship,
    account_status: accountStatusForRelationship(c.relationship),
    business_motion: businessMotionForRelationship(c.relationship),
    location: { city: c.city, lat: round4(base.lat + (rnd() - 0.5) * 0.2), lon: round4(base.lon + (rnd() - 0.5) * 0.2), ...companyAddress },
    website_url: `https://${c.id}.example`,
    linkedin_url: demoUrl(`linkedin/company/${c.id}`),
    source_url: demoUrl(`sources/crm/accounts/${c.id}`),
    needs: sample(CAPABILITY_UNIVERSE, int(2, 5)).sort(),
    ...provenance("Simulated CRM Account Snapshot"),
  });

  const contactCount = int(6, 14); // ~500 total across 50 companies
  for (let i = 0; i < contactCount; i++) {
    cn += 1;
    contacts.push({
      id: `con-${String(cn).padStart(4, "0")}`,
      company_id: c.id,
      name: `${pick(FIRST)} ${pick(LAST)}`,
      title: pick(TITLES),
      ...provenance("Simulated CRM Contacts"),
    });
  }

  const signalCount = c.relationship === "self" ? int(5, 8) : int(2, 5);
  for (let i = 0; i < signalCount; i++) {
    const ev = pick(REL_POOL[c.relationship]);
    const value = VALUE_EVENTS.has(ev) ? int(5, 200) * 100000 : undefined;
    const confidence = round2(0.65 + rnd() * 0.33);
    const detectedMs = AS_OF - int(0, 29) * 86400000 - int(0, 23) * 3600000;
    const rival = (COMPETITORS.length ? pick(COMPETITORS).name : "A rival");
    const entities = ev === "competitor_won_deal" ? [c.name, rival] : [c.name];
    sn += 1;
    signals.push({
      id: `sig-${String(sn).padStart(4, "0")}`,
      event_type: ev,
      entities,
      subject_id: c.id,
      account_status: accountStatusForRelationship(c.relationship),
      business_motion: businessMotionForSignal(c.relationship, ev),
      ...(value !== undefined ? { value } : {}),
      confidence,
      source_quote: quote(ev, c.name, value, rival),
      source_url: demoUrl(`sources/signals/${String(sn).padStart(4, "0")}`),
      document_url: demoUrl(`documents/signals/${String(sn).padStart(4, "0")}.pdf`),
      detected_at: new Date(detectedMs).toISOString(),
      ...provenance("Simulated Market Signal Feed"),
    });
  }

  // Facilities — plants/HQ near the company's city (dossier density).
  const facilityCount = int(1, 5);
  for (let i = 0; i < facilityCount; i++) {
    fn += 1;
    const facilityAddress = addressFor(c.city, fn + 60);
    facilities.push({
      id: `fac-${String(fn).padStart(4, "0")}`,
      company_id: c.id,
      city: c.city,
      ...facilityAddress,
      lat: round4(base.lat + (rnd() - 0.5) * 0.15),
      lon: round4(base.lon + (rnd() - 0.5) * 0.15),
      kind: i === 0 ? "HQ" : "plant",
      source_url: demoUrl(`sources/erp/facilities/${String(fn).padStart(4, "0")}`),
      ...provenance("Simulated ERP Facility Master"),
    });
  }

  // Opportunities — the pipeline of deals per account.
  const oppCount = int(3, 9);
  for (let i = 0; i < oppCount; i++) {
    on += 1;
    const stage = pick(STAGES);
    opportunities.push({
      id: `opp-${String(on).padStart(4, "0")}`,
      company_id: c.id,
      name: `${pick(PROGRAMS)} ${pick(PARTS)}`,
      account_status: stage === "won" ? "current_customer" : stage === "lost" ? "past_customer" : "active_pipeline",
      business_motion: businessMotionForOpportunity(c.relationship, stage),
      value: int(1, 200) * 100000,
      stage,
      source_url: demoUrl(`sources/pipeline/${String(on).padStart(4, "0")}`),
      contract_url: demoUrl(`contracts/${String(on).padStart(4, "0")}`),
      document_url: demoUrl(`documents/opportunities/${String(on).padStart(4, "0")}.pdf`),
      close_date: new Date(AS_OF + int(-120, 180) * 86400000).toISOString().slice(0, 10),
      ...provenance("Simulated Salesforce Opportunities"),
    });
  }
}

// ── Market events (news) tied to REAL companies, so extraction/ingestion
// resolves to actual accounts and moves real scores. ────────────────────────
const SOURCES = ["Defense Daily", "AeroSupply News", "GovCon Beat", "Metalworking Wire", "Quality Digest", "Manufacturing Today", "Careers Wire", "Compliance Watch"];
function newsHeadline(ev: string, name: string, value?: number): string {
  const m = value ? ` ($${(value / 1e6).toFixed(1)}M)` : "";
  const phrase: Record<string, string> = {
    supplier_delay: "flags multi-week shipment delays",
    quality_escape: "hit with a customer quality hold",
    capacity_constraint: "quoting long lead times as capacity tightens",
    pricing_pressure: "raises quoted prices on cost inflation",
    regulatory_change: "faces new compliance requirements",
    government_contract_award: `wins a government contract${m}`,
    contract_win: `books a multi-year production contract${m}`,
    contract_loss: `loses a long-held recompete${m}`,
    demand_spike: "sees demand surge on new program starts",
    competitor_expansion: "expands machining capacity",
    hiring_surge: "posts a hiring surge",
  };
  return `${name} ${phrase[ev] ?? ev}`;
}
const newsCompanies = COMPANIES.filter((c) => c.relationship !== "self").slice(0, 14);
const newsEvents: unknown[] = [];
let nn = 0;
for (const c of newsCompanies) {
  nn += 1;
  const ev = pick(REL_POOL[c.relationship]);
  const value = VALUE_EVENTS.has(ev) ? int(5, 200) * 100000 : undefined;
  const detectedMs = AS_OF - int(1, 20) * 86400000;
  const q = quote(ev, c.name, value, "A rival");
  newsEvents.push({
    id: `news-${String(nn).padStart(2, "0")}`,
    source: pick(SOURCES),
    published_date: new Date(detectedMs).toISOString().slice(0, 10),
    headline: newsHeadline(ev, c.name, value),
    body: `${q} Industry watchers say the move could reshape supplier dynamics in the segment.`,
    subject_id: c.id,
    account_status: accountStatusForRelationship(c.relationship),
    business_motion: businessMotionForSignal(c.relationship, ev),
    event_type: ev,
    ...(value !== undefined ? { value } : {}),
    source_quote: q,
    source_url: demoUrl(`public-news/${String(nn).padStart(2, "0")}`),
    document_url: demoUrl(`documents/news/${String(nn).padStart(2, "0")}.pdf`),
    ...provenance("Simulated Public News Snapshot"),
  });
}

const write = (file: string, data: unknown) => writeFileSync(join(OUT_DIR, file), JSON.stringify(data, null, 2) + "\n");
write("companies.json", companies);
write("signals.json", signals);
write("contacts.json", contacts);
write("facilities.json", facilities);
write("opportunities.json", opportunities);
write("news.json", newsEvents);
console.log(`generated ${companies.length} companies, ${signals.length} signals, ${contacts.length} contacts, ${facilities.length} facilities, ${opportunities.length} opportunities, ${newsEvents.length} news events (seed ${SEED})`);
