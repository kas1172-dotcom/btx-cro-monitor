import type { World } from "../app/useWorld.ts";
import type { AgentId } from "../agents/runAgent.ts";
import { deliverableTemplateOption } from "../agents/deliverableRegistry.ts";
import { defaultDateAnchor, defaultTripWindow, latestCompletedQuarter } from "../app/dateDefaults.ts";
import { signalHeadline, signalSourceDate, signalSourceName } from "../app/signalProvenance.ts";
import type { Signal } from "../engine/signals/contract.ts";

/**
 * A wizard input value together with where it came from. "account" scope means
 * the value is a claim about this specific account and MUST carry a real
 * source; "market" scope means the value is portfolio- or market-level and is
 * labeled as such instead of being presented as an account fact.
 */
export interface PrefilledField {
  field: string;
  label: string;
  value: string;
  scope: "account" | "market";
  source: string;
  method: string;
  confidence: number | null;
}

export interface WizardPrefill {
  agentId: AgentId;
  inputs: Record<string, unknown>;
  fields: PrefilledField[];
}

const MARKET_SOURCE = "Market-level default";
const DATASET_SOURCE = "Account dataset record";

export function isAccountScopedSignal(signal: Signal): boolean {
  // Convention (see signalProvenance.ts): an absent scope means account-scored.
  return signal.scope === undefined || signal.scope === "specific_account";
}

function accountSignals(world: World, accountId: string): Signal[] {
  return world.analysis.valid
    .filter((signal) => signal.subject_id === accountId && isAccountScopedSignal(signal))
    .sort((a, b) => b.confidence - a.confidence);
}

function signalMatchMethod(signal: Signal): string {
  return signal.relationships?.[0]?.match_method ?? "resolver";
}

/**
 * Build the wizard's prefilled inputs for a template, tracking provenance per
 * field. Every account-scoped field comes from a real record (company, contact,
 * or validated signal); when no record exists the field is omitted or replaced
 * by a market-level value — never fabricated.
 */
export function buildWizardPrefill(agentId: AgentId, world: World, accountId?: string): WizardPrefill {
  const option = deliverableTemplateOption(agentId);
  const fields: PrefilledField[] = [];
  const inputs: Record<string, unknown> = {};

  if (option.requiresAccount) {
    const company = accountId ? world.companies.find((item) => item.id === accountId) : undefined;
    if (company) {
      inputs.accountId = company.id;
      fields.push({
        field: "accountId",
        label: "Account",
        value: company.name,
        scope: "account",
        source: DATASET_SOURCE,
        method: "canonical_account_id",
        confidence: 1,
      });

      const contact = world.contacts.find((item) => item.company_id === company.id);
      if (contact) {
        fields.push({
          field: "contact",
          label: "Primary contact",
          value: `${contact.name} (${contact.title})`,
          scope: "account",
          source: DATASET_SOURCE,
          method: "crm_contact_record",
          confidence: 1,
        });
      }

      if (company.needs.length) {
        const programNeed = company.needs.join(", ");
        if (agentId === "capabilities_assessment") inputs.programNeed = programNeed;
        fields.push({
          field: "programNeed",
          label: "Stated demand",
          value: programNeed,
          scope: "account",
          source: DATASET_SOURCE,
          method: "needs_record",
          confidence: 1,
        });
      } else if (agentId === "capabilities_assessment") {
        fields.push({
          field: "programNeed",
          label: "Stated demand",
          value: "Advanced machining demand typical of the segment",
          scope: "market",
          source: MARKET_SOURCE,
          method: "market_default",
          confidence: null,
        });
      }

      const signal = accountSignals(world, company.id)[0];
      if (signal) {
        fields.push({
          field: "evidence",
          label: "Strongest evidence",
          value: `${signalHeadline(signal)} — ${signalSourceName(signal)}, ${signalSourceDate(signal)}`,
          scope: "account",
          source: signalSourceName(signal),
          method: `signal:${signalMatchMethod(signal)}`,
          confidence: signal.confidence,
        });
      } else {
        fields.push({
          field: "evidence",
          label: "Strongest evidence",
          value: "No validated account signal; the template will use market-level framing.",
          scope: "market",
          source: MARKET_SOURCE,
          method: "market_default",
          confidence: null,
        });
      }
    }
  }

  if (option.requiresQuarter) {
    const quarter = latestCompletedQuarter(defaultDateAnchor(world));
    inputs.quarter = quarter;
    fields.push({
      field: "quarter",
      label: "Quarter",
      value: quarter,
      scope: "market",
      source: "Metric catalog",
      method: "latest_completed_quarter",
      confidence: null,
    });
  }

  if (option.defaultInstructions) inputs.instructions = option.defaultInstructions;
  if (agentId === "board_deck") inputs.audience = "board";
  if (agentId === "weekly_memo") inputs.title = "Weekly CRO Memo";
  if (agentId === "itinerary") {
    const tripWindow = defaultTripWindow(defaultDateAnchor(world));
    const city = world.city ?? world.companies.find((company) => company.location.city)?.location.city ?? "Austin";
    inputs.city = city;
    inputs.startDate = tripWindow.startDate;
    inputs.endDate = tripWindow.endDate;
    inputs.focus = "mixed";
    fields.push(
      {
        field: "city",
        label: "Market",
        value: city,
        scope: "market",
        source: "Account geography",
        method: "market_cluster_default",
        confidence: null,
      },
      {
        field: "dateWindow",
        label: "Trip window",
        value: `${tripWindow.startDate} to ${tripWindow.endDate}`,
        scope: "market",
        source: "Monitor run date",
        method: "next_available_window",
        confidence: null,
      },
      {
        field: "focus",
        label: "Focus",
        value: "Mixed prospect and customer coverage",
        scope: "market",
        source: MARKET_SOURCE,
        method: "market_default",
        confidence: null,
      },
    );
  }
  if (agentId === "analysis_annotation") {
    inputs.metric = "revenue";
    fields.push({
      field: "metric",
      label: "Metric",
      value: "Revenue",
      scope: "market",
      source: "Metric catalog",
      method: "default_metric",
      confidence: null,
    });
  }

  return { agentId, inputs, fields };
}

/**
 * Provenance rule the wizard enforces before generating: an account-scoped
 * claim must carry a real source and confidence; only market-scoped fields may
 * use the market-level default. Returns human-readable violations.
 */
export function validatePrefillProvenance(fields: PrefilledField[]): string[] {
  const violations: string[] = [];
  for (const field of fields) {
    if (field.scope === "account") {
      if (!field.source || field.source === MARKET_SOURCE || field.method === "market_default") {
        violations.push(`Account field "${field.label}" has no real source.`);
      }
      if (field.confidence === null) {
        violations.push(`Account field "${field.label}" has no confidence.`);
      }
    }
    if (field.scope === "market" && field.source !== MARKET_SOURCE && field.method === "market_default") {
      violations.push(`Market field "${field.label}" mislabels its source.`);
    }
  }
  return violations;
}
