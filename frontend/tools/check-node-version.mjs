const supported = "22.18.0";
const actual = process.versions.node;
const strict = process.env.CI === "true" || process.env.RELEASE_GATE_STRICT_NODE === "1";

if (actual !== supported) {
  const message = `Unsupported Node.js ${actual}. Release-critical runs require ${supported}; run 'nvm use' from the repository root.`;
  if (strict) {
    console.error(message);
    process.exit(1);
  }
  console.warn(`${message} Continuing because this is a non-strict local run.`);
} else {
  console.log(`node ok: ${actual}`);
}
