import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { chromium, type Browser, type Page } from "playwright";

const BASE_URL = "http://127.0.0.1:4174";
const SCREENSHOT_DIR = "/tmp/btx-mobile-smoke";

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
  await page.locator("[data-surface-component='surface-todays-brief']").waitFor({ timeout: 15000 });
}

async function openSurface(page: Page, label: RegExp, componentId: string): Promise<void> {
  await page.getByRole("link", { name: label }).first().click();
  await page.locator(`[data-surface-component='${componentId}']`).waitFor({ timeout: 10000 });
}

async function smokeViewport(browser: Browser, width: number, height: number): Promise<void> {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: width <= 414, hasTouch: width <= 414 });
  await unlock(page);
  const bodyText = await page.locator("body").innerText();
  assert(!bodyText.includes("mobile companion coming soon"), "Mobile blocker overlay is still present.");
  await openSurface(page, /^Briefing/i, "surface-todays-brief");
  await openSurface(page, /^Work/i, "surface-work-queue");
  await openSurface(page, /Accounts/i, "surface-account-360");
  await openSurface(page, /Ask/i, "surface-ask");
  const railBox = await page.locator(".brain-rail").boundingBox();
  assert(railBox && railBox.height >= 56, "Mobile bottom navigation is not touch-sized.");
  await page.screenshot({ path: `${SCREENSHOT_DIR}/cockpit-${width}x${height}.png`, fullPage: true });
  await page.close();
}

async function desktopSmoke(browser: Browser, width: number, height: number): Promise<void> {
  const page = await browser.newPage({ viewport: { width, height } });
  await unlock(page);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/cockpit-${width}x${height}.png`, fullPage: true });
  await page.close();
}

async function assertLazyBundles(): Promise<void> {
  const html = await readFile("dist/index.html", "utf8");
  for (const forbidden of ["leaflet", "write-excel-file", "xlsx", "pptx", "docx", "DocumentViewer", "ProspectMap"]) {
    assert(!html.includes(forbidden), `Initial HTML eagerly references lazy chunk: ${forbidden}`);
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
  await smokeViewport(browser, 320, 700);
  await smokeViewport(browser, 390, 844);
  await smokeViewport(browser, 414, 844);
  await smokeViewport(browser, 768, 900);
  await smokeViewport(browser, 1024, 768);
  await desktopSmoke(browser, 1280, 800);
  await desktopSmoke(browser, 1440, 900);
} finally {
  if (browser) await browser.close();
  preview.kill("SIGTERM");
}

console.log(`mobile e2e ok: screenshots in ${SCREENSHOT_DIR}`);
