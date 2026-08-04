import { spawn } from "node:child_process";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { chromium, type Browser, type Page } from "playwright";

const BASE_URL = "http://127.0.0.1:4174";
const SCREENSHOT_DIR = "/tmp/btx-mobile-smoke";
const VIEWPORTS = [
  [320, 568],
  [390, 844],
  [414, 896],
  [768, 1024],
] as const;
const DESKTOP_VIEWPORTS = [[1280, 800], [1440, 900]] as const;
const ROUTES = [
  ["/", "brief"],
  ["/work", "work"],
  ["/accounts", "accounts"],
  ["/ask", "ask"],
  ["/intelligence/industry-updates", "industry"],
  ["/prospects", "prospects"],
  ["/map", "map"],
  ["/analysis", "analysis"],
  ["/capacity", "capacity"],
  ["/programs", "programs"],
  ["/deliverables", "deliverables"],
  ["/integrations", "integrations"],
  ["/settings", "settings"],
] as const;

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv = process.env): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: "inherit" });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited ${code}`));
    });
    child.on("error", reject);
  });
}

async function waitForPreview(): Promise<ReturnType<typeof spawn>> {
  const child = spawn("npm", ["run", "preview", "--", "--host", "127.0.0.1", "--port", "4174", "--strictPort"], {
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

async function unlock(page: Page): Promise<void> {
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.locator("[data-surface-component='surface-todays-brief'], [data-surface-component='surface-route-today']").waitFor({ timeout: 15000 });
}

async function openSurface(page: Page, label: RegExp, componentId: string): Promise<void> {
  await page.getByRole("link", { name: label }).first().click();
  await page.locator(`[data-surface-component='${componentId}']`).waitFor({ timeout: 10000 });
}

async function waitForRouteSettled(page: Page): Promise<void> {
  await page.locator("[data-surface-component], .route-data-card, .loading").first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(150);
}

async function assertBottomRail(page: Page, width: number, height: number): Promise<void> {
  const railBox = await page.locator(".brain-rail").boundingBox();
  assert(railBox, `Navigation rail missing at ${width}x${height}.`);
  if (width <= 767) {
    assert(railBox.height >= 56, `Mobile bottom navigation is not touch-sized at ${width}x${height}.`);
    assert(railBox.y + railBox.height >= height - 2, `Mobile navigation is not anchored to the bottom at ${width}x${height}.`);
    assert(railBox.x <= 1 && railBox.width >= width - 2, `Mobile rail should span the viewport width at ${width}x${height}.`);
  }
}

async function assertTouchTargets(page: Page, width: number, height: number): Promise<void> {
  if (width > 767) return;
  const targets = await page.locator("button:visible, a:visible, input:visible, select:visible, textarea:visible").evaluateAll((nodes) =>
    nodes.slice(0, 80).map((node) => {
      const rect = (node as HTMLElement).getBoundingClientRect();
      return { text: (node.textContent ?? (node as HTMLInputElement).ariaLabel ?? "").trim().slice(0, 60), width: rect.width, height: rect.height };
    }),
  );
  const tooSmall = targets.filter((target) => target.width < 44 || target.height < 44);
  assert(tooSmall.length === 0, `Touch targets below 44x44 at ${width}x${height}: ${tooSmall.map((target) => `${target.text || "unnamed"} ${Math.round(target.width)}x${Math.round(target.height)}`).join(" | ")}`);
}

async function captureRouteBaselines(page: Page, width: number, height: number): Promise<void> {
  for (const [route, name] of ROUTES) {
    await page.goto(`${BASE_URL}${route}`, { waitUntil: "networkidle" });
    await waitForRouteSettled(page);
    await assertBottomRail(page, width, height);
    if (name === "ask" && await page.locator("[data-surface-component='surface-ask']").isVisible().catch(() => false)) {
      const composerBox = await page.locator(".ask-workspace-composer").boundingBox();
      assert(composerBox && composerBox.height >= 44, `Ask composer is not reachable at ${width}x${height}.`);
      await page.getByRole("button", { name: "History" }).first().click();
      assert(await page.locator(".ask-conversation-sidebar.drawer-open").isVisible(), `Ask history drawer did not open at ${width}x${height}.`);
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Evidence" }).first().click();
      assert(await page.locator(".ask-citation-panel.drawer-open").isVisible(), `Ask evidence drawer did not open at ${width}x${height}.`);
    }
    if (name === "capacity" && await page.locator("[data-surface-component='surface-capacity-assessment']").isVisible().catch(() => false)) {
      assert(await page.locator(".capacity-mobile-context").isVisible(), `Capacity mobile context missing at ${width}x${height}.`);
    }
    await assertTouchTargets(page, width, height);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/${name}-${width}x${height}.png`, fullPage: true });
  }
}

async function smokeViewport(browser: Browser, width: number, height: number): Promise<void> {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: width <= 414, hasTouch: width <= 414 });
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("net::ERR_CONNECTION_REFUSED")) browserErrors.push(message.text());
  });
  await unlock(page);
  const bodyText = await page.locator("body").innerText();
  assert(!bodyText.includes("mobile companion coming soon"), "Mobile blocker overlay is still present.");
  if (!process.env.E2E_BACKEND_ENDPOINT) {
    await page.getByRole("link", { name: /Ask/i }).first().click();
    await page.locator("[data-surface-component='surface-route-ask']").waitFor({ timeout: 10000 });
    assert(await page.getByRole("button", { name: "Retry" }).isVisible(), "No-backend mobile state should expose retry.");
    const railBox = await page.locator(".brain-rail").boundingBox();
    assert(railBox && railBox.height >= 56, "Mobile bottom navigation is not touch-sized.");
    await captureRouteBaselines(page, width, height);
    await page.close();
    return;
  }
  await openSurface(page, /^Briefing/i, "surface-todays-brief");
  await openSurface(page, /^Work/i, "surface-work-queue");
  await openSurface(page, /Accounts/i, "surface-account-360");
  await openSurface(page, /Ask/i, "surface-ask");
  await page.goto(`${BASE_URL}/intelligence/industry-updates`, { waitUntil: "networkidle" });
  await page.locator("[data-surface-component='surface-industry-updates']").waitFor({ timeout: 10000 });
  await page.getByText(/stored snapshot|monitor has not run/i).first().waitFor();
  const railBox = await page.locator(".brain-rail").boundingBox();
  assert(railBox && railBox.height >= 56, "Mobile bottom navigation is not touch-sized.");
  assert(browserErrors.length === 0, `Browser errors at ${width}x${height}: ${browserErrors.join(" | ")}`);
  await captureRouteBaselines(page, width, height);
  await page.close();
}

async function desktopSmoke(browser: Browser, width: number, height: number): Promise<void> {
  const page = await browser.newPage({ viewport: { width, height } });
  await unlock(page);
  if (!process.env.E2E_BACKEND_ENDPOINT) {
    await page.goto(`${BASE_URL}/ask`, { waitUntil: "networkidle" });
    await page.locator("[data-surface-component='surface-route-ask']").waitFor({ timeout: 10000 });
    await captureRouteBaselines(page, width, height);
    await page.close();
    return;
  }
  await page.goto(`${BASE_URL}/intelligence/industry-updates`, { waitUntil: "networkidle" });
  await page.locator("[data-surface-component='surface-industry-updates']").waitFor({ timeout: 10000 });
  await captureRouteBaselines(page, width, height);
  await page.close();
}

async function assertLazyBundles(): Promise<void> {
  const html = await readFile("dist/index.html", "utf8");
  const distFiles = await readdir("dist/assets");
  for (const chunk of ["leaflet", "xlsx", "pptx", "docx", "DocumentViewer", "ProspectMap", "IndustryUpdates"]) {
    assert(distFiles.some((file) => file.includes(chunk)), `Manual lazy chunk was not emitted: ${chunk}`);
  }
  for (const forbidden of ["write-excel-file"]) {
    assert(!html.includes(forbidden), `Initial HTML eagerly imports dependency internals: ${forbidden}`);
  }
}

await mkdir(SCREENSHOT_DIR, { recursive: true });
// Build at the root base. This suite serves the app from "/" through vite
// preview, whereas a default build targets the Pages subpath.
await run("npm", ["run", "build"], { ...process.env, VITE_BASE_PATH: "/" });
await assertLazyBundles();
await run("npx", ["playwright", "install", "chromium"]);
const preview = await waitForPreview();
let browser: Browser | null = null;
try {
  browser = await chromium.launch();
  for (const [width, height] of VIEWPORTS) await smokeViewport(browser, width, height);
  await smokeViewport(browser, 1024, 768);
  for (const [width, height] of DESKTOP_VIEWPORTS) await desktopSmoke(browser, width, height);
} finally {
  if (browser) await browser.close();
  preview.kill("SIGTERM");
}

console.log(`mobile e2e ok: screenshots in ${SCREENSHOT_DIR}`);
process.exit(0);
