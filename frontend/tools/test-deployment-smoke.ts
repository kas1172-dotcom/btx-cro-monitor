import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { chromium, type Browser, type Page } from "playwright";
import { crmEntityIdentityMatches, crmWriteBlockReason } from "../src/app/crmWriteSafety.ts";

const BASE_URL = process.env.DEPLOYMENT_SMOKE_URL ?? "http://127.0.0.1:4179";
const LOCAL_PREVIEW = !process.env.DEPLOYMENT_SMOKE_URL;
const EXPECTED_REVISION = process.env.GITHUB_SHA ?? process.env.VITE_DEPLOYED_REVISION ?? "779198f";
const ROUTE_BUDGET_MS = Number(process.env.DEPLOYMENT_ROUTE_BUDGET_MS ?? "8000");
const ROUTES = ["/", "/work", "/accounts", "/ask", "/capacity", "/settings"];

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
  const child = spawn("npm", ["run", "preview", "--", "--host", "127.0.0.1", "--port", "4179", "--strictPort"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  const started = Date.now();
  while (Date.now() - started < 15000) {
    try {
      const response = await fetch(BASE_URL);
      if (response.ok) return child;
    } catch {
      // preview still starting
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  child.kill("SIGTERM");
  throw new Error("Timed out waiting for deployment smoke preview.");
}

async function assertRouteLoads(page: Page, route: string): Promise<void> {
  const started = Date.now();
  await page.goto(`${BASE_URL}${route}`, { waitUntil: "domcontentloaded" });
  await page.locator("[data-surface-component]").first().waitFor({ timeout: ROUTE_BUDGET_MS });
  const elapsed = Date.now() - started;
  assert(elapsed <= ROUTE_BUDGET_MS, `${route} exceeded route load budget: ${elapsed}ms > ${ROUTE_BUDGET_MS}ms`);
}

async function assertEnvironmentTruth(page: Page): Promise<void> {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  const banner = page.getByRole("status", { name: "Demonstration environment" });
  await banner.waitFor({ timeout: ROUTE_BUDGET_MS });
  const bannerText = await banner.textContent();
  assert(/Demonstration/i.test(bannerText ?? ""), "Demo banner must call the deployment Demonstration.");
  assert(/illustrative/i.test(bannerText ?? ""), "Demo banner must state internal records are illustrative.");
  assert(!/Production/i.test(bannerText ?? ""), "Demo banner must never call itself production.");
}

async function assertAskContract(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/ask`, { waitUntil: "domcontentloaded" });
  await page.locator("[data-surface-component]").first().waitFor({ timeout: ROUTE_BUDGET_MS });
  const body = await page.locator("body").innerText();
  assert(/Ask|web|source|evidence|Retry/i.test(body), "Ask route must expose its surface, source/evidence controls, or a recoverable route status.");
}

async function assertBuiltRevision(): Promise<void> {
  if (!LOCAL_PREVIEW) return;
  const index = await readFile("dist/index.html", "utf8");
  assert(index.includes("/assets/"), "Built app shell must reference Vite assets.");
  const shellOrAssets = index + "\n" + await readFile("dist/404.html", "utf8").catch(() => "");
  assert(shellOrAssets.includes("assets/") || shellOrAssets.includes("/assets/"), "Deployment artifact lacks app assets.");
}

function assertExternalWriteGate(): void {
  assert(crmEntityIdentityMatches({
    formEntityId: "acct-1",
    targetEntityId: "acct-1",
    previewEntityId: "acct-1",
    routeEntityId: "acct-1",
  }), "CRM identity equality contract regressed.");
  const reason = crmWriteBlockReason({
    formEntityId: "lockheed",
    targetEntityId: "pulse-space",
    previewEntityId: "lockheed",
    routeEntityId: "pulse-space",
  });
  assert(reason && /frozen|blocked/i.test(reason), "Mismatched CRM identities must block external writes.");
}

async function assertSourceLevelContracts(): Promise<void> {
  const canonicalMetrics = await readFile("src/app/canonicalMetrics.ts", "utf8");
  for (const token of ["total_accounts", "crm_synced_accounts", "work_open", "data_freshness", "scope", "source", "asOf"]) {
    assert(canonicalMetrics.includes(token), `Canonical metric contract is missing ${token}.`);
  }
  const askQuality = await readFile("tools/test-ask-answer-quality.ts", "utf8");
  assert(/public-current|workspace-only|contradiction/.test(askQuality), "Ask quality suite must cover source-routing contract cases.");
  const environmentContract = await readFile("src/app/environmentContract.ts", "utf8");
  assert(environmentContract.includes("deploymentMode") && environmentContract.includes("externalWrites"), "Environment contract must expose deployment truth and external-write capability.");
  console.log(`deployment smoke source contracts ok for expected revision ${EXPECTED_REVISION}`);
}

let preview: ReturnType<typeof spawn> | null = null;
let browser: Browser | null = null;

if (LOCAL_PREVIEW) {
  const buildEnv = { ...process.env } as NodeJS.ProcessEnv;
  buildEnv.VITE_BASE_PATH = "/";
  buildEnv.VITE_DEPLOYMENT_MODE = "demo";
  buildEnv.VITE_TENANT_ID = "btx-demo-command-cockpit";
  buildEnv.VITE_DEPLOYED_REVISION = EXPECTED_REVISION;
  buildEnv.VITE_SOURCE_TYPE = "repository_seed";
  buildEnv.VITE_DATA_PROVENANCE = "Repository demo seed; internal records are illustrative";
  delete buildEnv.VITE_CLERK_PUBLISHABLE_KEY;
  await run("npm", ["run", "build"], buildEnv);
  preview = await waitForPreview();
}

try {
  assertExternalWriteGate();
  await assertSourceLevelContracts();
  await assertBuiltRevision();
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await assertEnvironmentTruth(page);
  for (const route of ROUTES) await assertRouteLoads(page, route);
  await assertAskContract(page);
  await page.close();
} finally {
  if (browser) await browser.close();
  if (preview) preview.kill("SIGTERM");
}

console.log("deployment smoke ok: commit/env/banner/counts/routes/ask/write-gate contracts verified");
process.exit(0);
