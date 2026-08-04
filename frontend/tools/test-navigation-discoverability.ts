import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { chromium, type Browser, type Page } from "playwright";

const BASE_URL = "http://127.0.0.1:4178";
const SCREENSHOT_DIR = "/tmp/btx-navigation-regression";
const SECONDARY_LABELS = ["Industry updates", "Prospects", "Trip Planner", "Map", "Analysis", "Capacity", "Programs"];

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
  const child = spawn("npm", ["run", "preview", "--", "--host", "127.0.0.1", "--port", "4178", "--strictPort"], {
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

async function visibleMoreButton(page: Page) {
  return page.locator('button:visible').filter({ hasText: "More navigation" }).first();
}

async function checkWidth(browser: Browser, width: number, height: number): Promise<void> {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: width <= 414 ? 2 : 1, isMobile: width <= 414, hasTouch: width <= 414 });
  await page.goto(`${BASE_URL}/intelligence/industry-updates`, { waitUntil: "domcontentloaded" });
  const more = await visibleMoreButton(page);
  await more.waitFor({ timeout: 15_000 });
  assert(await more.isVisible(), `More navigation is not visible at ${width}px`);
  await more.focus();
  assert(await more.evaluate((node) => node === document.activeElement), `More navigation cannot receive focus at ${width}px`);

  if (width > 760) {
    assert(await more.getAttribute("aria-expanded") === "true", `Secondary deep link should expand More navigation at ${width}px`);
    for (const label of SECONDARY_LABELS) {
      assert(await page.getByRole("link", { name: label }).first().isVisible(), `${label} missing from desktop/tablet More navigation at ${width}px`);
    }
    const activeIndustry = page.getByRole("link", { name: "Industry updates" }).first();
    assert(await activeIndustry.getAttribute("aria-current") === "page", `Industry updates not active at ${width}px`);
  } else {
    assert(await more.getAttribute("aria-expanded") === "false", `Mobile More navigation should start collapsed at ${width}px`);
    await more.press("Enter");
    for (const label of SECONDARY_LABELS) {
      assert(await page.getByRole("link", { name: label }).first().isVisible(), `${label} missing from mobile More menu at ${width}px`);
    }
    const activeIndustry = page.getByRole("link", { name: "Industry updates" }).first();
    assert(await activeIndustry.getAttribute("aria-current") === "page", `Industry updates not active in mobile More menu at ${width}px`);
  }

  if (width >= 768) {
    await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
    await page.getByRole("dialog", { name: "Command" }).waitFor({ timeout: 5_000 });
    await page.getByLabel("Search commands, accounts, and work items").fill("industry");
    assert(await page.getByRole("button", { name: /More navigation Industry updates/i }).isVisible(), `Command palette missing Industry updates at ${width}px`);
    await page.keyboard.press("Escape");
  }

  await page.screenshot({ path: `${SCREENSHOT_DIR}/navigation-${width}.png`, fullPage: true });
  await page.close();
}

await mkdir(SCREENSHOT_DIR, { recursive: true });
await run("npm", ["run", "build"], { ...process.env, VITE_BASE_PATH: "/" });
await run("npx", ["playwright", "install", "chromium"]);
const preview = await waitForPreview();
let browser: Browser | null = null;
try {
  browser = await chromium.launch();
  for (const [width, height] of [[320, 700], [390, 844], [768, 900], [1024, 768], [1440, 900]] as const) {
    await checkWidth(browser, width, height);
  }
  console.log(`navigation discoverability ok: screenshots in ${SCREENSHOT_DIR}`);
} finally {
  if (browser) await browser.close();
  preview.kill("SIGTERM");
}
process.exit(0);
