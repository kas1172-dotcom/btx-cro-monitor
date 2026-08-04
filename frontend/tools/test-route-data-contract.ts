import { spawn } from "node:child_process";
import { chromium, type Browser, type Page, type Route } from "playwright";
import type { WorldSnapshot } from "../src/app/revenueDataClient.ts";

const BASE_URL = "http://127.0.0.1:4177";
const API_URL = "http://127.0.0.1:49217";
const BUDGET_MS = 1_500;

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv = process.env): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: "inherit" });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${command} ${args.join(" ")} exited ${code}`))));
    child.on("error", reject);
  });
}

async function waitForPreview(): Promise<ReturnType<typeof spawn>> {
  const child = spawn("npm", ["run", "preview", "--", "--host", "127.0.0.1", "--port", "4177", "--strictPort"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  const started = Date.now();
  while (Date.now() - started < 15_000) {
    try {
      const response = await fetch(BASE_URL);
      if (response.ok) return child;
    } catch {
      // preview still starting
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  child.kill("SIGTERM");
  throw new Error("Timed out waiting for Vite preview.");
}

async function stopChild(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      resolve();
    }, 5_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

const snapshot: WorldSnapshot = {
  tenant: { id: "tenant-route-test", displayName: "Route Data Test", isDemonstration: true, demoNotice: "Demonstration — internal records are illustrative" },
  accounts: [
    { id: "acct-1", name: "Lockheed Martin", relationship: "customer", account_status: "current_customer", business_motion: "manage_current_business", location: { city: "Fort Worth", state: "TX", lat: 32.75, lon: -97.33 }, needs: ["5-axis machining"] },
    { id: "acct-2", name: "Pulse Space", relationship: "customer", account_status: "active_pipeline", business_motion: "grow_existing_business", location: { city: "Austin", state: "TX", lat: 30.26, lon: -97.74 }, needs: ["turning"] },
  ],
  contacts: [],
  opportunities: [{ id: "opp-1", company_id: "acct-1", name: "Q2 seed opportunity", value: 2_500_000, stage: "proposal", close_date: "2026-09-30" }],
  programs: [],
  signals: [],
  signalRelationships: [],
  facilities: [],
  operatingFacts: [],
  capacity: null,
  scores: { accountAttractiveness: [], signalConfidence: [], pursuitPwin: [], deliveryFeasibility: [], relationshipHealth: [], actionPriority: [] },
  workItems: [],
  deliverables: [],
  sourceHealth: [
    { sourceKey: "hubspot-demo", displayName: "Illustrative CRM seed", availability: "simulated", lastSuccessfulSyncAt: "2026-07-26T12:00:00Z", lastAttemptAt: "2026-07-26T12:00:00Z", freshnessThresholdMinutes: 15, recordCount: 2, errorCode: null, errorMessage: null, connectionMode: "snapshot_loaded", environment: "developer", dataMode: "simulated_internal", canRead: true, canWrite: false },
    { sourceKey: "monitor", displayName: "Monitor pipeline", availability: "stale", lastSuccessfulSyncAt: "2026-07-25T12:00:00Z", lastAttemptAt: "2026-07-26T12:00:00Z", freshnessThresholdMinutes: 60, recordCount: 0, errorCode: null, errorMessage: null, connectionMode: "snapshot_loaded", environment: "none", dataMode: "stored_snapshot", canRead: true, canWrite: false },
  ],
  generatedAt: "2026-07-26T12:00:00Z",
  dataVersion: "route-test",
};

async function routeWorldSnapshot(page: Page, handler: (route: Route) => Promise<void> | void): Promise<void> {
  await page.route(`${API_URL}/world-snapshot`, handler);
}

async function newPage(browser: Browser): Promise<Page> {
  return browser.newPage({ viewport: { width: 1280, height: 900 } });
}

async function assertShellNavigable(page: Page): Promise<void> {
  await page.getByRole("link", { name: /^Work/i }).click();
  await page.locator("[data-surface-component='surface-route-work']").waitFor({ timeout: BUDGET_MS });
}

async function coldDeepLink(browser: Browser): Promise<void> {
  const page = await newPage(browser);
  await routeWorldSnapshot(page, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(snapshot) }));
  await page.goto(`${BASE_URL}/accounts/acct-1`);
  await page.locator("[data-surface-component='surface-account-360']").waitFor({ timeout: 5_000 });
  assert(await page.getByText("Lockheed Martin").first().isVisible(), "cold account deep link did not render destination data");
  await page.close();
}

async function slowApiKeepsNavigation(browser: Browser): Promise<void> {
  const page = await newPage(browser);
  let release: (() => void) | null = null;
  await routeWorldSnapshot(page, async (route) => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(snapshot) });
  });
  await page.goto(`${BASE_URL}/analysis`);
  const started = Date.now();
  await page.locator("[data-surface-component='surface-route-analysis']").waitFor({ timeout: BUDGET_MS });
  assert(Date.now() - started < BUDGET_MS, "slow API skeleton missed the performance budget");
  await assertShellNavigable(page);
  release?.();
  await page.locator("[data-surface-component='surface-work-queue']").waitFor({ timeout: 5_000 });
  await page.close();
}

async function rejectedRetryAndAuth(browser: Browser): Promise<void> {
  const page = await newPage(browser);
  let attempts = 0;
  await routeWorldSnapshot(page, (route) => {
    attempts += 1;
    if (attempts === 1) return route.fulfill({ status: 503, contentType: "text/plain", body: "database warming" });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(snapshot) });
  });
  await page.goto(`${BASE_URL}/work`);
  await page.getByRole("alert").waitFor({ timeout: 5_000 });
  assert(await page.getByText(/database warming/i).isVisible(), "rejected API details were not visible");
  await page.getByRole("button", { name: "Retry" }).click();
  await page.locator("[data-surface-component='surface-work-queue']").waitFor({ timeout: 5_000 });

  const authPage = await newPage(browser);
  await routeWorldSnapshot(authPage, (route) => route.fulfill({ status: 401, contentType: "text/plain", body: "session expired" }));
  await authPage.goto(`${BASE_URL}/capacity`);
  await authPage.getByRole("alert").waitFor({ timeout: 5_000 });
  assert(await authPage.getByText(/session may have expired/i).isVisible(), "auth expiry was not identified");
  await authPage.close();
  await page.close();
}

async function offlineAndCachedNavigation(browser: Browser): Promise<void> {
  const page = await newPage(browser);
  let calls = 0;
  await routeWorldSnapshot(page, (route) => {
    calls += 1;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(snapshot) });
  });
  await page.goto(`${BASE_URL}/accounts/acct-2`);
  await page.locator("[data-surface-component='surface-account-360']").waitFor({ timeout: 5_000 });
  await page.getByRole("link", { name: /^Work/i }).click();
  await page.locator("[data-surface-component='surface-work-queue']").waitFor({ timeout: 5_000 });
  assert(calls === 1, `cached navigation should reuse the world snapshot, got ${calls} API calls`);
  await page.close();

  const offlinePage = await newPage(browser);
  await routeWorldSnapshot(offlinePage, (route) => route.abort("internetdisconnected"));
  await offlinePage.goto(`${BASE_URL}/map`);
  await offlinePage.getByRole("alert").waitFor({ timeout: 5_000 });
  assert(await offlinePage.getByText(/data service rejected|browser appears offline/i).isVisible(), "offline/API failure was not surfaced");
  await offlinePage.close();
}

const buildEnv = { ...process.env, VITE_BASE_PATH: "/", VITE_DEPLOYMENT_MODE: "demo", VITE_BACKEND_ENDPOINT: API_URL };
delete buildEnv.VITE_CLERK_PUBLISHABLE_KEY;
await run("npm", ["run", "build"], buildEnv);
await run("npx", ["playwright", "install", "chromium"]);
const preview = await waitForPreview();
let browser: Browser | null = null;
try {
  browser = await chromium.launch();
  await coldDeepLink(browser);
  await slowApiKeepsNavigation(browser);
  await rejectedRetryAndAuth(browser);
  await offlineAndCachedNavigation(browser);
  console.log("route data contract ok: cold, slow, rejected, offline, auth, retry, and cache paths verified");
} finally {
  if (browser) await browser.close();
  await stopChild(preview);
}
process.exit(0);
