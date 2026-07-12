import { ArtifactDataAdapter } from "../artifact/ArtifactDataAdapter.ts";
import { DemoDataAdapter } from "../demo/DemoDataAdapter.ts";
import { LiveDataAdapter } from "../live/LiveDataAdapter.ts";
import type { DataAdapter, RegionFilter } from "../../engine/brain/ports.ts";
import type { Company, Contact, Facility, Opportunity } from "../../engine/brain/entities.ts";
import type { OperatingSnapshot } from "../../engine/brain/operatingSnapshot.ts";

function demoFallbackSnapshot(snapshot: OperatingSnapshot): OperatingSnapshot {
  return {
    ...snapshot,
    crm: snapshot.crm.map((row) => ({ ...row, source_name: "Demo fallback", source_mode: "static_snapshot" })),
    capacity: snapshot.capacity.map((row) => ({ ...row, source_name: "Demo fallback", source_mode: "static_snapshot" })),
    pipeline: { ...snapshot.pipeline, source_name: "Demo fallback", source_mode: "static_snapshot" },
    assumptions: {
      ...snapshot.assumptions,
      source_name: "Demo fallback",
      source_mode: "static_snapshot",
      summary: `${snapshot.assumptions.summary} Capacity, ERP, and operating assumptions are demo fallback data in hybrid mode.`,
    },
  };
}

export class HybridDataAdapter implements DataAdapter {
  private live = new LiveDataAdapter();
  private artifact = new ArtifactDataAdapter(this.live);
  private demo = new DemoDataAdapter();

  getCompanies(filter?: RegionFilter): Promise<Company[]> {
    return this.live.getCompanies(filter);
  }

  getSignals(filter?: RegionFilter): Promise<unknown[]> {
    return this.artifact.getSignals(filter);
  }

  getContacts(filter?: RegionFilter): Promise<Contact[]> {
    return this.live.getContacts(filter);
  }

  getFacilities(filter?: RegionFilter): Promise<Facility[]> {
    return this.demo.getFacilities(filter);
  }

  getOpportunities(filter?: RegionFilter): Promise<Opportunity[]> {
    return this.live.getOpportunities(filter);
  }

  async getOperatingSnapshot(): Promise<OperatingSnapshot> {
    const [demoSnapshot, artifactSnapshot] = await Promise.all([
      this.demo.getOperatingSnapshot(),
      this.artifact.getOperatingSnapshot(),
    ]);
    return {
      ...demoFallbackSnapshot(demoSnapshot),
      integrations: [
        {
          id: "hubspot",
          name: "Live CRM",
          category: "CRM",
          status: "demo_connected",
          demo_file: "",
          production_method: "btx_platform CRM adapter",
          description: "Live companies, contacts, and deals.",
          is_demo: false,
        },
        {
          id: "monitor-artifacts",
          name: "Monitor artifacts",
          category: "Market signals",
          status: artifactSnapshot.publicSignals.source_mode === "artifact" ? "demo_connected" : "not_connected",
          demo_file: artifactSnapshot.publicSignals.artifact_path ?? "",
          production_method: "GitHub Pages monitor-engine artifacts",
          description: artifactSnapshot.publicSignals.notice ?? "Real monitor-engine signals from published artifacts.",
          is_demo: false,
        },
        {
          id: "demo-fallback",
          name: "Demo fallback",
          category: "Capacity and operating context",
          status: "available",
          demo_file: "frontend/data/demo/btx/",
          production_method: "Static fallback until ERP/capacity integrations are added",
          description: "Facilities, capacity, assumptions, and non-integrated operating context.",
          is_demo: true,
        },
      ],
      publicSignals: artifactSnapshot.publicSignals,
    };
  }
}
