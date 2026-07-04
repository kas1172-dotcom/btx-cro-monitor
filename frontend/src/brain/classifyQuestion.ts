import type { BrainArea, QuestionIntent } from "./types.ts";

export interface Classification {
  intent: QuestionIntent;
  activatedBrainAreas: BrainArea[];
}

const GEO = ["austin", "dallas", "houston", "san antonio", "waco", "visit", "trip", "nearby", "map", "where", "talk to"];
const MARKET = ["defense", "funding", "signal", "market", "contract", "program", "competitor", "news"];
const RISK = ["risk", "at risk", "protect", "churn", "delay", "quality", "slip", "quarter"];
const CAPABILITY = ["produce", "production", "capacity", "capability", "fit", "5-axis", "machining", "itar", "as9100", "build"];
const BRIEF = ["weekly", "this week", "care about", "brief", "today"];
const OUTREACH = ["draft", "email", "outreach", "message"];

function has(q: string, terms: string[]): boolean {
  return terms.some((term) => q.includes(term));
}

export function classifyQuestion(question: string): Classification {
  const q = question.toLowerCase();
  if (has(q, OUTREACH)) return { intent: "outreach", activatedBrainAreas: ["workflow", "customer", "revenue"] };
  if (has(q, GEO)) return { intent: "geographic_prospecting", activatedBrainAreas: ["geographic", "customer", "market", "capability", "revenue"] };
  if (has(q, MARKET)) return { intent: "market_signals", activatedBrainAreas: ["market", "capability", "revenue", "customer"] };
  if (has(q, RISK)) return { intent: "account_risk", activatedBrainAreas: ["revenue", "customer", "decision"] };
  if (has(q, CAPABILITY)) return { intent: "capabilities", activatedBrainAreas: ["capability", "revenue", "market"] };
  if (has(q, BRIEF)) return { intent: "weekly_brief", activatedBrainAreas: ["market", "revenue", "customer", "capability"] };
  return { intent: "sales_focus", activatedBrainAreas: ["revenue", "customer", "market"] };
}
