import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

function read(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const css = read("src/ui/styles.css");
const mobileTest = read("tools/test-mobile-e2e.ts");
const ask = read("src/ui/surfaces/AskSurface.tsx");

const finalMobileBlock = css.slice(css.lastIndexOf("@media (max-width: 767px)"));
assert(finalMobileBlock.includes(".brain-rail") && finalMobileBlock.includes("position: fixed") && finalMobileBlock.includes("bottom: 0"), "Final mobile CSS must anchor the cockpit rail at the bottom.");
assert(finalMobileBlock.includes("height: calc(76px + env(safe-area-inset-bottom))"), "Mobile rail must reserve safe-area-aware bottom space.");
assert(finalMobileBlock.includes(".ask-workspace-grid") && finalMobileBlock.includes("display: block"), "Ask mobile must not serialize three desktop panes.");
assert(finalMobileBlock.includes(".ask-workspace-composer") && finalMobileBlock.includes("position: sticky") && finalMobileBlock.includes("bottom: calc(76px + env(safe-area-inset-bottom))"), "Ask composer must remain reachable above the bottom rail.");
assert(finalMobileBlock.includes(".ask-conversation-sidebar") && finalMobileBlock.includes(".ask-citation-panel") && finalMobileBlock.includes("position: fixed"), "Ask history and evidence must become drawers on mobile.");
assert(finalMobileBlock.includes(".capacity-mobile-context"), "Capacity mobile context must be preserved.");
assert(css.includes("min-height: 44px"), "Touch-target minimums must be declared.");

for (const viewport of ["[320, 568]", "[390, 844]", "[414, 896]", "[768, 1024]"]) {
  assert(mobileTest.includes(viewport), `Mobile workflow test must cover ${viewport}.`);
}
for (const route of ["/", "/work", "/accounts", "/ask", "/intelligence/industry-updates", "/prospects", "/map", "/analysis", "/capacity", "/programs", "/deliverables", "/integrations", "/settings"]) {
  assert(mobileTest.includes(`"${route}"`), `Mobile visual baselines must include ${route}.`);
}
assert(mobileTest.includes("assertTouchTargets") && mobileTest.includes("44"), "Mobile E2E must verify 44px touch targets.");
assert(mobileTest.includes("assertBottomRail"), "Mobile E2E must verify bottom rail placement.");
assert(mobileTest.includes("ask-workspace-composer"), "Mobile E2E must verify Ask composer reachability.");
assert(ask.includes("event.key !== \"Escape\"") && ask.includes("setHistoryOpen(false)") && ask.includes("setCitationsOpen(false)"), "Ask drawers must close with Escape.");

console.log("Mobile workflow contract checks passed.");
