import type { Deliverable, DeliverableBlock } from "./types.ts";

function blockToMarkdown(block: DeliverableBlock): string {
  if (block.kind === "text") return block.text;
  if (block.kind === "table") {
    const header = `| ${block.columns.join(" | ")} |`;
    const divider = `| ${block.columns.map(() => "---").join(" | ")} |`;
    const rows = block.rows.map((row) => `| ${row.join(" | ")} |`);
    return [header, divider, ...rows].join("\n");
  }
  if (block.kind === "chart-spec") return `Chart: ${block.title}\n\n\`\`\`json\n${JSON.stringify(block.spec, null, 2)}\n\`\`\``;
  return `Map: ${block.title}\n\nEntities: ${block.entityIds.join(", ")}`;
}

export function deliverableToMarkdown(deliverable: Deliverable): string {
  const sections = deliverable.sections.map((section) => [
    `## ${section.heading}`,
    ...section.blocks.map(blockToMarkdown),
  ].join("\n\n"));
  const sources = deliverable.sources.map((source) => `- ${source.source}: ${source.reason} (${source.records.join(", ")})`);
  return [
    `# ${deliverable.title}`,
    `Created: ${deliverable.createdAt}`,
    `Confidence: ${deliverable.confidence}`,
    ...sections,
    "## Provenance",
    ...sources,
  ].join("\n\n");
}
