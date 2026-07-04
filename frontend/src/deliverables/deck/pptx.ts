import type { Deliverable } from "../types.ts";
import type { World } from "../../app/useWorld.ts";
import { computeChart } from "../../metrics/chartSpec.ts";
import type { ChartSpec } from "../../metrics/types.ts";
import { addBarChartWithTable, addBullets, addChartSlide, addKpiStrip, addTitle, addTwoChartSlide, addVerdictSlide, createDeck } from "./layouts.ts";

export async function downloadBoardDeck(deliverable: Deliverable, world: World): Promise<void> {
  const pptx = createDeck();
  addTitle(pptx.addSlide(), deliverable.title, "Generated from deterministic BTX Revenue Brain metrics and provenance.");

  const verdict = deliverable.sections.find((s) => s.id === "quarter-verdict");
  const summary = deliverable.sections.find((s) => s.id === "executive-summary");
  const kpi = deliverable.sections.find((s) => s.id === "kpi-strip");
  const growth = deliverable.sections.find((s) => s.id === "growth");
  const predictability = deliverable.sections.find((s) => s.id === "predictability");
  const efficiency = deliverable.sections.find((s) => s.id === "efficiency");
  const concentration = deliverable.sections.find((s) => s.id === "concentration-risks");
  const risk = deliverable.sections.find((s) => s.id === "risk-register");
  const actions = deliverable.sections.find((s) => s.id === "priorities");

  if (verdict) addVerdictSlide(pptx.addSlide(), verdict.heading, textBlocks(verdict));
  if (kpi) {
    const table = kpi.blocks.find((b) => b.kind === "table");
    if (table?.kind === "table") {
      addKpiStrip(pptx.addSlide(), "Quarter in Metrics", table.rows.slice(0, 4).map((row) => ({ label: row[0], value: row[1], note: row[2] ?? "" })));
    }
  }

  if (summary) addBullets(pptx.addSlide(), summary.heading, textBlocks(summary));
  if (growth) {
    const charts = chartBlocks(growth).map((spec) => computeChart(spec, world));
    if (charts[0] && charts[1]) addTwoChartSlide(pptx.addSlide(), growth.heading, charts[0], charts[1], "Bookings and backlog show whether demand is adding durable work or merely replacing shipped volume.");
    if (charts[2]) addChartSlide(pptx.addSlide(), "Book-to-bill trend", charts[2], "A ratio above 1.0 means bookings exceed shipments and backlog should expand.");
  }
  if (predictability) {
    const chart = chartBlocks(predictability).map((spec) => computeChart(spec, world))[0];
    if (chart) addChartSlide(pptx.addSlide(), predictability.heading, chart, "The board target is 3.0x weighted coverage against average monthly revenue.");
  }
  if (efficiency) {
    const charts = chartBlocks(efficiency).map((spec) => computeChart(spec, world));
    if (charts[0] && charts[1]) addTwoChartSlide(pptx.addSlide(), efficiency.heading, charts[0], charts[1], "Capacity and order value determine whether growth is accretive or merely busy.");
  }
  if (concentration && risk) {
    const chart = chartBlocks(concentration).map((spec) => computeChart(spec, world))[0];
    const table = risk.blocks.find((b) => b.kind === "table");
    if (chart && table?.kind === "table") addBarChartWithTable(pptx.addSlide(), concentration.heading, chart, [table.columns, ...table.rows]);
  }
  if (actions) addBullets(pptx.addSlide(), actions.heading, textBlocks(actions));

  addBullets(pptx.addSlide(), "Provenance", deliverable.sources.map((s) => `${s.source}: ${s.reason}`));
  await pptx.writeFile({ fileName: `${deliverable.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.pptx` });
}

function textBlocks(section: Deliverable["sections"][number]): string[] {
  return section.blocks.filter((b) => b.kind === "text").map((b) => b.text);
}

function chartBlocks(section: Deliverable["sections"][number]): ChartSpec[] {
  return section.blocks.filter((b) => b.kind === "chart-spec").map((b) => b.spec as unknown as ChartSpec);
}
