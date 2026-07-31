// WP10-C browser E2E. Two tiers, both real Playwright runs against a built
// + served cockpit (not mocked):
//
// 1. Core-surface smoke (always runs): boots the preview server and walks the
//    four core surfaces at desktop + mobile viewports. The real Clerk sign-in
//    flow is opt-in with E2E_CLERK_LOGIN=1 plus VITE_CLERK_PUBLISHABLE_KEY,
//    E2E_CLERK_EMAIL, and E2E_CLERK_PASSWORD. Without that explicit opt-in it
//    skips Clerk and asserts the app still boots through CockpitAuthGate's
//    no-auth-configured fallback.
//
// 2. HubSpot task loop (env-gated): only runs when E2E_BACKEND_ENDPOINT and
//    E2E_HUBSPOT_TEST_PORTAL=1 are set, i.e. a maintainer has pointed this at
//    a live backend wired to a HubSpot test portal (the seeded portal
//    246683028 documented in docs/DEMO_HUBSPOT_TASK.md works). CI has no such
//    portal/credentials provisioned, so this tier skips there by design -
//    the same "manual credential required" boundary as deploy-staging.yml.
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { chromium, type Browser, type Page } from "playwright";

// This suite exercises the real Clerk auth gate. The retired shared password
// gate is intentionally absent from the build.
const BASE_URL = "http://127.0.0.1:4175";
const SCREENSHOT_DIR = "/tmp/btx-e2e-smoke";

const CLERK_PUBLISHABLE_KEY = process.env.VITE_CLERK_PUBLISHABLE_KEY;
const CLERK_EMAIL = process.env.E2E_CLERK_EMAIL;
const CLERK_PASSWORD = process.env.E2E_CLERK_PASSWORD;
const CLERK_LOGIN_ENABLED = process.env.E2E_CLERK_LOGIN === "1";
const HUBSPOT_LOOP_ENABLED = process.env.E2E_HUBSPOT_TEST_PORTAL === "1" && !!process.env.E2E_BACKEND_ENDPOINT;

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
  const child = spawn("npm", ["run", "preview", "--", "--host", "127.0.0.1", "--port", "4175", "--strictPort"], {
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
  throw new Error("Timed out waiting for Vite preview.");
}

async function signInWithClerkIfConfigured(page: Page): Promise<void> {
  await page.goto(BASE_URL, { waitUntil: "networkidle" });

  if (!CLERK_LOGIN_ENABLED) {
    console.log("e2e: E2E_CLERK_LOGIN is not 1, skipping Clerk login (matches CockpitAuthGate fallback).");
    return;
  }
  if (!CLERK_PUBLISHABLE_KEY || !CLERK_EMAIL || !CLERK_PASSWORD) {
    throw new Error(
      "E2E_CLERK_LOGIN=1 requires VITE_CLERK_PUBLISHABLE_KEY, E2E_CLERK_EMAIL, and E2E_CLERK_PASSWORD.",
    );
  }

  console.log("e2e: performing a real Clerk sign-in.");
  const emailField = page.locator('input[name="identifier"], input[type="email"]').first();
  await emailField.waitFor({ timeout: 15000 });
  await emailField.fill(CLERK_EMAIL);
  await page.getByRole("button", { name: /continue/i }).click();

  const passwordField = page.locator('input[name="password"], input[type="password"]').first();
  await passwordField.waitFor({ timeout: 15000 });
  await passwordField.fill(CLERK_PASSWORD);
  await page.getByRole("button", { name: /continue|sign in/i }).click();
}

async function openSurface(page: Page, label: RegExp, componentId: string): Promise<void> {
  await page.getByRole("link", { name: label }).first().click();
  await page.locator(`[data-surface-component='${componentId}']`).waitFor({ timeout: 10000 });
}

async function walkCoreSurfaces(page: Page): Promise<void> {
  const demoBanner = page.getByRole("status", { name: "Demonstration environment" });
  await page.locator("[data-surface-component='surface-todays-brief'], [data-surface-component='surface-route-today']").waitFor({ timeout: 15000 });
  assert(await demoBanner.isVisible(), "Demo banner is missing from the initial route.");
  if (!process.env.E2E_BACKEND_ENDPOINT) {
    assert(await page.getByRole("button", { name: "Retry" }).isVisible(), "No-backend route state should expose retry.");
    await page.getByRole("link", { name: /^Work/i }).first().click();
    await page.locator("[data-surface-component='surface-route-work']").waitFor({ timeout: 10000 });
    assert(await demoBanner.isVisible(), "Demo banner disappeared on Work route-data state.");
    await page.getByRole("link", { name: /Accounts/i }).first().click();
    await page.locator("[data-surface-component='surface-route-accounts']").waitFor({ timeout: 10000 });
    assert(await demoBanner.isVisible(), "Demo banner disappeared on Accounts route-data state.");
    await page.getByRole("link", { name: /Ask/i }).first().click();
    await page.locator("[data-surface-component='surface-route-ask']").waitFor({ timeout: 10000 });
    assert(await demoBanner.isVisible(), "Demo banner disappeared on Ask route-data state.");
    return;
  }
  await openSurface(page, /^Work/i, "surface-work-queue");
  assert(await demoBanner.isVisible(), "Demo banner disappeared on Work.");
  await openSurface(page, /Accounts/i, "surface-account-360");
  assert(await demoBanner.isVisible(), "Demo banner disappeared on Accounts.");
  await openSurface(page, /Ask/i, "surface-ask");
  assert(await demoBanner.isVisible(), "Demo banner disappeared on Ask.");
  await openSurface(page, /^Briefing/i, "surface-todays-brief");
  assert(await demoBanner.isVisible(), "Demo banner disappeared on Briefing.");
}

async function smokeViewport(browser: Browser, opts: { width: number; height: number; isMobile: boolean }): Promise<void> {
  const page = await browser.newPage({
    viewport: { width: opts.width, height: opts.height },
    deviceScaleFactor: opts.isMobile ? 2 : 1,
    isMobile: opts.isMobile,
    hasTouch: opts.isMobile,
  });
  await signInWithClerkIfConfigured(page);
  await walkCoreSurfaces(page);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/cockpit-${opts.width}.png`, fullPage: true });
  await page.close();
}

async function crmAccountSwitchRegression(browser: Browser): Promise<void> {
  if (!process.env.E2E_BACKEND_ENDPOINT) {
    console.log("e2e: account-switch tier skipped because no backend endpoint is configured.");
    return;
  }
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await signInWithClerkIfConfigured(page);
  await page.goto(`${BASE_URL}/accounts`, { waitUntil: "networkidle" });
  await page.locator("[data-surface-component='surface-account-360']").waitFor();
  const accountRows = page.locator(".account360-list-row");
  await accountRows.nth(1).waitFor({ timeout: 15000 }).catch(() => undefined);
  if (await accountRows.count() === 0) {
    console.log("e2e: account-switch tier skipped because the active smoke adapter returned no account fixtures.");
    await page.close();
    return;
  }
  const firstName = (await accountRows.nth(0).locator("strong").first().textContent())?.trim() ?? "";
  const hasSecondAccount = await accountRows.count() >= 2;
  const secondName = hasSecondAccount
    ? (await accountRows.nth(1).locator("strong").first().textContent())?.trim() ?? ""
    : firstName;
  await page.getByRole("button", { name: "Prepare HubSpot company" }).click();
  const legalName = page.getByLabel("Legal name");
  await legalName.fill("STALE LOCKHEED VALUE");
  await page.getByRole("button", { name: "Preview company record", exact: true }).first().click();
  await page.locator(".crm-write-preview").waitFor();

  // Rapid navigation must unmount/reset all account-derived form and preview state.
  if (hasSecondAccount) {
    await accountRows.nth(1).click();
    await page.getByRole("button", { name: "Prepare HubSpot company" }).click();
    assert(await page.getByLabel("Legal name").inputValue() === secondName, "Account switch retained the first account's form state.");
    assert(await page.locator(".crm-write-preview").count() === 0, "Account switch retained a stale CRM preview.");
    await page.goBack();
  } else {
    // Minimal smoke fixtures expose one account. A missing target still exercises
    // route identity invalidation and back-navigation remount behavior.
    await page.goto(`${BASE_URL}/accounts/mismatched-entity`);
    assert(await page.locator(".crm-write-preview").count() === 0, "Mismatched route retained a stale CRM preview.");
    await page.goBack();
  }
  await page.getByRole("button", { name: "Prepare HubSpot company" }).click();
  assert(await page.getByLabel("Legal name").inputValue() === firstName, "Back navigation restored stale edited state.");
  if (hasSecondAccount) await page.goForward();
  await page.getByRole("button", { name: "Prepare HubSpot task" }).click();
  await page.getByRole("button", { name: "Preview task", exact: true }).click();
  const confirm = page.getByRole("button", { name: "Create HubSpot task" });
  assert(await confirm.isDisabled(), "CRM write freeze was not enforced after account navigation.");
  assert(await page.locator("text=/temporarily frozen/i").count() > 0, "Frozen double submit did not surface the safety reason.");
  await page.close();
  console.log("e2e: CRM rapid-switch, history, stale-preview, double-submit, and identity freeze verified.");
}

// ─── HubSpot task loop (env-gated, live backend + test portal) ─────────────

async function seedWorkItem(backendEndpoint: string, authHeaders: Record<string, string>): Promise<string> {
  const response = await fetch(`${backendEndpoint}/work-items`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders },
    body: JSON.stringify({
      type: "account_action",
      recommended_action: "E2E: execute an approved HubSpot task for this account.",
      priority: "high",
      status: "detected",
      approval_state: "pending",
    }),
  });
  if (!response.ok) throw new Error(`seedWorkItem failed (${response.status}): ${await response.text()}`);
  const body = (await response.json()) as { id: string };
  return body.id;
}

async function transitionWorkItem(backendEndpoint: string, authHeaders: Record<string, string>, itemId: string, action: string): Promise<void> {
  const response = await fetch(`${backendEndpoint}/work-items/${itemId}/transition`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders },
    body: JSON.stringify({ action }),
  });
  if (!response.ok) throw new Error(`transition ${action} failed (${response.status}): ${await response.text()}`);
}

async function runHubSpotTaskLoop(browser: Browser): Promise<void> {
  const backendEndpoint = process.env.E2E_BACKEND_ENDPOINT!;
  const clerkToken = process.env.E2E_CLERK_SESSION_TOKEN; // minted out-of-band by the maintainer for this run
  if (!clerkToken) {
    throw new Error("E2E_HUBSPOT_TEST_PORTAL=1 requires E2E_CLERK_SESSION_TOKEN (a valid session token for backend calls).");
  }
  const authHeaders = { authorization: `Bearer ${clerkToken}` };

  const itemId = await seedWorkItem(backendEndpoint, authHeaders);
  for (const action of ["triage", "prepare", "request_approval", "approve"]) {
    await transitionWorkItem(backendEndpoint, authHeaders, itemId, action);
  }
  console.log(`e2e: seeded work item ${itemId} for the HubSpot task loop.`);

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await signInWithClerkIfConfigured(page);
  await page.goto(`${BASE_URL}/work/${encodeURIComponent(itemId)}`, { waitUntil: "networkidle" });
  await page.locator("[data-surface-component='surface-work-queue']").waitFor({ timeout: 10000 });

  await page.getByRole("button", { name: "Preview HubSpot task" }).click();
  await page.getByRole("button", { name: "Execute approved task" }).click();

  const successLocator = page.locator("text=/HubSpot task executed and verified/i");
  await successLocator.waitFor({ timeout: 20000 });
  assert(await successLocator.count(), "HubSpot task loop did not report a verified task.");

  await page.close();
  console.log("e2e: HubSpot task loop verified end to end.");
}

// ─── main ────────────────────────────────────────────────────────────────

await mkdir(SCREENSHOT_DIR, { recursive: true });
const buildEnv = { ...process.env } as NodeJS.ProcessEnv;
// This suite serves the build from "/" through vite preview, whereas a default
// build targets the GitHub Pages subpath.
buildEnv.VITE_BASE_PATH = "/";
buildEnv.VITE_DEPLOYMENT_MODE = "demo";
buildEnv.VITE_TENANT_ID = "btx-demo-command-cockpit";
buildEnv.VITE_DEPLOYED_REVISION = "779198f";
if (CLERK_LOGIN_ENABLED && CLERK_PUBLISHABLE_KEY) buildEnv.VITE_CLERK_PUBLISHABLE_KEY = CLERK_PUBLISHABLE_KEY;
if (!CLERK_LOGIN_ENABLED) delete buildEnv.VITE_CLERK_PUBLISHABLE_KEY;
if (HUBSPOT_LOOP_ENABLED) buildEnv.VITE_BACKEND_ENDPOINT = process.env.E2E_BACKEND_ENDPOINT;
await run("npm", ["run", "build"], buildEnv);
await run("npx", ["playwright", "install", "chromium"]);
const preview = await waitForPreview();
let browser: Browser | null = null;
try {
  browser = await chromium.launch();
  await smokeViewport(browser, { width: 1280, height: 900, isMobile: false });
  await smokeViewport(browser, { width: 390, height: 844, isMobile: true });
  await crmAccountSwitchRegression(browser);

  if (HUBSPOT_LOOP_ENABLED) {
    await runHubSpotTaskLoop(browser);
  } else {
    console.log("e2e: E2E_HUBSPOT_TEST_PORTAL / E2E_BACKEND_ENDPOINT not set - skipping the HubSpot task loop tier.");
  }
} finally {
  if (browser) await browser.close();
  preview.kill("SIGTERM");
}

console.log(`e2e ok: screenshots in ${SCREENSHOT_DIR}${HUBSPOT_LOOP_ENABLED ? " (including HubSpot task loop)" : ""}`);
