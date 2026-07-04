const LABELS: Record<string, string> = {
  capacity_constraint: "Capacity constraint",
  supplier_delay: "Supplier delay",
  quality_escape: "Quality escape",
  pricing_pressure: "Pricing pressure",
  regulatory_change: "Regulatory change",
  contract_loss: "Contract loss",
  government_contract_award: "Government contract award",
  contract_win: "Contract win",
  demand_spike: "Demand spike",
  hiring_surge: "Hiring surge",
  current_customer: "Current customer",
  active_pipeline: "Active pipeline",
  past_customer: "Past customer",
  target_prospect: "Target prospect",
  new_logo: "New logo",
  partner: "Partner",
  competitor: "Competitor",
};

export function displayLabel(value: string | undefined): string {
  if (!value) return "";
  return LABELS[value] ?? value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}
