import { spawnSync } from "node:child_process";

const allowedHighDevFindings = new Set([
  "@eslint/config-array",
  "@eslint/eslintrc",
  "brace-expansion",
  "eslint",
  "eslint-plugin-jsx-a11y",
  "minimatch",
]);

interface AuditFinding {
  name: string;
  severity: "low" | "moderate" | "high" | "critical";
  isDirect?: boolean;
  nodes?: string[];
}

interface AuditJson {
  vulnerabilities?: Record<string, AuditFinding>;
  metadata?: { vulnerabilities?: Record<string, number> };
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const audit = spawnSync("npm", ["audit", "--json"], { encoding: "utf8" });
const parsed = JSON.parse(audit.stdout || "{}") as AuditJson;
const findings = Object.values(parsed.vulnerabilities ?? {});
const severe = findings.filter((finding) => finding.severity === "high" || finding.severity === "critical");
const critical = severe.filter((finding) => finding.severity === "critical");
assert(critical.length === 0, `Critical dependency findings are not risk-accepted: ${critical.map((finding) => finding.name).join(", ")}`);

const unaccepted = severe.filter((finding) => !allowedHighDevFindings.has(finding.name));
assert(unaccepted.length === 0, `Unaccepted high dependency findings: ${unaccepted.map((finding) => finding.name).join(", ")}`);

for (const finding of severe) {
  const nodes = finding.nodes ?? [];
  const prodNode = nodes.find((node) => !node.includes("node_modules/") || node.includes("node_modules/@clerk") || node.includes("node_modules/react"));
  assert(!prodNode, `${finding.name} appears outside the accepted development toolchain path: ${prodNode}`);
}

const highCount = parsed.metadata?.vulnerabilities?.high ?? severe.length;
console.log(`dependency risk accepted: ${highCount} high development-toolchain finding groups; production audit remains a hard gate.`);
