import assert from "node:assert/strict";
import { normalizeCompanies, normalizeContacts, normalizeOpportunities } from "../src/adapters/live/LiveDataAdapter.ts";

const companies = normalizeCompanies({
  data_provenance: "HubSpot",
  records: [{
    id: "hubspot-company-1",
    name: "Acme Aero",
    relationship: "customer",
    account_status: "active_pipeline",
    business_motion: "grow_existing_business",
    location: { city: "Pittsburgh", lat: 0, lon: 0, state: "PA" },
    needs: ["ITAR"],
  }],
});

const contacts = normalizeContacts({
  data_provenance: "HubSpot",
  records: [{
    id: "hubspot-contact-2",
    company_id: "hubspot-company-1",
    name: "Ari Lee",
    title: "",
  }],
});

const opportunities = normalizeOpportunities({
  data_provenance: "HubSpot",
  records: [{
    id: "hubspot-deal-3",
    company_id: "hubspot-company-1",
    name: "F-35 Bracket",
    value: Number.NaN,
    stage: "proposal",
    close_date: "",
  }],
});

assert.equal(companies[0].location.city, "Pittsburgh");
assert.deepEqual(companies[0].needs, ["ITAR"]);
assert.equal(contacts[0].title, "Contact");
assert.equal(opportunities[0].value, 0);
assert.equal(opportunities[0].stage, "proposal");
assert.match(opportunities[0].close_date, /^\d{4}-\d{2}-\d{2}$/u);

console.log("live adapter mapping ok: HubSpot fixtures normalized");
