import companies from "../data/demo/btx/companies.json";
import contacts from "../data/demo/btx/contacts.json";
import opportunities from "../data/demo/btx/opportunities.json";

const token = process.env.HUBSPOT_ACCESS_TOKEN ?? process.env.BTX_HUBSPOT_ACCESS_TOKEN;

interface CompanyRow {
  id: string;
  name: string;
  relationship: string;
  account_status?: string;
  location: { city: string; state?: string; address?: string; postal_code?: string };
  website_url?: string;
}

interface ContactRow {
  id: string;
  company_id: string;
  name: string;
  title: string;
  email?: string;
}

interface OpportunityRow {
  id: string;
  company_id: string;
  name: string;
  value: number;
  stage: string;
  close_date: string;
}

function logSkip(): void {
  console.log("HubSpot seed skipped: set HUBSPOT_ACCESS_TOKEN or BTX_HUBSPOT_ACCESS_TOKEN to seed the sandbox portal.");
}

async function hubspot(path: string, body: unknown): Promise<void> {
  if (!token) return;
  const response = await fetch(`https://api.hubapi.com${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HubSpot ${path} failed ${response.status}: ${text}`);
  }
}

async function batchUpsert(objectType: "companies" | "contacts" | "deals", idProperty: string, inputs: Array<{ id: string; properties: Record<string, unknown> }>): Promise<void> {
  for (let i = 0; i < inputs.length; i += 100) {
    await hubspot(`/crm/v3/objects/${objectType}/batch/upsert`, {
      idProperty,
      inputs: inputs.slice(i, i + 100),
    });
  }
}

if (!token) {
  logSkip();
} else {
  const companyRows = companies as CompanyRow[];
  const contactRows = contacts as ContactRow[];
  const opportunityRows = opportunities as OpportunityRow[];

  await batchUpsert("companies", "btx_demo_id", companyRows.map((company) => ({
    id: company.id,
    properties: {
        name: company.name,
        domain: company.website_url?.replace(/^https?:\/\//, "") ?? `${company.id}.example`,
        city: company.location.city,
        state: company.location.state,
        address: company.location.address,
        zip: company.location.postal_code,
        btx_demo_id: company.id,
        btx_relationship: company.relationship,
        btx_account_status: company.account_status,
      },
  })));

  await batchUpsert("contacts", "btx_demo_id", contactRows.map((contact) => {
    const [firstname, ...rest] = contact.name.split(" ");
    return {
      id: contact.id,
      properties: {
        firstname,
        lastname: rest.join(" "),
        email: contact.email ?? `${contact.id}@demo.btx.example`,
        jobtitle: contact.title,
        btx_demo_id: contact.id,
        btx_company_demo_id: contact.company_id,
      },
    };
  }));

  await batchUpsert("deals", "btx_demo_id", opportunityRows.map((opportunity) => ({
    id: opportunity.id,
      properties: {
        dealname: opportunity.name,
        amount: opportunity.value,
        closedate: opportunity.close_date,
        dealstage: opportunity.stage,
        btx_demo_id: opportunity.id,
        btx_company_demo_id: opportunity.company_id,
      },
  })));

  console.log(`HubSpot seed submitted ${companyRows.length} companies, ${contactRows.length} contacts, ${opportunityRows.length} deals.`);
}
