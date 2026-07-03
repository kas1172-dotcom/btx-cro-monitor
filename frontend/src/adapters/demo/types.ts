export interface DemoProvenance {
  source_type: "demo";
  source_name: string;
  source_mode: "static_snapshot";
}

export interface IntegrationRecord {
  id: string;
  name: string;
  category: string;
  status: "demo_connected" | "available" | "not_connected" | "future";
  demo_file: string;
  production_method: string;
  description: string;
  is_demo: boolean;
}

export interface AssumptionsSnapshot extends DemoProvenance {
  as_of: string;
  is_static_demo: boolean;
  summary: string;
  assumptions: string[];
}
