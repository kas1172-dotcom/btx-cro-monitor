import { accountPath, parseAppRoute, pathForTab, TAB_TO_ROUTE, workItemPath } from "../src/app/router.ts";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const today = parseAppRoute("/");
assert(today.id === "today" && today.tab === "brief" && today.path === "/today", "root should normalize to Today");

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

const deliverable = parseAppRoute("/deliverables/del-1", "?account=acct-1");
assert(deliverable.id === "deliverables" && deliverable.deliverableId === "del-1", "deliverable route");
assert(deliverable.accountId === "acct-1", "deliverable account query");

const unknown = parseAppRoute("/old-dashboard");
assert(unknown.id === "not_found", "unknown route should be honest not-found");

assert(accountPath("acct 1") === "/accounts/acct%201", "account path encodes ids");
assert(workItemPath("work 1") === "/work/work%201", "work path encodes ids");
assert(pathForTab("brief") === "/today", "brief tab path");
assert(pathForTab("work_queue") === "/work", "work tab path");
assert(pathForTab("hubspot") === "/integrations", "integrations path replaces HubSpot top-level");

const expectedPrimary = ["/today", "/work", "/accounts", "/ask"];
assert(expectedPrimary.every((path) => Object.values(TAB_TO_ROUTE).includes(path)), "primary routes should be registered");

console.log("routing ok: URL routes parse, encode, deep-link, and produce honest not-found states");
