import type { DataAdapter, RegionFilter } from "../../engine/brain/ports.ts";
import type { Company, Contact, Facility, Opportunity } from "../../engine/brain/entities.ts";
import type { OperatingSnapshot } from "../../engine/brain/operatingSnapshot.ts";

const MESSAGE = "Artifact data mode is reserved for a future /artifacts/brain_output.json snapshot. Use VITE_DATA_MODE=demo.";

export class ArtifactDataAdapter implements DataAdapter {
  private fail(): never {
    throw new Error(MESSAGE);
  }

  async getCompanies(_filter?: RegionFilter): Promise<Company[]> {
    this.fail();
  }

  async getSignals(_filter?: RegionFilter): Promise<unknown[]> {
    this.fail();
  }

  async getContacts(_filter?: RegionFilter): Promise<Contact[]> {
    this.fail();
  }

  async getFacilities(_filter?: RegionFilter): Promise<Facility[]> {
    this.fail();
  }

  async getOpportunities(_filter?: RegionFilter): Promise<Opportunity[]> {
    this.fail();
  }

  async getOperatingSnapshot(): Promise<OperatingSnapshot> {
    this.fail();
  }
}
