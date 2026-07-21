// Static BTX demo adapter. It implements the same port a future live API adapter
// will implement, but reads Vite-bundled JSON snapshots from data/demo/btx/.

import companiesData from "../../../data/demo/btx/companies.json";
import signalsData from "../../../data/demo/btx/signals.json";
import contactsData from "../../../data/demo/btx/contacts.json";
import facilitiesData from "../../../data/demo/btx/facilities.json";
import opportunitiesData from "../../../data/demo/btx/opportunities.json";
import crmData from "../../../data/demo/btx/crm.json";
import capacityData from "../../../data/demo/btx/erp_capacity.json";
import pipelineData from "../../../data/demo/btx/pipeline.json";
import integrationsData from "../../../data/demo/btx/integrations.json";
import assumptionsData from "../../../data/demo/btx/assumptions.json";
import newsData from "../../../data/demo/btx/news.json";

import type { DataAdapter, RegionFilter } from "../../engine/brain/ports.ts";
import type { Company, Contact, Facility, Opportunity } from "../../engine/brain/entities.ts";
import type { AssumptionsSnapshot, CapacitySnapshotRecord, CrmSnapshotRecord, IntegrationRecord, OperatingSnapshot, PipelineSnapshot } from "../../engine/brain/operatingSnapshot.ts";

const ALL_COMPANIES = companiesData as unknown as Company[];
const ALL_SIGNALS = signalsData as unknown as Array<{ subject_id: string; detected_at?: string }>;
const ALL_CONTACTS = contactsData as unknown as Contact[];
const ALL_FACILITIES = facilitiesData as unknown as Facility[];
const ALL_OPPORTUNITIES = opportunitiesData as unknown as Opportunity[];
const CRM = crmData as CrmSnapshotRecord[];
const CAPACITY = capacityData as CapacitySnapshotRecord[];
const PIPELINE = pipelineData as PipelineSnapshot;
const INTEGRATIONS = (integrationsData as Array<Partial<IntegrationRecord> & { demo_file?: string }>).map((item) => ({
  id: item.id ?? "fixture",
  name: item.name ?? "Fixture",
  category: item.category ?? "Fixture data",
  status: (item.status === "future" ? "future" : "available") as IntegrationRecord["status"],
  source_ref: item.demo_file ?? "frontend/data/demo/btx/",
  production_method: item.production_method ?? "Fixture JSON",
  description: item.description ?? "",
  source_kind: "seeded" as const,
}));
const ASSUMPTIONS = assumptionsData as unknown as AssumptionsSnapshot;
const NEWS = newsData as Array<{ published_date?: string }>;

export class DemoDataAdapter implements DataAdapter {
  async getCompanies(filter?: RegionFilter): Promise<Company[]> {
    return filter?.city ? ALL_COMPANIES.filter((c) => c.location.city === filter.city) : ALL_COMPANIES;
  }

  async getSignals(filter?: RegionFilter): Promise<unknown[]> {
    if (!filter?.city) return ALL_SIGNALS;
    const ids = new Set((await this.getCompanies(filter)).map((c) => c.id));
    return ALL_SIGNALS.filter((s) => ids.has(s.subject_id));
  }

  async getContacts(filter?: RegionFilter): Promise<Contact[]> {
    if (!filter?.city) return ALL_CONTACTS;
    const ids = new Set((await this.getCompanies(filter)).map((c) => c.id));
    return ALL_CONTACTS.filter((c) => ids.has(c.company_id));
  }

  async getFacilities(filter?: RegionFilter): Promise<Facility[]> {
    return filter?.city ? ALL_FACILITIES.filter((f) => f.city === filter.city) : ALL_FACILITIES;
  }

  async getOpportunities(filter?: RegionFilter): Promise<Opportunity[]> {
    if (!filter?.city) return ALL_OPPORTUNITIES;
    const ids = new Set((await this.getCompanies(filter)).map((c) => c.id));
    return ALL_OPPORTUNITIES.filter((o) => ids.has(o.company_id));
  }

  async getOperatingSnapshot(): Promise<OperatingSnapshot> {
    const latestSignal = ALL_SIGNALS
      .map((s) => s.detected_at)
      .filter((d): d is string => Boolean(d))
      .sort()
      .at(-1) ?? null;
    const latestNews = NEWS
      .map((n) => n.published_date)
      .filter((d): d is string => Boolean(d))
      .sort()
      .at(-1) ?? null;

    return {
      crm: CRM.map((row) => ({ ...row, source_type: "seeded_baseline", source_name: "Seeded baseline — ERP integration pending", source_mode: "seeded_baseline" })),
      capacity: CAPACITY.map((row) => ({ ...row, source_type: "seeded_baseline", source_name: "Seeded baseline — ERP integration pending", source_mode: "seeded_baseline" })),
      pipeline: {
        ...PIPELINE,
        source_type: "seeded_baseline",
        source_name: "Seeded baseline — ERP integration pending",
        source_mode: "seeded_baseline",
        records: PIPELINE.records.map((row) => ({ ...row, source_type: "seeded_baseline", source_name: "Seeded baseline — ERP integration pending", source_mode: "seeded_baseline" })),
      },
      integrations: INTEGRATIONS,
      assumptions: {
        ...ASSUMPTIONS,
        source_type: "seeded_baseline",
        source_name: "Seeded baseline — ERP integration pending",
        source_mode: "seeded_baseline",
        is_seeded_baseline: true,
        summary: "Seeded baseline — ERP integration pending",
      },
      publicSignals: {
        signal_count: ALL_SIGNALS.length,
        news_count: NEWS.length,
        latest_signal_at: latestSignal,
        latest_news_date: latestNews,
        source_name: "Seeded signals + public news",
        source_mode: "seeded_signals",
      },
    };
  }
}
