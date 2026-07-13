import { spawn } from "node:child_process";
import { chromium, type Page } from "playwright";
import { greetingForTime } from "../src/app/greeting.ts";

const BASE_URL = "http://127.0.0.1:4176";

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

async function openHome(page: Page): Promise<void> {
  await page.getByRole("button", { name: /Today'?s Brief|Home/i }).first().click();
  await page.locator("[data-surface-component='surface-todays-brief']").waitFor({ timeout: 10000 });
}

async function assertHome(page: Page): Promise<number> {
  const home = page.locator("[data-surface-component='surface-todays-brief']");
  await home.waitFor({ timeout: 15000 });
  await home.getByText("Daily briefing").waitFor();
  await home.locator(".today-mini-brief").waitFor();
  await home.locator(".today-attention-strip").waitFor();
  await home.locator(".ask-brain").waitFor();
  assert(await home.locator(".brief-grid").count() === 0, "Home must not render the old KPI grid.");
  assert(!(await home.innerText()).includes("Queue snapshot"), "Home must not render the old six-panel labels.");
  const itemCount = await home.locator(".today-brief-item").count();
  assert(itemCount > 0 && itemCount <= 5, `Mini-brief should render 1-5 items, got ${itemCount}.`);
  await home.getByText(`${itemCount} item${itemCount === 1 ? "" : "s"}`).waitFor();
  const seedValue = await home.locator(".ask-brain-form input").inputValue();
  assert(seedValue.trim().length > 0, "Ask bar should be pre-seeded from the top mini-brief item.");
  return itemCount;
}

assert(greetingForTime(new Date("2026-07-13T09:00:00"), "Kapil") === "Good morning, Kapil", "Morning greeting should include the provided name.");
assert(greetingForTime(new Date("2026-07-13T14:00:00"), "Kapil") === "Good afternoon, Kapil", "Afternoon greeting should include the provided name.");
assert(greetingForTime(new Date("2026-07-13T19:00:00"), "Kapil") === "Good evening, Kapil", "Evening greeting should include the provided name.");

await run("npm", ["run", "build"], {
  ...process.env,
  VITE_DATA_MODE: "demo",
  VITE_CLERK_PUBLISHABLE_KEY: "",
  VITE_COCKPIT_PASSWORD_HASH: "",
});
const preview = await waitForPreview();
let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
try {
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  const itemCount = await assertHome(page);

  await page.locator("[data-surface-component='surface-todays-brief'] .today-brief-item button").first().click();
  await page.locator([
    "[data-surface-component='surface-account-360']",
    "[data-surface-component='surface-analysis-dashboard']",
    "[data-surface-component='surface-program-contract-tracker']",
    "[data-surface-component='surface-work-queue']",
  ].join(", ")).first().waitFor({ timeout: 10000 });

  await openHome(page);
  await page.getByRole("button", { name: /Accounts needing attention/i }).click();
  await page.locator("[data-surface-component='surface-account-360']").waitFor({ timeout: 10000 });

  await openHome(page);
  await page.getByRole("button", { name: /Deliverables awaiting approval/i }).click();
  await page.locator("[data-surface-component='surface-work-queue']").waitFor({ timeout: 10000 });

  await openHome(page);
  await page.getByRole("button", { name: /Deadlines this week/i }).click();
  await page.locator("[data-surface-component='surface-program-contract-tracker']").waitFor({ timeout: 10000 });

  await page.close();
  console.log(`home brief ok: ${itemCount} mini-brief items and all Home links navigate`);
} finally {
  if (browser) await browser.close();
  preview.kill("SIGTERM");
}
