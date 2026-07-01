// Seeded, deterministic mock-world generator. Run OFFLINE, commit the output.
// Same SEED + AS_OF => byte-identical JSON. All client/industry content lives
// here in the demo layer, never in src/engine/.
//
//   node frontend/tools/generate-mock.ts
//
// Scaled to feel like a real enterprise system: ~50 companies across 10 cities,
// ~500 contacts, a few hundred signals. (Facility/Contract/Opportunity/
// MarketEvent entities + news→signal extraction are the next layer.)

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SEED = 0x42784358;
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
const CITIES = Object.keys(CITY);

const PREFIX = ["Apex", "Vanguard", "Titan", "Cobalt", "Granite", "Meridian", "Harbor", "Continental", "Northwind", "Beacon", "Summit", "Delta", "Orion", "Ironclad", "Strata", "Cascade", "Redstone", "Pinnacle", "Axiom", "Vertex", "Sentinel", "Keystone", "Falcon", "Aegis", "Nimbus", "Cardinal", "Lattice", "Foundry", "Monarch", "Halcyon", "Bastion", "Crestline", "Torque", "Sterling", "Anvil", "Meridian"];
const SUFFIX = ["Aerospace", "Machining", "Components", "Systems", "Precision", "Industries", "Manufacturing", "Technologies", "Fabrication", "Defense", "Turbine", "Propulsion", "Castings", "Forgings", "Tooling", "Alloys", "Dynamics", "Metalworks", "Aerosystems", "Controls"];

const FIRST = ["James", "Maria", "David", "Linda", "Robert", "Susan", "Michael", "Karen", "Daniel", "Nancy", "Paul", "Lisa", "Omar", "Priya", "Wei", "Sofia", "Marcus", "Elena", "Kevin", "Grace"];
const LAST = ["Reed", "Nguyen", "Carter", "Patel", "Brooks", "Flores", "Hayes", "Cole", "Vargas", "Sharpe", "Diaz", "Knox", "Okafor", "Weber", "Santos", "Bauer", "Rivera", "Chen", "Foster", "Malik"];
const TITLES = ["VP Supply Chain", "Director of Procurement", "Chief Engineer", "Program Manager", "Commodity Manager", "Director of Operations", "Sr. Buyer", "VP Manufacturing", "Quality Director", "Sourcing Lead"];

const CAPABILITY_UNIVERSE = ["5-axis CNC", "precision machining", "build-to-print", "AS9100", "ITAR", "titanium", "aluminum", "sheet metal", "assembly", "NADCAP"];

const REL_POOL: Record<string, string[]> = {
  self:       ["government_contract_award", "contract_win", "contract_loss", "capacity_constraint", "quality_escape", "demand_spike", "pricing_pressure", "competitor_won_deal"],
  supplier:   ["supplier_delay", "quality_escape", "capacity_constraint", "pricing_pressure", "regulatory_change"],
  competitor: ["government_contract_award", "contract_win", "competitor_expansion", "hiring_surge"],
  customer:   ["demand_spike", "government_contract_award", "contract_win", "hiring_surge"],
  target:     ["demand_spike", "government_contract_award", "hiring_surge", "contract_win"],
};
const VALUE_EVENTS = new Set(["government_contract_award", "contract_win", "contract_loss"]);

// Weighted relationship mix (excludes self).
function pickRelationship(): string {
  const r = rnd();
  if (r < 0.42) return "target";
  if (r < 0.62) return "customer";
  if (r < 0.82) return "competitor";
  return "supplier";
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
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
let sn = 0;
let cn = 0;

for (const c of COMPANIES) {
  const base = CITY[c.city];
  companies.push({
    id: c.id,
    name: c.name,
    relationship: c.relationship,
    location: { city: c.city, lat: round4(base.lat + (rnd() - 0.5) * 0.2), lon: round4(base.lon + (rnd() - 0.5) * 0.2) },
    needs: sample(CAPABILITY_UNIVERSE, int(2, 5)).sort(),
  });

  const contactCount = int(6, 14); // ~500 total across 50 companies
  for (let i = 0; i < contactCount; i++) {
    cn += 1;
    contacts.push({ id: `con-${String(cn).padStart(4, "0")}`, company_id: c.id, name: `${pick(FIRST)} ${pick(LAST)}`, title: pick(TITLES) });
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
      ...(value !== undefined ? { value } : {}),
      confidence,
      source_quote: quote(ev, c.name, value, rival),
      detected_at: new Date(detectedMs).toISOString(),
    });
  }
}

const write = (file: string, data: unknown) => writeFileSync(join(OUT_DIR, file), JSON.stringify(data, null, 2) + "\n");
write("companies.json", companies);
write("signals.json", signals);
write("contacts.json", contacts);
console.log(`generated ${companies.length} companies, ${signals.length} signals, ${contacts.length} contacts (seed ${SEED})`);
