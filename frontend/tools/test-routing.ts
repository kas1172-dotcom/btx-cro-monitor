import { accountPath, deliverablePath, figureInsertPath, figureSpecFromRoute, parseAppRoute, pathForTab, TAB_TO_ROUTE, workItemPath } from "../src/app/router.ts";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const today = parseAppRoute("/");
assert(today.id === "today" && today.tab === "brief" && today.path === "/today", "root should normalize to Today");
const briefing = parseAppRoute("/briefing");
assert(briefing.id === "today" && briefing.tab === "brief", "labelled briefing URL should resolve");

const account = parseAppRoute("/accounts/acct-123");
assert(account.id === "accounts", "account route id");
assert(account.tab === "accounts", "account route tab");
assert(account.accountId === "acct-123", "account route id decode");

const work = parseAppRoute("/work/work-7", "?status=awaiting_approval");
assert(work.id === "work", "work route id");
assert(work.workItemId === "work-7", "work item id");
assert(work.query.get("status") === "awaiting_approval", "work status query");

const map = parseAppRoute("/map", "?account=acct-456&region=Austin");
assert(map.id === "map", "map route id");
assert(map.accountId === "acct-456", "map account query");
assert(map.query.get("region") === "Austin", "map region query");

const conversation = parseAppRoute("/ask/convo-9");
assert(conversation.id === "ask" && conversation.conversationId === "convo-9", "ask conversation route");

const industryUpdates = parseAppRoute("/intelligence/industry-updates");
assert(industryUpdates.id === "industry_updates" && industryUpdates.tab === "industry_updates", "industry updates route");

const deliverable = parseAppRoute("/deliverables/del-1", "?account=acct-1");
assert(deliverable.id === "deliverables" && deliverable.deliverableId === "del-1", "deliverable route");
assert(deliverable.deliverableView === "document", "saved document view is identified by the URL");
assert(deliverable.accountId === "acct-1", "deliverable account query");

const focusedDeliverable = parseAppRoute("/deliverables/del-1", "?view=focus");
assert(focusedDeliverable.deliverableView === "document" && focusedDeliverable.query.get("view") === "focus", "focus mode survives deep link and refresh parsing");

const insertFigure = parseAppRoute("/deliverables/figures/new", "?metric=margin_trend&viz=trend&rows=segment&cols=month");
assert(insertFigure.deliverableView === "insert_figure" && insertFigure.deliverableId === null, "figure insertion has an explicit nested route");
assert(figureSpecFromRoute(insertFigure).metric === "margin_trend" && figureSpecFromRoute(insertFigure).viz === "trend", "figure setup is reconstructed from URL state");
assert(figureSpecFromRoute(parseAppRoute("/deliverables/figures/new", "?metric=made_up&viz=nope")).metric === "revenue", "invalid figure URL state falls back safely");

const unknown = parseAppRoute("/old-dashboard");
assert(unknown.id === "not_found", "unknown route should be honest not-found");

assert(accountPath("acct 1") === "/accounts/acct%201", "account path encodes ids");
assert(workItemPath("work 1") === "/work/work%201", "work path encodes ids");
assert(deliverablePath("deliverable 1") === "/deliverables/deliverable%201", "deliverable path encodes ids");
assert(figureInsertPath().startsWith("/deliverables/figures/new?"), "figure insert helper preserves Deliverables navigation ownership");
assert(pathForTab("brief") === "/today", "brief tab path");
assert(pathForTab("work_queue") === "/work", "work tab path");
assert(pathForTab("hubspot") === "/integrations", "integrations path replaces HubSpot top-level");
assert(pathForTab("industry_updates") === "/intelligence/industry-updates", "industry updates nested route");

const expectedPrimary = ["/today", "/work", "/accounts", "/ask"];
assert(expectedPrimary.every((path) => Object.values(TAB_TO_ROUTE).includes(path)), "primary routes should be registered");

// Model browser history for insert/cancel/insert and cross-navigation through Work.
const history = ["/deliverables", figureInsertPath(), "/deliverables", figureInsertPath(), "/deliverables/del-1", "/work/work-7"];
let cursor = history.length - 1;
cursor -= 1;
assert(parseAppRoute(new URL(history[cursor], "https://example.test").pathname).deliverableView === "document", "Back from Work restores saved-document UI and URL");
cursor -= 1;
assert(parseAppRoute(new URL(history[cursor], "https://example.test").pathname).deliverableView === "insert_figure", "Back restores the figure hub without global state");
cursor += 1;
assert(parseAppRoute(new URL(history[cursor], "https://example.test").pathname).deliverableId === "del-1", "Forward restores the selected saved document");

console.log("routing ok: deep links, refresh state, focus, insert/cancel/insert, and Work back/forward are URL-owned");
