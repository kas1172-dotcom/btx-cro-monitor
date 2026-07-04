import type { World } from "../app/useWorld.ts";
import type { OpportunityCard } from "./types.ts";
import { retrieveContext } from "./retrieveContext.ts";
import { generateBrainResponse } from "./generateBrainResponse.ts";

export function scoreOpportunities(world: World): OpportunityCard[] {
  const ctx = retrieveContext("What should sales focus on?", "sales_focus", ["revenue", "customer", "market"], world);
  return generateBrainResponse(ctx, world).relatedOpportunities;
}
