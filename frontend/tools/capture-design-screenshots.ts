// One-off capture for the design-system-restyle pass — not a permanent test.
// Boots the built cockpit and screenshots 5 surfaces at desktop + one mobile
// width into design/samples/ui/, matching the existing reference set's naming.
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { chromium, type Browser, type Page } from "playwright";

const BASE_URL = "http://127.0.0.1:4176";
const OUT_DIR = "../design/samples/ui";

const SURFACES: Array<{ label: RegExp; selector: string; file: string }> = [
  { label: /Today'?s Brief|Home/i, selector: "[data-surface-component='surface-todays-brief']", file: "todays-brief" },
  { label: /Accounts/i, selector: "[data-surface-component='surface-account-360']", file: "account-360" },
  { label: /Analysis/i, selector: "[data-surface-component='surface-analysis-dashboard']", file: "analysis" },
  { label: /Work Queue/i, selector: "[data-surface-component='surface-work-queue']", file: "work-queue" },
  // ProspectMap.tsx does not set data-surface-component (a pre-existing gap,
  // unrelated to this pass) - .map-shell is its real, unique root class.
  { label: /Map/i, selector: ".map-shell", file: "map" },
];

function run(command: string, args: string[], env: NodeJS.ProcessEnv = process.env): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: "inherit" });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${command} ${args.join(" ")} exited ${code}`))));
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
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  child.kill("SIGTERM");
  throw new Error("Timed out waiting for Vite preview.");
}

async function captureAt(browser: Browser, width: number, height: number, suffix: string): Promise<void> {
  const page: Page = await browser.newPage({ viewport: { width, height } });
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.locator("[data-surface-component='surface-todays-brief']").waitFor({ timeout: 15000 });

  for (const surface of SURFACES) {
    if (surface.file !== "todays-brief") {
      await page.locator(".brain-rail").getByRole("button", { name: surface.label }).first().click();
      await page.locator(surface.selector).waitFor({ timeout: 10000 });
      await page.waitForTimeout(300); // let the map's tiles/leaflet settle
    }
    await page.screenshot({ path: `${OUT_DIR}/${surface.file}-${suffix}.png`, fullPage: surface.file !== "map" });
  }
  await page.close();
}

await mkdir(OUT_DIR, { recursive: true });
await run("npm", ["run", "build"]);
await run("npx", ["playwright", "install", "chromium"]);
const preview = await waitForPreview();
let browser: Browser | null = null;
try {
  browser = await chromium.launch();
  await captureAt(browser, 1440, 900, "desktop");
  await captureAt(browser, 390, 844, "mobile");
} finally {
  if (browser) await browser.close();
  preview.kill("SIGTERM");
}

console.log(`design screenshots captured in ${OUT_DIR}`);
