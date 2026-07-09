export interface SnapshotProvenance {
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

export interface AssumptionsSnapshot extends SnapshotProvenance {
  as_of: string;
  is_static_demo: boolean;
  summary: string;
  assumptions: string[];
}

export interface CrmSnapshotRecord extends SnapshotProvenance {
  account_id: string;
  crm_account_name: string;
  owner: string;
  account_tier: string;
  last_activity_at: string;
  next_step: string;
  relationship_health: string;
  open_pipeline_value: number;
}

export interface CapacitySnapshotRecord extends SnapshotProvenance {
  facility_id: string;
  facility_name: string;
  city: string;
  available_5_axis_hours_next_30d: number;
  available_turning_hours_next_30d: number;
  constraint: string;
  quoted_lead_time_days: number;
  capacity_status: string;
}

export interface PipelineSnapshotRecord extends SnapshotProvenance {
  company_id: string;
  recommended_action: string;
  reason: string;
}

export interface PipelineSnapshot extends SnapshotProvenance {
  as_of: string;
  summary: {
    open_pipeline_value: number;
    weighted_pipeline_value: number;
    priority_accounts: string[];
    top_action: string;
  };
  records: PipelineSnapshotRecord[];
}

export interface OperatingSnapshot {
  crm: CrmSnapshotRecord[];
  capacity: CapacitySnapshotRecord[];
  pipeline: PipelineSnapshot;
  integrations: IntegrationRecord[];
  assumptions: AssumptionsSnapshot;
  publicSignals: {
    signal_count: number;
    news_count: number;
    latest_signal_at: string | null;
    latest_news_date: string | null;
    source_name: string;
    source_mode: "static_snapshot" | "artifact" | "artifact_fallback";
    run_at?: string | null;
    archive_run_count?: number;
    artifact_path?: string;
    stale?: boolean;
    notice?: string | null;
  };
}
