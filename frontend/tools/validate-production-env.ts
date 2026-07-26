const backendEndpoint = process.env.VITE_BACKEND_ENDPOINT?.trim() ?? "";
const clerkPublishableKey = process.env.VITE_CLERK_PUBLISHABLE_KEY?.trim() ?? "";

const errors: string[] = [];

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
} else if (!clerkPublishableKey.startsWith("pk_live_")) {
  errors.push("VITE_CLERK_PUBLISHABLE_KEY must be a production publishable key.");
}

if (errors.length) {
  for (const error of errors) console.error(`production configuration: ${error}`);
  process.exitCode = 1;
} else {
  console.log("production configuration ok: HTTPS backend and production Clerk publishable key");
}
