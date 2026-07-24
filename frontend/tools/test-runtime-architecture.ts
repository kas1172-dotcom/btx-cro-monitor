import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const srcRoot = join(root, "src");

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return walk(path);
    return /\.(ts|tsx)$/u.test(path) ? [path] : [];
  });
}

const activeEntrypoints = [
  "src/main.tsx",
  "src/App.tsx",
  "src/app/useWorld.ts",
  "src/app/useOperatingSnapshot.ts",
  "src/app/revenueDataClient.ts",
].map((path) => join(root, path));

for (const path of activeEntrypoints) {
  const text = readFileSync(path, "utf8");
  assert(!text.includes("createDataAdapter"), `${relative(root, path)} imports legacy data adapter factory`);
  assert(!text.includes("CockpitDataAdapter"), `${relative(root, path)} imports legacy cockpit adapter`);
  assert(!text.includes("cockpitAccess"), `${relative(root, path)} imports removed shared-password gate`);
}

const forbiddenRuntimeTokens = [
  "VITE_DATA_MODE",
  "VITE_ARTIFACT_BASE_URL",
  "VITE_COCKPIT_PASSWORD",
  "VITE_COCKPIT_PASSWORD_HASH",
];

for (const path of walk(srcRoot)) {
  const rel = relative(root, path);
  if (rel.startsWith("src/adapters/demo/")) continue;
  const text = readFileSync(path, "utf8");
  for (const token of forbiddenRuntimeTokens) {
    assert(!text.includes(token), `${rel} references removed runtime token ${token}`);
  }
}

console.log("runtime architecture ok: production entrypoints use backend world snapshot and Clerk only");
