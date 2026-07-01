// Seeded, deterministic mock-world generator. Run it OFFLINE and commit the
// output as frozen fixtures — never generate at load time (that would break the
// "every demo is byte-identical" guarantee). Same SEED + same AS_OF => same JSON.
//
//   node frontend/tools/generate-mock.ts
//
// All client/industry content (company names, cities, capability tags, quotes)
// lives HERE in the demo layer, never in src/engine/. Add cities/companies to
// expand; the engine never changes.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SEED = 0x42784358; // fixed; any int. No Math.random / Date.now anywhere.
const AS_OF = Date.parse("2026-06-30T00:00:00Z");
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "../data/mock");

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

// A handful of cities for the demo (expandable). Centroids; companies jitter ~7mi.
const CITY: Record<string, { lat: number; lon: number }> = {
  Dallas:     { lat: 32.7767, lon: -96.7970 },
  Austin:     { lat: 30.2672, lon: -97.7431 },
  Wichita:    { lat: 37.6872, lon: -97.3301 },
  Phoenix:    { lat: 33.4484, lon: -112.0740 },
  Hartford:   { lat: 41.7658, lon: -72.6734 },
  Huntsville: { lat: 34.7304, lon: -86.5861 },
};

// Cities are assigned by hand to build good clusters (e.g. several prospects in
// Austin for the "I'm in Austin, who do I call?" story).
const COMPANIES = [
  { id: "btx-precision",     name: "BTX Precision",        relationship: "self",       city: "Dallas" },
  { id: "titan-castings",    name: "Titan Castings Co",    relationship: "supplier",   city: "Huntsville" },
  { id: "meridian-forgings", name: "Meridian Forgings",    relationship: "supplier",   city: "Wichita" },
  { id: "cobalt-alloys",     name: "Cobalt Alloys",        relationship: "supplier",   city: "Phoenix" },
  { id: "granite-tooling",   name: "Granite Tooling",      relationship: "supplier",   city: "Austin" },
  { id: "apex-machining",    name: "Apex Machining",       relationship: "competitor", city: "Dallas" },
  { id: "vanguard-aero",     name: "Vanguard Aerospace",   relationship: "competitor", city: "Wichita" },
  { id: "ironclad-comp",     name: "Ironclad Components",  relationship: "competitor", city: "Hartford" },
  { id: "strata-mfg",        name: "Strata Manufacturing", relationship: "competitor", city: "Phoenix" },
  { id: "harbor-aero",       name: "Harbor Aerosystems",   relationship: "customer",   city: "Hartford" },
  { id: "continental-def",   name: "Continental Defense",  relationship: "customer",   city: "Dallas" },
  { id: "northwind-sys",     name: "Northwind Systems",    relationship: "customer",   city: "Austin" },
  { id: "beacon-aviation",   name: "Beacon Aviation",      relationship: "target",     city: "Austin" },
  { id: "summit-turbine",    name: "Summit Turbine",       relationship: "target",     city: "Austin" },
  { id: "delta-propulsion",  name: "Delta Propulsion",     relationship: "target",     city: "Wichita" },
  { id: "orion-defense",     name: "Orion Defense",        relationship: "target",     city: "Phoenix" },
];

// Capability tags a prospect might need. Overlap with BTX's capabilities = fit.
const CAPABILITY_UNIVERSE = [
  "5-axis CNC", "precision machining", "build-to-print", "AS9100", "ITAR",
  "titanium", "aluminum", "sheet metal", "assembly", "NADCAP",
];

const FIRST = ["James", "Maria", "David", "Linda", "Robert", "Susan", "Michael", "Karen", "Daniel", "Nancy", "Paul", "Lisa"];
const LAST = ["Reed", "Nguyen", "Carter", "Patel", "Brooks", "Flores", "Hayes", "Cole", "Vargas", "Sharpe", "Diaz", "Knox"];
const TITLES = ["VP Supply Chain", "Director of Procurement", "Chief Engineer", "Program Manager", "Commodity Manager", "Director of Operations"];

const POOLS: Record<string, string[]> = {
  self:       ["government_contract_award", "contract_win", "contract_loss", "capacity_constraint", "quality_escape", "demand_spike", "pricing_pressure", "competitor_won_deal"],
  supplier:   ["supplier_delay", "quality_escape", "capacity_constraint", "pricing_pressure", "regulatory_change"],
  competitor: ["government_contract_award", "contract_win", "competitor_expansion", "hiring_surge"],
  customer:   ["demand_spike", "government_contract_award", "contract_win", "hiring_surge"],
  target:     ["demand_spike", "government_contract_award", "hiring_surge", "contract_win"],
};

const VALUE_EVENTS = new Set(["government_contract_award", "contract_win", "contract_loss"]);
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

// Pick `k` distinct items from a pool, deterministically.
function sample<T>(pool: T[], k: number): T[] {
  const copy = [...pool];
  const out: T[] = [];
  for (let i = 0; i < k && copy.length > 0; i++) {
    out.push(copy.splice(Math.floor(rnd() * copy.length), 1)[0]);
  }
  return out;
}

const companies: unknown[] = [];
const signals: unknown[] = [];
const contacts: unknown[] = [];
let sn = 0;
let cn = 0;

for (const c of COMPANIES) {
  const base = CITY[c.city];
  companies.push({
    id: c.id,
    name: c.name,
    relationship: c.relationship,
    location: {
      city: c.city,
      lat: round4(base.lat + (rnd() - 0.5) * 0.2),
      lon: round4(base.lon + (rnd() - 0.5) * 0.2),
    },
    needs: sample(CAPABILITY_UNIVERSE, int(2, 5)).sort(),
  });

  // Contacts — who to call.
  const contactCount = int(1, 3);
  for (let i = 0; i < contactCount; i++) {
    cn += 1;
    contacts.push({
      id: `con-${String(cn).padStart(4, "0")}`,
      company_id: c.id,
      name: `${pick(FIRST)} ${pick(LAST)}`,
      title: pick(TITLES),
    });
  }

  // Signals — what's happening.
  const signalCount = c.relationship === "self" ? int(5, 8) : int(3, 6);
  for (let i = 0; i < signalCount; i++) {
    const ev = pick(POOLS[c.relationship]);
    const value = VALUE_EVENTS.has(ev) ? int(5, 200) * 100000 : undefined;
    const confidence = round2(0.65 + rnd() * 0.33);
    const detectedMs = AS_OF - int(0, 29) * 86400000 - int(0, 23) * 3600000;
    const rival = pick(COMPETITORS).name;
    const entities = ev === "competitor_won_deal" ? [c.name, rival] : [c.name];
    sn += 1;
    signals.push({
      id: `sig-${String(sn).padStart(4, "0")}`,
      event_type: ev,
      entities,
      subject_id: c.id,
      ...(value !== undefined ? { value } : {}),
      confidence,
      source_quote: quote(ev, c.name, value, rival),
      detected_at: new Date(detectedMs).toISOString(),
    });
  }
}

const write = (file: string, data: unknown) =>
  writeFileSync(join(OUT_DIR, file), JSON.stringify(data, null, 2) + "\n");

write("companies.json", companies);
write("signals.json", signals);
write("contacts.json", contacts);
console.log(`generated ${companies.length} companies, ${signals.length} signals, ${contacts.length} contacts (seed ${SEED}, as_of 2026-06-30)`);
