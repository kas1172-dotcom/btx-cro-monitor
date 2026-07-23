import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { chromium, type Browser, type Page } from "playwright";

const PASSWORD = "mobile-smoke";
const PASSWORD_HASH = "c66fb02f84dfe02b09b681f00cda7aa8b08ef98c81fda5ffe76873c1ee823087";
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
  const password = page.locator('input[type="password"]');
  if (await password.count()) {
    await password.fill(PASSWORD);
    await page.getByRole("button", { name: "Enter" }).click();
  }
  await page.locator("[data-surface-component='surface-todays-brief']").waitFor({ timeout: 15000 });
}

async function openSurface(page: Page, label: RegExp, componentId: string): Promise<void> {
  await page.getByRole("button", { name: label }).first().click();
  await page.locator(`[data-surface-component='${componentId}']`).waitFor({ timeout: 10000 });
}

async function smokeViewport(browser: Browser, width: number): Promise<void> {
  const page = await browser.newPage({ viewport: { width, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await unlock(page);
  const bodyText = await page.locator("body").innerText();
  assert(!bodyText.includes("mobile companion coming soon"), "Mobile blocker overlay is still present.");
  await openSurface(page, /Today's Brief/i, "surface-todays-brief");
  await openSurface(page, /Work Queue/i, "surface-work-queue");
  await openSurface(page, /Accounts/i, "surface-account-360");
  await openSurface(page, /Ask/i, "surface-ask");
  const railBox = await page.locator(".brain-rail").boundingBox();
  assert(railBox && railBox.height >= 56, "Mobile bottom navigation is not touch-sized.");
  await page.screenshot({ path: `${SCREENSHOT_DIR}/cockpit-${width}.png`, fullPage: true });
  await page.close();
}

async function desktopSmoke(browser: Browser): Promise<void> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await unlock(page);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/cockpit-1280.png`, fullPage: true });
  await page.close();
}

async function assertLazyBundles(): Promise<void> {
  const html = await readFile("dist/index.html", "utf8");
  for (const forbidden of ["leaflet", "write-excel-file", "xlsx", "pptx", "docx", "DocumentViewer", "ProspectMap"]) {
    assert(!html.includes(forbidden), `Initial HTML eagerly references lazy chunk: ${forbidden}`);
  }
}

await mkdir(SCREENSHOT_DIR, { recursive: true });
await run("npm", ["run", "build"], { ...process.env, VITE_COCKPIT_PASSWORD_HASH: PASSWORD_HASH });
await assertLazyBundles();
await run("npx", ["playwright", "install", "chromium"]);
const preview = await waitForPreview();
let browser: Browser | null = null;
try {
  browser = await chromium.launch();
  await smokeViewport(browser, 390);
  await smokeViewport(browser, 414);
  await desktopSmoke(browser);
} finally {
  if (browser) await browser.close();
  preview.kill("SIGTERM");
}

console.log(`mobile e2e ok: screenshots in ${SCREENSHOT_DIR}`);
