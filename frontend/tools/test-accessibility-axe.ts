import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { createServer, type Server, type ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { chromium, type Browser, type Page } from "playwright";

const require = createRequire(import.meta.url);
const BASE_URL = "http://127.0.0.1:4186";
const API_URL = "http://127.0.0.1:4187";
const ROUTES = ["/settings", "/prospects", "/accounts", "/ask"];

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "access-control-allow-origin": BASE_URL,
    "access-control-allow-headers": "authorization,content-type",
    "access-control-allow-methods": "GET,POST,PATCH,OPTIONS",
    "content-type": "application/json",
  });
  response.end(JSON.stringify(body));
}

function score(entityId: string, value: number) {
  return {
    id: `axe-score-${entityId}`,
    entityType: "account",
    entityId,
    scoreFamily: "accountAttractiveness",
    status: "available",
    score: value,
    result: {
      score: value,
      status: "available",
      dataCompleteness: 1,
      positiveFactors: [],
      negativeFactors: [],
      neutralFactors: [],
      missingInputs: [],
      hardGateFailures: [],
      evidenceIds: [],
      configurationVersion: "axe-smoke",
      sourceDataVersion: "axe-smoke",
      calculatedAt: "2026-07-31T12:00:00Z",
    },
    configurationVersion: "axe-smoke",
    sourceDataVersion: "axe-smoke",
    calculatedAt: "2026-07-31T12:00:00Z",
  };
}

function worldSnapshot() {
  const accounts = [
    { id: "axe-account-1", canonical_account_id: "axe-account-1", name: "Axe Account One", relationship: "customer", account_status: "current_customer", business_motion: "grow_existing_business", location: { city: "Chicago", state: "IL", country: "US", lat: 41.88, lon: -87.62 }, needs: ["5-axis machining"], hubspot_company_id: "9001" },
    { id: "axe-account-2", canonical_account_id: "axe-account-2", name: "Axe Prospect Two", relationship: "target", account_status: "target_prospect", business_motion: "prospect_new_business", location: { city: "Austin", state: "TX", country: "US", lat: 30.26, lon: -97.74 }, needs: ["precision turning"], hubspot_company_id: "9002" },
  ];
  const contacts = [
    { id: "axe-contact-1", company_id: "axe-account-1", name: "Rae Morgan", title: "VP Supply Chain" },
    { id: "axe-contact-2", company_id: "axe-account-2", name: "Sam Lee", title: "Plant Manager" },
  ];
  return {
    tenant: { id: "axe-smoke", displayName: "Axe smoke", isDemonstration: true, demoNotice: "Demonstration — internal records are illustrative" },
    accounts,
    contacts,
    opportunities: [{ id: "axe-opp-1", company_id: "axe-account-1", name: "Axe opportunity", value: 500000, stage: "qualified", close_date: "2026-09-30" }],
    programs: [],
    signals: [],
    signalRelationships: [],
    facilities: [],
    operatingFacts: [],
    capacity: null,
    scores: { accountAttractiveness: [score("axe-account-1", 82), score("axe-account-2", 76)], signalConfidence: [], pursuitPwin: [], deliveryFeasibility: [], relationshipHealth: [], actionPriority: [] },
    workItems: [],
    deliverables: [],
    sourceHealth: [
      { sourceKey: "hubspot-axe", displayName: "Axe CRM smoke fixture", availability: "simulated", lastSuccessfulSyncAt: "2026-07-31T12:00:00Z", lastAttemptAt: "2026-07-31T12:00:00Z", freshnessThresholdMinutes: 15, recordCount: accounts.length, errorCode: null, errorMessage: "Axe smoke fixture.", connectionMode: "snapshot_loaded", environment: "developer", dataMode: "simulated_internal", canRead: true, canWrite: false },
      { sourceKey: "monitor", displayName: "Axe monitor smoke fixture", availability: "stale", lastSuccessfulSyncAt: "2026-07-31T12:00:00Z", lastAttemptAt: "2026-07-31T12:00:00Z", freshnessThresholdMinutes: 60, recordCount: 0, errorCode: null, errorMessage: null, connectionMode: "snapshot_loaded", environment: "none", dataMode: "stored_snapshot", canRead: true, canWrite: false },
    ],
    generatedAt: "2026-07-31T12:00:00Z",
    dataVersion: "axe-smoke",
  };
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv = process.env): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: "inherit" });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${command} ${args.join(" ")} exited ${code}`))));
    child.on("error", reject);
  });
}

async function startApi(): Promise<Server> {
  const world = worldSnapshot();
  const server = createServer((request, response) => {
    if (request.method === "OPTIONS") return json(response, 204, {});
    const path = new URL(request.url ?? "/", API_URL).pathname;
    if (path === "/health") return json(response, 200, { status: "ok" });
    if (path === "/environment") return json(response, 200, { deploymentMode: "demo", isDemonstration: true, displayLabel: "Demonstration", demoNotice: "Demonstration — internal records are illustrative", tenant: { id: "axe-smoke" }, auth: { provider: "clerk", keyClass: "unconfigured", configured: false }, source: { type: "axe_smoke_fixture", dataProvenance: "Axe smoke fixture" }, externalWrites: { capable: false }, revision: { deployed: "779198f", expected: "779198f", seed: "779198f", matchesExpected: true } });
    if (path === "/world-snapshot") return json(response, 200, world);
    if (path === "/source-health") return json(response, 200, { records: world.sourceHealth });
    return json(response, 404, { error: "not_found" });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(4187, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  return server;
}

async function waitForPreview(): Promise<ReturnType<typeof spawn>> {
  const child = spawn("npm", ["run", "preview", "--", "--host", "127.0.0.1", "--port", "4186", "--strictPort"], { stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  const started = Date.now();
  while (Date.now() - started < 15_000) {
    try {
      const response = await fetch(BASE_URL);
      if (response.ok) return child;
    } catch {
      // still starting
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  child.kill("SIGTERM");
  throw new Error("Timed out waiting for axe preview.");
}

async function runAxe(page: Page, route: string, axeSource: string): Promise<void> {
  await page.goto(`${BASE_URL}${route}`, { waitUntil: "networkidle" });
  await page.locator("[data-surface-component]").first().waitFor({ timeout: 15_000 });
  await page.addScriptTag({ content: axeSource });
  const results = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (node: Document, options: unknown) => Promise<{ violations: Array<{ id: string; impact: string | null; help: string; nodes: Array<{ target: string[] }> }> }> } }).axe;
    return axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } });
  });
  const failures = results.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
  assert(failures.length === 0, `${route} axe failures: ${failures.map((violation) => `${violation.id}: ${violation.help} at ${violation.nodes.map((node) => `${node.target.join(", ")} ${JSON.stringify(node)}`).join(" ; ")}`).join(" | ")}`);
}

const api = await startApi();
await run("npm", ["run", "build"], { ...process.env, VITE_BASE_PATH: "/", VITE_BACKEND_ENDPOINT: API_URL, VITE_DEPLOYMENT_MODE: "demo", VITE_TENANT_ID: "axe-smoke", VITE_DEPLOYED_REVISION: "779198f" });
const preview = await waitForPreview();
let browser: Browser | null = null;
try {
  const axeSource = await readFile(require.resolve("axe-core/axe.min.js"), "utf8");
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  for (const route of ROUTES) await runAxe(page, route, axeSource);
  await page.close();
} finally {
  if (browser) await browser.close();
  preview.kill("SIGTERM");
  api.close();
}

console.log(`axe accessibility ok: ${ROUTES.join(", ")}`);
process.exit(0);
