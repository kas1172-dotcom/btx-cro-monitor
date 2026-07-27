const backendEndpoint = process.env.VITE_BACKEND_ENDPOINT?.trim() ?? "";
const clerkPublishableKey = process.env.VITE_CLERK_PUBLISHABLE_KEY?.trim() ?? "";
const clerkEnvironment = process.env.CLERK_DEPLOYMENT_ENVIRONMENT?.trim() || "production";

const errors: string[] = [];
const expectedClerkPrefix =
  clerkEnvironment === "development"
    ? "pk_test_"
    : clerkEnvironment === "production"
      ? "pk_live_"
      : "";

if (!expectedClerkPrefix) {
  errors.push("CLERK_DEPLOYMENT_ENVIRONMENT must be development or production.");
}

if (!backendEndpoint) {
  errors.push("VITE_BACKEND_ENDPOINT is required.");
} else {
  try {
    const url = new URL(backendEndpoint);
    if (url.protocol !== "https:") errors.push("VITE_BACKEND_ENDPOINT must use HTTPS.");
  } catch {
    errors.push("VITE_BACKEND_ENDPOINT must be a valid URL.");
  }
}

if (!clerkPublishableKey) {
  errors.push("VITE_CLERK_PUBLISHABLE_KEY is required.");
} else if (expectedClerkPrefix && !clerkPublishableKey.startsWith(expectedClerkPrefix)) {
  errors.push(
    `VITE_CLERK_PUBLISHABLE_KEY must be a ${clerkEnvironment} publishable key.`,
  );
}

if (errors.length) {
  for (const error of errors) console.error(`deployment configuration: ${error}`);
  process.exitCode = 1;
} else {
  console.log(
    `deployment configuration ok: HTTPS backend and ${clerkEnvironment} Clerk publishable key`,
  );
}
