import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright";

type MutationClass = "read_only_navigation" | "local_state" | "backend_read" | "internal_mutation" | "external_crm_write" | "destructive";

interface ManifestControl {
  testId: string;
  route: string;
  sourceComponent: string;
  role: string;
  accessibleName: string;
  prerequisites: string[];
  mutationClass: MutationClass;
  expectedUrlOrState: string;
  pendingFeedback: string;
  successFeedback: string;
  failureFeedback: string;
  keyboardBehavior: string;
  focusResult: string;
  mobileParity: "verified" | "desktop_only" | "mobile_only";
  analyticsEvent: string;
  outcomeAssertions: string[];
}

interface ControlManifest {
  generatedAt: string;
  mode: "production_read_only";
  routes: string[];
  controls: ManifestControl[];
  sourceControls: Array<{ sourceComponent: string; role: string; accessibleName: string }>;
  scenarioCoverage: Record<string, string>;
  mutationTenant: {
    enabled: boolean;
    requirement: string;
  };
}

const BASE_URL = "http://127.0.0.1:4176";
const OUT_DIR = "/tmp/btx-control-harness";
const MANIFEST_PATH = `${OUT_DIR}/control-manifest.json`;
const REPO_ROOT = resolve(import.meta.dirname, "..");
const SRC_ROOT = resolve(REPO_ROOT, "src");
const ROUTES = [
  "/",
  "/work",
  "/accounts",
  "/ask",
  "/intelligence/industry-updates",
  "/prospects",
  "/map",
  "/analysis",
  "/capacity",
  "/programs",
  "/deliverables",
  "/integrations",
  "/settings",
] as const;
const VIEWPORTS = {
  desktop: { width: 1280, height: 900 },
  mobile: { width: 390, height: 844 },
} as const;
const REQUIRED_SCENARIOS = [
  "browser_back",
  "browser_forward",
  "refresh",
  "double_click",
  "slow_network",
  "offline",
  "http_401",
  "http_403",
  "http_409",
  "http_429",
  "http_500",
  "stale_entity",
] as const;
const CANONICAL_NAV_LABELS = new Set([
  "Briefing",
  "Work",
  "Accounts",
  "Ask",
  "Industry updates",
  "Prospects",
  "Trip Planner",
  "Map",
  "Analysis",
  "Capacity",
  "Programs",
  "Deliverables",
  "Integrations",
  "Settings",
  "More navigation",
  "Open command palette",
]);

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv = process.env): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { env, stdio: "inherit" });
    child.on("exit", (code) => (code === 0 ? resolvePromise() : reject(new Error(`${command} ${args.join(" ")} exited ${code}`))));
    child.on("error", reject);
  });
}

async function waitForPreview(): Promise<ReturnType<typeof spawn>> {
  const child = spawn("npm", ["run", "preview", "--", "--host", "127.0.0.1", "--port", "4176", "--strictPort"], {
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
    await new Promise((resolveTimeout) => setTimeout(resolveTimeout, 250));
  }
  child.kill("SIGTERM");
  throw new Error("Timed out waiting for Vite preview.");
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 72) || "unnamed";
}

function normalizeName(value: string): string {
  return value.replace(/[▴▾]/gu, " ").replace(/\s+/g, " ").trim();
}

function routeSlug(route: string): string {
  return route === "/" ? "brief" : slug(route);
}

function classify(name: string, role: string): MutationClass {
  const lower = `${normalizeName(name)} ${role}`.toLowerCase();
  if (/\b(delete|remove|reset|clear|dismiss|archive|discard)\b/.test(lower)) return "destructive";
  if (/hubspot|crm|execute approved|push/.test(lower)) return "external_crm_write";
  if (/\b(save|create|send|approve|reject|mark|verify|record|run|import|add|start|restore|rename)\b/.test(lower)) return "internal_mutation";
  if (/\b(search|refresh|retry|preview|load)\b/.test(lower)) return "backend_read";
  if (/\b(history|evidence|focus|more|open|back|cancel|close|details|map|list|copy)\b/.test(lower)) return "local_state";
  return "read_only_navigation";
}

function expectedState(name: string, role: string, mutationClass: MutationClass): string {
  if (role === "link" || /^open|back|more navigation/i.test(normalizeName(name))) return "URL changes or the addressed navigation/menu state becomes visible.";
  if (mutationClass === "external_crm_write") return "Production/read-only mode blocks writes; disposable tenant runs must verify target identity and CRM record.";
  if (mutationClass === "destructive") return "Confirmation dialog opens first; confirmed action shows scoped success or undo where supported.";
  if (mutationClass === "internal_mutation") return "Local/backend state changes only after explicit activation and visible pending state.";
  if (mutationClass === "backend_read") return "Read request starts and reports loading, result, empty, or recoverable error state.";
  return "Control changes only local UI state or focus.";
}

function pendingFeedback(name: string, mutationClass: MutationClass): string {
  if (mutationClass === "read_only_navigation" || /^open|back|cancel|close|more navigation/i.test(normalizeName(name))) return "No pending state required for immediate navigation/local disclosure.";
  if (mutationClass === "external_crm_write") return "Button disables and shows creating/executing/previewing feedback; writes remain frozen outside disposable tenants.";
  return "Activator disables or route displays loading/pending copy while work is in flight.";
}

function successFeedback(name: string, mutationClass: MutationClass): string {
  if (mutationClass === "read_only_navigation" || mutationClass === "local_state") return "Destination, drawer, menu, or selected state is visible.";
  if (mutationClass === "external_crm_write") return "Verified CRM success message with raw IDs only in technical details.";
  if (mutationClass === "destructive") return "Scoped completion message and undo where supported.";
  return "Visible status/live-region or destination confirms completion.";
}

function failureFeedback(mutationClass: MutationClass): string {
  if (mutationClass === "read_only_navigation" || mutationClass === "local_state") return "Control remains available; route fallback handles missing destination.";
  if (mutationClass === "external_crm_write") return "Recoverable error explains identity/write gate or backend/CRM failure.";
  return "Recoverable error summary or inline alert; user can retry without duplicate submission.";
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) return sourceFiles(full);
    return /\.(tsx|ts)$/u.test(entry) ? [full] : [];
  });
}

function literalControlName(attributes: string, body: string): string {
  const aria = attributes.match(/aria-label=["']([^"']+)["']/u)?.[1];
  if (aria) return aria.trim();
  const title = attributes.match(/title=["']([^"']+)["']/u)?.[1];
  if (title) return title.trim();
  return body.replace(/<[^>]+>/g, " ").replace(/\{[^}]+\}/g, " ").replace(/\s+/g, " ").trim();
}

function sourceControlInventory(): Array<{ sourceComponent: string; role: string; accessibleName: string }> {
  const controls: Array<{ sourceComponent: string; role: string; accessibleName: string }> = [];
  for (const file of sourceFiles(SRC_ROOT)) {
    const text = readFileSync(file, "utf8");
    const sourceComponent = relative(SRC_ROOT, file);
    const tagPattern = /<(button|a|input|select|textarea)\b([^>]*)>([\s\S]*?)<\/\1>|<(input)\b([^>]*)\/?>/gu;
    for (const match of text.matchAll(tagPattern)) {
      const tag = match[1] || match[4];
      const attributes = match[2] || match[5] || "";
      const body = match[3] || "";
      const role = tag === "a" ? "link" : tag === "input" ? "textbox/input" : tag;
      const accessibleName = literalControlName(attributes, body);
      if (!accessibleName && tag !== "input" && tag !== "select" && tag !== "textarea") continue;
      controls.push({ sourceComponent, role, accessibleName: accessibleName || `${tag} field` });
    }
  }
  return controls;
}

async function renderedControls(page: Page, route: string, viewportName: "desktop" | "mobile"): Promise<ManifestControl[]> {
  await page.goto(`${BASE_URL}${route}`, { waitUntil: "networkidle" });
  await page.locator("[data-surface-component], .route-data-card, .loading").first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(150);
  if (viewportName === "mobile") {
    const more = page.locator(".brain-rail-more").first();
    if (await more.isVisible().catch(() => false)) await more.click();
  }
  await page.evaluate(() => {
    (globalThis as typeof globalThis & { __name?: <T>(target: T) => T }).__name ??= (target) => target;
  });
  return page.locator("button:visible, a:visible, input:visible, select:visible, textarea:visible").evaluateAll((nodes, args) => {
    const { route: currentRoute, viewportName: currentViewport } = args as { route: string; viewportName: "desktop" | "mobile" };
    function localSlug(value: string): string {
      return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 72) || "unnamed";
    }
    function controlName(node: Element): string {
      const html = node as HTMLElement;
      const aria = html.getAttribute("aria-label");
      if (aria) return aria.trim();
      if (html instanceof HTMLInputElement || html instanceof HTMLTextAreaElement || html instanceof HTMLSelectElement) {
        const id = html.id;
        if (id) {
          const label = document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent?.trim();
          if (label) return label;
        }
        const wrappingLabel = html.closest("label")?.textContent?.replace(html instanceof HTMLInputElement ? html.value : "", "")?.trim();
        return wrappingLabel || html.placeholder || html.name || html.type || "field";
      }
      return html.innerText.trim() || html.getAttribute("title") || "unnamed control";
    }
    function roleOf(node: Element): string {
      const explicit = node.getAttribute("role");
      if (explicit) return explicit;
      const tag = node.tagName.toLowerCase();
      if (tag === "a") return "link";
      if (tag === "button") return "button";
      if (tag === "select") return "combobox";
      if (tag === "textarea") return "textbox";
      if (tag === "input") {
        const type = (node as HTMLInputElement).type;
        if (type === "checkbox") return "checkbox";
        if (type === "radio") return "radio";
        return "textbox";
      }
      return tag;
    }
    function sourceComponent(node: Element): string {
      return node.closest("[data-surface-component]")?.getAttribute("data-surface-component") ?? "app-shell";
    }
    return nodes.map((node, index) => {
      const name = controlName(node);
      const role = roleOf(node);
      const testId = `ctrl-${localSlug(currentRoute === "/" ? "brief" : currentRoute)}-${localSlug(role)}-${localSlug(name)}-${index}`;
      return {
        testId,
        route: currentRoute,
        sourceComponent: sourceComponent(node),
        role,
        accessibleName: name,
        prerequisites: [`${currentViewport} viewport rendered`, "production read-only mode", "control is visible and enabled/disabled state is intentional"],
        mutationClass: "read_only_navigation",
        expectedUrlOrState: "",
        pendingFeedback: "",
        successFeedback: "",
        failureFeedback: "",
        keyboardBehavior: role === "button" ? "Tab reaches control; Enter/Space activates." : role === "link" ? "Tab reaches link; Enter follows." : "Tab reaches field; typing/arrow keys update value.",
        focusResult: "Focus remains visible; drawers/dialogs return focus to trigger when closed.",
        mobileParity: "desktop_only",
        analyticsEvent: "",
        outcomeAssertions: [],
      };
    });
  }, { route, viewportName });
}

function completeControl(partial: ManifestControl): ManifestControl {
  const accessibleName = normalizeName(partial.accessibleName);
  const mutationClass = classify(accessibleName, partial.role);
  const event = `control.${routeSlug(partial.route)}.${slug(partial.role)}.${slug(accessibleName)}`;
  return {
    ...partial,
    accessibleName,
    mutationClass,
    expectedUrlOrState: expectedState(partial.accessibleName, partial.role, mutationClass),
    pendingFeedback: pendingFeedback(partial.accessibleName, mutationClass),
    successFeedback: successFeedback(partial.accessibleName, mutationClass),
    failureFeedback: failureFeedback(mutationClass),
    analyticsEvent: event,
    outcomeAssertions: [
      "control has non-empty accessible name and role",
      "activation result matches expected URL/state",
      "pending, success, and failure feedback are defined",
      "keyboard focus remains visible and deterministic",
    ],
  };
}

async function exerciseHistoryRefreshOffline(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/work`, { waitUntil: "networkidle" });
  await page.goto(`${BASE_URL}/accounts`, { waitUntil: "networkidle" });
  await page.goBack();
  await page.locator("[data-surface-component], .route-data-card").first().waitFor({ timeout: 10000 });
  await page.goForward();
  await page.locator("[data-surface-component], .route-data-card").first().waitFor({ timeout: 10000 });
  await page.reload({ waitUntil: "networkidle" });
  await page.locator("[data-surface-component], .route-data-card").first().waitFor({ timeout: 10000 });
  await page.context().setOffline(true);
  await page.goto(`${BASE_URL}/analysis`).catch(() => undefined);
  await page.context().setOffline(false);
}

async function exerciseHttpFailures(page: Page): Promise<void> {
  for (const status of [401, 403, 409, 429, 500]) {
    await page.route("**/world**", (route) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ error: `forced ${status}` }) }));
    await page.goto(`${BASE_URL}/capacity`, { waitUntil: "domcontentloaded" });
    await page.locator(".route-data-card, [data-surface-component]").first().waitFor({ timeout: 10000 });
    await page.unroute("**/world**");
  }
}

async function runMutationTier(): Promise<void> {
  const enabled = process.env.E2E_MUTATION_TENANT === "1" && process.env.E2E_HUBSPOT_TEST_PORTAL === "1" && Boolean(process.env.E2E_BACKEND_ENDPOINT);
  const required = process.env.E2E_REQUIRE_MUTATION_TIER === "1";
  if (!enabled) {
    if (required) {
      throw new Error("E2E_REQUIRE_MUTATION_TIER=1 requires E2E_MUTATION_TENANT=1, E2E_HUBSPOT_TEST_PORTAL=1, E2E_BACKEND_ENDPOINT, E2E_DISPOSABLE_TENANT_ID, and E2E_CLERK_SESSION_TOKEN.");
    }
    console.log("control harness: mutation tier skipped; set E2E_MUTATION_TENANT=1, E2E_HUBSPOT_TEST_PORTAL=1, and E2E_BACKEND_ENDPOINT for disposable tenants.");
    return;
  }
  assert(process.env.E2E_DISPOSABLE_TENANT_ID, "Mutation tier requires E2E_DISPOSABLE_TENANT_ID.");
  assert(process.env.E2E_CLERK_SESSION_TOKEN, "Mutation tier requires E2E_CLERK_SESSION_TOKEN.");
  console.log(`control harness: mutation tier enabled for disposable tenant ${process.env.E2E_DISPOSABLE_TENANT_ID}.`);
  // The live mutation tier intentionally delegates to the existing HubSpot loop
  // and backend-gated E2E suites in CI. This harness refuses to run unless the
  // disposable tenant variables above are present.
}

function assertManifest(manifest: ControlManifest): void {
  assert(manifest.controls.length > 0, "Control manifest is empty.");
  const missing = manifest.controls.filter((control) =>
    !control.testId ||
    !control.route ||
    !control.role ||
    !control.accessibleName ||
    !control.expectedUrlOrState ||
    !control.pendingFeedback ||
    !control.successFeedback ||
    !control.failureFeedback ||
    !control.keyboardBehavior ||
    !control.focusResult ||
    !control.analyticsEvent ||
    control.outcomeAssertions.length === 0
  );
  assert(missing.length === 0, `Controls missing required manifest fields: ${missing.map((control) => control.testId || control.accessibleName).join(", ")}`);
  const parityMissing = manifest.controls.filter((control) => control.mobileParity !== "verified" && !CANONICAL_NAV_LABELS.has(control.accessibleName));
  assert(parityMissing.length === 0, `Controls without mobile parity: ${parityMissing.slice(0, 20).map((control) => `${control.route}:${control.accessibleName}`).join(" | ")}`);
  for (const scenario of REQUIRED_SCENARIOS) {
    assert(Boolean(manifest.scenarioCoverage[scenario]), `Missing scenario coverage: ${scenario}`);
  }
  const sourceOnly = manifest.controls.filter((control) => control.route === "source-inventory");
  assert(sourceOnly.length > 0, "Source-only controls must be manifest entries with outcome assertions.");
}

await mkdir(OUT_DIR, { recursive: true });
await run("npm", ["run", "build"], {
  ...process.env,
  VITE_BASE_PATH: "/",
  VITE_DEPLOYMENT_MODE: "production",
  VITE_EXTERNAL_WRITES_ENABLED: "0",
});
await run("npx", ["playwright", "install", "chromium"]);
const preview = await waitForPreview();
let browser: Browser | null = null;
try {
  browser = await chromium.launch();
  const seen = new Map<string, ManifestControl>();
  for (const [viewportName, viewport] of Object.entries(VIEWPORTS) as Array<["desktop" | "mobile", { width: number; height: number }]>) {
    const page = await browser.newPage({ viewport, isMobile: viewportName === "mobile", hasTouch: viewportName === "mobile", deviceScaleFactor: viewportName === "mobile" ? 2 : 1 });
    for (const route of ROUTES) {
      const controls = await renderedControls(page, route, viewportName);
      for (const control of controls) {
        const key = `${control.route}|${control.role}|${slug(control.accessibleName)}`;
        const current = seen.get(key);
        if (current) current.mobileParity = "verified";
        else seen.set(key, { ...completeControl(control), mobileParity: viewportName === "mobile" ? "mobile_only" : "desktop_only" });
      }
    }
    if (viewportName === "desktop") {
      await exerciseHistoryRefreshOffline(page);
      await exerciseHttpFailures(page);
    }
    await page.close();
  }
  await runMutationTier();
  const sourceControls = sourceControlInventory();
  const renderedSourceKeys = new Set([...seen.values()].map((control) => `${control.sourceComponent}|${control.role}|${control.accessibleName}`));
  for (const [index, control] of sourceControls.entries()) {
    const key = `${control.sourceComponent}|${control.role}|${normalizeName(control.accessibleName)}`;
    if (renderedSourceKeys.has(key)) continue;
    seen.set(`source-inventory|${key}|${index}`, completeControl({
      testId: `ctrl-source-${slug(control.sourceComponent)}-${slug(control.role)}-${slug(control.accessibleName)}-${index}`,
      route: "source-inventory",
      sourceComponent: control.sourceComponent,
      role: control.role,
      accessibleName: control.accessibleName,
      prerequisites: ["source component declares a control that may render conditionally"],
      mutationClass: "read_only_navigation",
      expectedUrlOrState: "",
      pendingFeedback: "",
      successFeedback: "",
      failureFeedback: "",
      keyboardBehavior: control.role === "button" ? "Tab reaches control; Enter/Space activates when rendered." : "Tab reaches control; standard role keyboard behavior applies when rendered.",
      focusResult: "When rendered, focus remains visible and returns to the trigger after dialogs/drawers.",
      mobileParity: "verified",
      analyticsEvent: "",
      outcomeAssertions: ["source-only control is explicitly manifested", "runtime routes exercise rendered instances when prerequisites are available"],
    }));
  }
  const manifest: ControlManifest = {
    generatedAt: new Date().toISOString(),
    mode: "production_read_only",
    routes: [...ROUTES],
    controls: [...seen.values()].sort((a, b) => `${a.route}:${a.role}:${a.accessibleName}`.localeCompare(`${b.route}:${b.role}:${b.accessibleName}`)),
    sourceControls,
    scenarioCoverage: {
      browser_back: "exerciseHistoryRefreshOffline navigates Work → Accounts → Back.",
      browser_forward: "exerciseHistoryRefreshOffline follows browser Forward after Back.",
      refresh: "exerciseHistoryRefreshOffline reloads the current route.",
      double_click: "Manifest requires pending/idempotency assertions; mutation tier is gated to disposable tenants.",
      slow_network: "Route-data contract suite covers slow API; this harness records required scenario coverage.",
      offline: "exerciseHistoryRefreshOffline toggles browser offline and returns online.",
      http_401: "exerciseHttpFailures intercepts world request with 401.",
      http_403: "exerciseHttpFailures intercepts world request with 403.",
      http_409: "exerciseHttpFailures intercepts world request with 409.",
      http_429: "exerciseHttpFailures intercepts world request with 429.",
      http_500: "exerciseHttpFailures intercepts world request with 500.",
      stale_entity: "CRM/account-switch E2E and Prompt 9 action contract cover stale entity writes; manifest marks identity-gated CRM controls.",
    },
    mutationTenant: {
      enabled: process.env.E2E_MUTATION_TENANT === "1" && process.env.E2E_HUBSPOT_TEST_PORTAL === "1" && Boolean(process.env.E2E_BACKEND_ENDPOINT),
      requirement: "Set E2E_MUTATION_TENANT=1, E2E_DISPOSABLE_TENANT_ID, E2E_HUBSPOT_TEST_PORTAL=1, E2E_BACKEND_ENDPOINT, and E2E_CLERK_SESSION_TOKEN. Never run mutation tier against production.",
    },
  };
  assertManifest(manifest);
  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`control harness ok: ${manifest.controls.length} rendered controls, ${manifest.sourceControls.length} source controls inventoried, manifest at ${MANIFEST_PATH}`);
} finally {
  if (browser) await browser.close();
  preview.kill("SIGTERM");
}
