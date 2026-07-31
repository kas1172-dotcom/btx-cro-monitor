import { spawnSync } from "node:child_process";

function runValidate(env: NodeJS.ProcessEnv): number {
  const result = spawnSync("tsx", ["tools/validate-production-env.ts"], {
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result.status ?? 1;
}

const demoStatus = runValidate({
  VITE_BACKEND_ENDPOINT: "https://api.example.test",
  VITE_CLERK_PUBLISHABLE_KEY: "pk_test_ci",
  CLERK_DEPLOYMENT_ENVIRONMENT: "development",
  VITE_DEPLOYMENT_MODE: "demo",
  VITE_DEPLOYED_REVISION: "779198f",
});
if (demoStatus !== 0) throw new Error("Demo deployment environment contract was rejected.");

const badProductionStatus = runValidate({
  VITE_BACKEND_ENDPOINT: "https://api.example.test",
  VITE_CLERK_PUBLISHABLE_KEY: "pk_test_ci",
  CLERK_DEPLOYMENT_ENVIRONMENT: "development",
  VITE_DEPLOYMENT_MODE: "production",
  VITE_DEPLOYED_REVISION: "779198f",
});
if (badProductionStatus === 0) throw new Error("Production accepted Clerk development credentials.");

console.log("environment gate ok: demo accepted, production rejects development Clerk credentials");
