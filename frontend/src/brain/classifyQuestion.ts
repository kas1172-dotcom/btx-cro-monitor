import type { TabId } from "../app/surfaces.ts";
import type { QuestionIntent } from "./types.ts";

export interface Classification {
  intent: QuestionIntent;
  activatedTabs: TabId[];
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
  if (has(q, OUTREACH)) return { intent: "outreach", activatedTabs: ["work_queue", "accounts", "analysis"] };
  if (has(q, GEO)) return { intent: "geographic_prospecting", activatedTabs: ["map", "accounts", "programs", "capacity", "analysis"] };
  if (has(q, MARKET)) return { intent: "market_signals", activatedTabs: ["programs", "capacity", "analysis", "accounts"] };
  if (has(q, RISK)) return { intent: "account_risk", activatedTabs: ["analysis", "accounts", "settings"] };
  if (has(q, CAPABILITY)) return { intent: "capabilities", activatedTabs: ["capacity", "analysis", "programs"] };
  if (has(q, BRIEF)) return { intent: "weekly_brief", activatedTabs: ["brief", "programs", "analysis", "accounts", "capacity"] };
  return { intent: "sales_focus", activatedTabs: ["analysis", "accounts", "programs"] };
}
