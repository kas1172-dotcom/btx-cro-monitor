// Pure analysis layer: turns adapter data into everything the UI renders, using
// only the deterministic engine. No React here; views consume these outputs.
// This is the single path from data -> validation -> scoring -> fit -> dossier.

import { validateSignals } from "../engine/validation/validate.ts";
import { scorePortfolio, deriveAlerts } from "../engine/decision/portfolio.ts";
import { applySelfLens } from "../engine/decision/lens.ts";
import { scoreFit } from "../engine/decision/fit.ts";
import { CONFIG, PROFILE } from "./config.ts";

import type { Company, Contact } from "../engine/brain/entities.ts";
import type { CompanyScore } from "../engine/decision/score.ts";
import type { FitResult } from "../engine/decision/fit.ts";
import type { Signal } from "../engine/signals/contract.ts";
import type { Alert } from "../engine/decision/portfolio.ts";
import type { PerspectiveScore } from "../engine/decision/lens.ts";

export interface Analysis {
  valid: Signal[];
  scores: CompanyScore[];
  byId: Map<string, CompanyScore>;
  alerts: Alert[];
  persp: PerspectiveScore | null;
}

export function analyze(companies: Company[], rawSignals: unknown[]): Analysis {
  const { valid } = validateSignals(rawSignals, CONFIG.min_confidence);
  const scores = scorePortfolio(companies.map((c) => c.id), valid, CONFIG);
  const byId = new Map(scores.map((s) => [s.subject_id, s]));
  const alerts = deriveAlerts(scores, CONFIG);
  const persp = applySelfLens(companies, scores, CONFIG);
  return { valid, scores, byId, alerts, persp };
}

export interface Prospect {
  company: Company;
  opportunity: number;
  fit: FitResult;
  contact: Contact | undefined;
  topSignal: Signal | undefined;
  score: CompanyScore;
}

/** Build sellable-prospect dossiers (targets + existing customers), ranked by a
 *  presentation blend of opportunity + fit so a 0%-fit account can't top the list. */
export function buildProspects(
  companies: Company[],
  contacts: Contact[],
  valid: Signal[],
  byId: Map<string, CompanyScore>,
): Prospect[] {
  return companies
    .filter((c) => c.relationship === "target" || c.relationship === "customer")
    .map((c) => {
      const score = byId.get(c.id) as CompanyScore;
      const fit = scoreFit(c.needs, PROFILE.capabilities);
      const contact = contacts.find((k) => k.company_id === c.id);
      const topSignal = valid
        .filter((s) => s.subject_id === c.id)
        .sort((a, b) => b.confidence - a.confidence)[0];
      return { company: c, opportunity: score.dimensions.opportunity.score, fit, contact, topSignal, score };
    })
    .sort(
      (a, b) =>
        b.opportunity + b.fit.score - (a.opportunity + a.fit.score) ||
        a.company.id.localeCompare(b.company.id),
    );
}
