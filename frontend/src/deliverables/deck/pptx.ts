import pptxgenModule from "pptxgenjs";
import type pptxgen from "pptxgenjs";
import type { Deliverable } from "../types.ts";
import type { World } from "../../app/useWorld.ts";
import type { Company } from "../../engine/brain/entities.ts";
import type { SignalRelationship } from "../../engine/signals/contract.ts";
import { steelSignal, stripEmDashes, assertNoEmDash } from "../designTokens.ts";
import {
  addPptxBrandMark,
  addPptxFigureLabel,
  addPptxProvenanceCard,
  type FigureMeta,
} from "../steelSignalPrimitives.tsx";
import { assertSteelSignalExportable, relationshipForCompany } from "../steelSignalTemplates.tsx";

const W = steelSignal.spacing.slideWidth;
const H = steelSignal.spacing.slideHeight;
const M = steelSignal.spacing.slideMargin;
const C = steelSignal.colors;
const FONT = steelSignal.font.pptxFace;

export function buildBoardDeck(deliverable: Deliverable, world: World): pptxgen {
  assertSteelSignalExportable(deliverable, world);
  const pptx = createSteelDeck("BTX Revenue Brain");
  const focus = focusCompany(deliverable, world);
  const relationship = relationshipForCompany(world, focus) ?? sampleRelationship(focus?.name ?? "HubSpot CRM + monitor artifact");

  let slide = pptx.addSlide();
  slide.background = { color: C.navyHex };
  addPptxBrandMark(slide, pptx, M, 2.1);
  text(slide, "REVENUE BRAIN", M + 0.7, 2.18, 8, 0.36, 13, C.tealHex, true, 3);
  text(slide, "Quarterly Revenue & Account Board Review", M, 2.95, 11.5, 1.5, 40, C.whiteHex, true);
  text(slide, "Signal-to-action intelligence for precision machining & defense supply", M, 4.35, 11, 0.5, 16, C.iceHex);
  rich(slide, [{ text: "FY26 · Q3 Board Packet", options: { bold: true, color: C.whiteHex } }, { text: "        Confidential", options: { color: C.iceHex } }], M, 6.4, 11, 0.35, 12);
  slide.addNotes("Cover. BTX Revenue Brain quarterly board review. All figures illustrative sample data.");

  slide = pptx.addSlide();
  bg(slide);
  head(slide, pptx, "Executive summary", "The quarter in four numbers");
  stat(slide, pptx, M, 1.7, 2.75, "$18.4M", "Bookings", "+12% vs prior quarter", C.tealHex);
  stat(slide, pptx, M + 2.95, 1.7, 2.75, "1.18", "Book-to-bill", "Above 1.0 target", C.greenHex);
  stat(slide, pptx, M + 5.9, 1.7, 2.75, "87%", "Capacity used", "Approaching ceiling", C.amberHex);
  stat(slide, pptx, M + 8.85, 1.7, 2.75, "$42.1M", "Qualified pipeline", "3.1x coverage", C.steelHex);
  text(slide, "What changed this quarter", M, 3.75, 8, 0.35, 16, C.inkHex, true);
  [
    ["F-35 sustainment demand is accelerating", "Lockheed lot-19 spares create a build-to-print opening matched to BTX 5-axis capacity.", C.greenHex],
    ["A tier-1 supplier delay opens a re-shore lane", "Spirit AeroSystems structures slip; two programs need a domestic AS9100 machining partner.", C.tealHex],
    ["Capacity is the binding constraint, not demand", "Two facilities cross 90% utilization; winning more requires a capacity decision.", C.amberHex],
  ].forEach(([title, detail, color], index) => {
    const y = 4.2 + index * 0.72;
    slide.addShape(pptx.ShapeType.ellipse, { x: M, y: y + 0.05, w: 0.18, h: 0.18, fill: { color: String(color) }, line: { color: String(color) } });
    rich(slide, [{ text: `${title}   `, options: { bold: true, color: C.inkHex } }, { text: String(detail), options: { color: C.mutedHex } }], M + 0.35, y - 0.06, W - 2 * M - 0.35, 0.5, 12.5);
  });
  footer(slide, 2);

  chartSlide(slide = pptx.addSlide(), pptx, 1, "Revenue snapshot", "Bookings and backlog trend", {
    labels: ["Q4 FY25", "Q1 FY26", "Q2 FY26", "Q3 FY26"],
    series: [{ name: "Bookings ($M)", values: [14.2, 15.1, 16.4, 18.4] }, { name: "Backlog ($M)", values: [38.0, 40.2, 41.1, 44.6] }],
    meta: {
      number: 1,
      title: "Bookings and backlog by fiscal quarter",
      xAxis: "Fiscal quarter",
      yAxis: "$ millions",
      caption: "Bookings and backlog show whether demand is adding durable work or replacing shipped volume.",
      summary: "Bookings rose to $18.4M while backlog expanded, indicating capacity-limited conversion.",
    },
    read: "Backlog is growing faster than bookings",
    soWhat: "Demand is not the problem; converting backlog against finite capacity is. The board decision this quarter is capacity, covered later in the deck.",
    relationship,
  });

  slide = pptx.addSlide();
  bg(slide);
  head(slide, pptx, "Account in focus", `${focus?.name ?? "Priority account"}: F-35 sustainment`);
  card(slide, pptx, M, 1.75, 6.1, 3.05, C.whiteHex);
  text(slide, "Capability fit", M + 0.3, 1.95, 5, 0.3, 11, C.tealHex, true, 2);
  text(slide, "91%", M + 0.3, 2.2, 2.4, 0.9, 52, C.inkHex, true);
  text(slide, "5-axis CNC · build-to-print · AS9100 · ITAR-registered, matched against lot-19 spares scope.", M + 2.7, 2.35, 3.1, 1.1, 12, C.mutedHex);
  pill(slide, pptx, M + 0.3, 3.55, "specific account", C.navyHex);
  pill(slide, pptx, M + 1.9, 3.55, "contract award", C.greenHex);
  text(slide, "Top signal: Lockheed awards F-35 lot-19 sustainment; spares volume rises into FY27.", M + 0.3, 3.95, 5.5, 0.7, 12.5, C.inkHex);
  card(slide, pptx, M + 6.4, 1.75, W - M - (M + 6.4), 3.05, C.navyHex, C.navyHex);
  text(slide, "RECOMMENDED ACTION", M + 6.7, 1.98, 5, 0.3, 11, C.tealHex, true, 2);
  text(slide, "Open a build-to-print RFQ conversation on lot-19 spares", M + 6.7, 2.32, 5.2, 1.0, 18, C.whiteHex, true);
  rich(slide, [{ text: "Owner: ", options: { bold: true, color: C.iceHex } }, { text: "VP Sales", options: { color: C.whiteHex } }, { text: "     Due: ", options: { bold: true, color: C.iceHex } }, { text: "5 business days", options: { color: C.whiteHex } }], M + 6.7, 3.5, 5.2, 0.3, 12);
  addPptxProvenanceCard(slide, pptx, relationship, M, 5.0, W - 2 * M);
  footer(slide, 4);

  slide = pptx.addSlide();
  bg(slide);
  head(slide, pptx, "Market signals", "What changed, tiered by relevance");
  [
    ["Lockheed F-35 lot-19 sustainment award", "specific account", C.greenHex, `${relationship.source_entity_name} · ${relationship.match_method.replace(/_/g, " ")} · high`],
    ["Spirit AeroSystems structures schedule slip", "program", C.amberHex, "Program match · medium"],
    ["DoD FY27 budget lifts precision-component demand", "market", C.steelHex, "Portfolio-level · unlinked · n/a"],
    ["New ITAR guidance on machining data handling", "market", C.steelHex, "Portfolio-level · unlinked · n/a"],
  ].forEach(([title, scope, color, prov], index) => {
    const y = 1.75 + index * 1.13;
    card(slide, pptx, M, y, W - 2 * M, 1.0, C.whiteHex);
    slide.addShape(pptx.ShapeType.ellipse, { x: M + 0.28, y: y + 0.4, w: 0.2, h: 0.2, fill: { color: String(color) }, line: { color: String(color) } });
    text(slide, String(title), M + 0.7, y + 0.14, 7.2, 0.4, 14.5, C.inkHex, true);
    text(slide, String(prov), M + 0.7, y + 0.54, 7.6, 0.3, 10, C.mutedHex);
    pill(slide, pptx, W - M - 2.0, y + 0.36, String(scope), String(color));
  });
  footer(slide, 5);

  chartSlide(pptx.addSlide(), pptx, 2, "Capacity assessment", "The binding constraint on growth", {
    labels: ["Fort Worth", "Wichita", "Tulsa"],
    series: [{ name: "Utilization %", values: [93, 88, 71] }],
    meta: {
      number: 2,
      title: "Facility capacity utilization, current quarter",
      xAxis: "Facility",
      yAxis: "Capacity utilization (%)",
      caption: "Facility utilization shows whether demand can be absorbed without schedule risk.",
      summary: "Fort Worth at 93% is the binding constraint; Tulsa has headroom but lacks the required line.",
    },
    read: "Fort Worth is effectively full",
    soWhat: "At 93% utilization, the F-35 opportunity cannot be absorbed without a second shift or capital add.",
    relationship,
  });

  slide = pptx.addSlide();
  bg(slide);
  head(slide, pptx, "Risks & watch items", "What could bend the number");
  [["Capacity ceiling", C.redHex, "Winning F-35 without added capacity risks on-time delivery on existing backlog."], ["Single-prime concentration", C.amberHex, "Lockheed would exceed 40% of bookings; diversify with the Spirit re-shore lane."], ["ITAR data-handling change", C.amberHex, "New guidance may add compliance cost to machining-data workflows; assess by Q4."]].forEach(([title, color, detail], index) => {
    const x = M + index * ((W - 2 * M - 0.6) / 3 + 0.3);
    const cw = (W - 2 * M - 0.6) / 3;
    card(slide, pptx, x, 1.9, cw, 3.6, C.whiteHex);
    slide.addShape(pptx.ShapeType.ellipse, { x: x + 0.35, y: 2.25, w: 0.3, h: 0.3, fill: { color: String(color) }, line: { color: String(color) } });
    text(slide, String(title), x + 0.35, 2.75, cw - 0.7, 0.7, 17, C.inkHex, true);
    text(slide, String(detail), x + 0.35, 3.5, cw - 0.7, 1.7, 12.5, C.mutedHex);
  });
  footer(slide, 7);

  slide = pptx.addSlide();
  bg(slide);
  head(slide, pptx, "Recommended actions", "What we do next, and who owns it");
  slide.addTable([
    ["Action", "Account", "Owner", "Due"],
    ["Open lot-19 build-to-print RFQ", focus?.name ?? "Priority account", "VP Sales", "5 days"],
    ["Approve Fort Worth second shift", "Internal", "COO / Board", "This quarter"],
    ["Qualify Spirit re-shore lane", "Spirit AeroSystems", "BD Lead", "2 weeks"],
    ["Scope ITAR data-handling change", "Internal", "Compliance", "Q4"],
  ].map((row, ri) => row.map((cell, ci) => ({ text: cell, options: { fontFace: FONT, fontSize: ri === 0 ? 12 : 13, bold: ri === 0, color: ri === 0 ? C.whiteHex : C.inkHex, fill: { color: ri === 0 ? C.navyHex : (ri % 2 ? C.whiteHex : C.panelHex) }, align: ci === 3 ? "center" : "left", valign: "middle", margin: [4, 8, 4, 8] } }))), { x: M, y: 1.85, w: W - 2 * M, colW: [4.9, 3.2, 2.2, 1.8], rowH: [0.5, 0.62, 0.62, 0.62, 0.62], border: { type: "solid", color: C.lineHex, pt: 1 } });
  addPptxProvenanceCard(slide, pptx, relationship, M, 5.7, W - 2 * M);
  footer(slide, 8);

  slide = pptx.addSlide();
  slide.background = { color: C.navyHex };
  addPptxBrandMark(slide, pptx, M, 2.3);
  text(slide, "The decision this quarter", M, 3.05, 11, 0.9, 34, C.whiteHex, true);
  text(slide, "Approve a Fort Worth second shift to convert the F-35 sustainment opening. The demand is evidenced, the fit is 91%, and capacity is the only thing standing between backlog and bookings.", M, 4.05, 11.2, 1.3, 16, C.iceHex);
  text(slide, "Sources: HubSpot CRM · monitor-engine market artifacts · ERP capacity · SAM.gov entity registry. Account links resolved via canonical relationship records. Figures illustrative.", M, 6.35, 11.2, 0.6, 10, C.iceHex);

  validateDeckText([
    "Quarterly Revenue & Account Board Review",
    "The quarter in four numbers",
    relationship.source_entity_name,
  ]);
  return pptx;
}

export function buildSalesPitch(deliverable: Deliverable, world: World): pptxgen {
  assertSteelSignalExportable(deliverable, world);
  const pptx = createSteelDeck("BTX Precision Machining");
  const company = focusCompany(deliverable, world);

  let slide = pptx.addSlide();
  slide.background = { color: C.navyHex };
  addPptxBrandMark(slide, pptx, M, 1.9);
  text(slide, `FOR ${company?.name ?? "TARGET ACCOUNT"} · F-35 SUSTAINMENT`, M + 0.7, 1.98, 10, 0.36, 12, C.tealHex, true, 2);
  text(slide, "A domestic 5-axis partner with AS9100 capacity available now", M, 2.75, 11.6, 1.6, 34, C.whiteHex, true);
  text(slide, "Build-to-print spares delivered with a 99.2% on-time record and open capacity to take load off your schedule this quarter.", M, 4.5, 11.4, 0.9, 15, C.iceHex);
  text(slide, "Prepared for a supply-chain introduction · Confidential", M, 6.5, 11, 0.3, 11, C.iceHex);

  slide = pptx.addSlide();
  bg(slide);
  head(slide, pptx, "The case in figures", "What this partnership is worth to both sides");
  addPitchChart(slide, pptx, M, 1, C.tealHex, "BTX revenue ($M)", "$ millions", [4.3, 6.1, 7.8], "Projected BTX revenue from the account, internal view", "Revenue ramps to $7.8M by FY28 as lot-19 spares scale.");
  addPitchChart(slide, pptx, M + 6.2, 2, C.steelHex, "Client value ($M/yr)", "$ millions / year", [1.9, 2.6, 3.2], "Projected value to the client, external view", "Value reflects expedite avoidance, scrap reduction, and dual-source risk relief.");
  footer(slide, 2, steelSignal.footer.pitch);

  slide = pptx.addSlide();
  bg(slide);
  head(slide, pptx, "The ask", "A 20-minute introduction");
  [["1", "Intro call", "Walk your build-to-print spares scope and our current capacity windows."], ["2", "Capability review", "Share AS9100 / ITAR docs, sample first articles, and quality record."], ["3", "Pilot package", "Quote a first lot-19 spares package against your priority parts."]].forEach(([n, title, detail], index) => {
    const cw = (W - 2 * M - 0.6) / 3;
    const x = M + index * (cw + 0.3);
    card(slide, pptx, x, 1.9, cw, 3.3, C.whiteHex);
    slide.addShape(pptx.ShapeType.ellipse, { x: x + 0.35, y: 2.25, w: 0.5, h: 0.5, fill: { color: C.tealHex }, line: { color: C.tealHex } });
    text(slide, n, x + 0.35, 2.25, 0.5, 0.5, 20, C.whiteHex, true, 0, "center");
    text(slide, title, x + 0.35, 3.0, cw - 0.7, 0.5, 17, C.inkHex, true);
    text(slide, detail, x + 0.35, 3.55, cw - 0.7, 1.5, 12.5, C.mutedHex);
  });
  card(slide, pptx, M, 5.5, W - 2 * M, 0.95, C.navyHex, C.navyHex);
  rich(slide, [{ text: "Next step:  ", options: { bold: true, color: C.tealHex } }, { text: "reply with a 20-minute window, or we can hold two options for your team this week.", options: { color: C.whiteHex } }], M + 0.3, 5.5, W - 2 * M - 0.6, 0.95, 15);
  footer(slide, 3, steelSignal.footer.pitch);

  return pptx;
}

export async function downloadBoardDeck(deliverable: Deliverable, world: World): Promise<void> {
  await buildBoardDeck(deliverable, world).writeFile({ fileName: `${slug(deliverable.title)}.pptx` });
}

export async function downloadSalesPitch(deliverable: Deliverable, world: World): Promise<void> {
  await buildSalesPitch(deliverable, world).writeFile({ fileName: `${slug(deliverable.title)}.pptx` });
}

function createSteelDeck(subject: string): pptxgen {
  const PptxGen = ((pptxgenModule as unknown as { default?: typeof pptxgenModule }).default ?? pptxgenModule) as unknown as new () => pptxgen;
  const pptx = new PptxGen();
  pptx.defineLayout({ name: "SS_WIDE", width: W, height: H });
  pptx.layout = "SS_WIDE";
  pptx.author = "BTX Revenue Brain";
  pptx.company = "BTX";
  pptx.subject = subject;
  pptx.theme = { headFontFace: FONT, bodyFontFace: FONT };
  return pptx;
}

function bg(slide: pptxgen.Slide): void {
  slide.background = { color: C.bgHex };
}

function head(slide: pptxgen.Slide, pptx: pptxgen, eyebrow: string, title: string): void {
  slide.addShape(pptx.ShapeType.ellipse, { x: M, y: M, w: 0.26, h: 0.26, fill: { color: C.tealHex }, line: { color: C.tealHex } });
  text(slide, eyebrow.toUpperCase(), M + 0.4, M - 0.03, 10, 0.3, 11, C.tealHex, true, 2);
  text(slide, title, M, M + 0.32, W - 2 * M, 0.7, 30, C.inkHex, true);
}

function stat(slide: pptxgen.Slide, pptx: pptxgen, x: number, y: number, w: number, big: string, label: string, sub: string, accent: string): void {
  card(slide, pptx, x, y, w, 1.65, C.whiteHex);
  slide.addShape(pptx.ShapeType.ellipse, { x: x + 0.28, y: y + 0.28, w: 0.16, h: 0.16, fill: { color: accent }, line: { color: accent } });
  text(slide, big, x + 0.24, y + 0.42, w - 0.48, 0.75, 40, C.inkHex, true);
  text(slide, label, x + 0.28, y + 1.12, w - 0.5, 0.28, 12.5, C.inkHex, true);
  text(slide, sub, x + 0.28, y + 1.36, w - 0.5, 0.24, 9.5, C.mutedHex);
}

function chartSlide(slide: pptxgen.Slide, pptx: pptxgen, _figureNumber: number, eyebrow: string, title: string, input: { labels: string[]; series: Array<{ name: string; values: number[] }>; meta: FigureMeta; read: string; soWhat: string; relationship: SignalRelationship }): void {
  bg(slide);
  head(slide, pptx, eyebrow, title);
  slide.addChart(pptx.ChartType.bar, input.series.map((series) => ({ name: series.name, labels: input.labels, values: series.values })), {
    x: M,
    y: 1.6,
    w: 7.6,
    h: 4.35,
    barDir: "col",
    barGrouping: "clustered",
    chartColors: [C.tealHex, C.steelHex],
    showTitle: false,
    showLegend: input.series.length > 1,
    legendPos: "t",
    legendColor: C.mutedHex,
    legendFontSize: 11,
    legendFontFace: FONT,
    showValue: true,
    dataLabelPosition: "outEnd",
    dataLabelColor: C.inkHex,
    dataLabelFontSize: 10,
    dataLabelFontFace: FONT,
    catAxisTitle: input.meta.xAxis,
    showCatAxisTitle: true,
    catAxisTitleColor: C.mutedHex,
    catAxisTitleFontSize: 10,
    catAxisTitleFontFace: FONT,
    catAxisLabelColor: C.mutedHex,
    catAxisLabelFontFace: FONT,
    valAxisTitle: input.meta.yAxis,
    showValAxisTitle: true,
    valAxisTitleColor: C.mutedHex,
    valAxisTitleFontSize: 10,
    valAxisTitleFontFace: FONT,
    valAxisHidden: true,
    valGridLine: { style: "none" },
    barGapWidthPct: 55,
  });
  addPptxFigureLabel(slide, input.meta, M, 6.0, 7.6);
  card(slide, pptx, 8.5, 1.7, W - M - 8.5, 4.9, C.whiteHex);
  text(slide, "Read", 8.8, 1.95, 3.5, 0.3, 11, C.tealHex, true, 2);
  text(slide, input.read, 8.8, 2.25, 3.7, 0.7, 16, C.inkHex, true);
  text(slide, input.soWhat, 8.8, 3.05, 3.7, 2.0, 12, C.mutedHex);
  addPptxProvenanceCard(slide, pptx, input.relationship, 8.5, 5.98, W - M - 8.5);
  footer(slide, input.meta.number + 2);
}

function addPitchChart(slide: pptxgen.Slide, pptx: pptxgen, x: number, figureNumber: number, color: string, name: string, yAxis: string, values: number[], title: string, summary: string): void {
  slide.addChart(pptx.ChartType.bar, [{ name, labels: ["FY26", "FY27", "FY28"], values }], {
    x,
    y: 1.65,
    w: 5.9,
    h: 3.7,
    barDir: "col",
    chartColors: [color],
    showTitle: false,
    showLegend: false,
    showValue: true,
    dataLabelPosition: "outEnd",
    dataLabelFormatCode: '"$"0.0"M"',
    dataLabelColor: C.inkHex,
    dataLabelFontSize: 11,
    dataLabelFontFace: FONT,
    catAxisTitle: "Fiscal year",
    showCatAxisTitle: true,
    catAxisTitleColor: C.mutedHex,
    catAxisTitleFontSize: 9,
    catAxisTitleFontFace: FONT,
    valAxisTitle: yAxis,
    showValAxisTitle: true,
    valAxisTitleColor: C.mutedHex,
    valAxisTitleFontSize: 9,
    valAxisTitleFontFace: FONT,
    valAxisHidden: true,
    valGridLine: { style: "none" },
    barGapWidthPct: 55,
  });
  addPptxFigureLabel(slide, { number: figureNumber, title, xAxis: "Fiscal year", yAxis, caption: "Projection uses qualified pipeline and account-fit assumptions.", summary }, x, 5.45, 5.9);
}

function card(slide: pptxgen.Slide, pptx: pptxgen, x: number, y: number, w: number, h: number, fill: string, line: string = C.panelHex): void {
  slide.addShape(pptx.ShapeType.roundRect, { x, y, w, h, rectRadius: 0.08, fill: { color: fill }, line: { color: line, width: 1 } });
}

function pill(slide: pptxgen.Slide, pptx: pptxgen, x: number, y: number, label: string, color: string): number {
  const w = Math.max(1.25, 0.32 + label.length * 0.095);
  slide.addShape(pptx.ShapeType.roundRect, { x, y, w, h: 0.28, rectRadius: 0.14, fill: { color }, line: { color } });
  text(slide, label.toUpperCase(), x, y, w, 0.28, 8.5, C.whiteHex, true, 1, "center");
  return w;
}

function text(slide: pptxgen.Slide, value: string, x: number, y: number, w: number, h: number, fontSize: number, color: string, bold = false, charSpacing = 0, align: "left" | "center" | "right" = "left"): void {
  const clean = stripEmDashes(value);
  slide.addText(clean, { x, y, w, h, fontFace: FONT, fontSize, bold, color, charSpacing, margin: 0, valign: "middle", fit: "shrink", align });
}

function rich(slide: pptxgen.Slide, runs: Array<{ text: string; options?: Record<string, unknown> }>, x: number, y: number, w: number, h: number, fontSize: number): void {
  slide.addText(runs.map((run) => ({ ...run, text: stripEmDashes(run.text) })), { x, y, w, h, fontFace: FONT, fontSize, margin: 0, valign: "middle", fit: "shrink" });
}

function footer(slide: pptxgen.Slide, n: number, label: string = steelSignal.footer.board): void {
  rich(slide, [{ text: label, options: { color: C.mutedHex } }], M, H - 0.42, 9, 0.3, 9);
  text(slide, String(n), W - 1.1, H - 0.42, 0.5, 0.3, 9, C.mutedHex, false, 0, "right");
}

function focusCompany(deliverable: Deliverable, world: World): Company | null {
  const ids = new Set(deliverable.entityIds);
  return world.companies.find((company) => ids.has(company.id) || (company.canonical_account_id && ids.has(company.canonical_account_id))) ?? world.companies[0] ?? null;
}

function sampleRelationship(sourceEntity: string): SignalRelationship {
  return {
    canonical_account_id: "sample",
    source_entity_name: sourceEntity,
    match_method: "manual",
    evidence: "Reference sample relationship",
    confidence: 0.95,
    review_status: "accepted",
    creation_source: "manual",
    last_validated_at: null,
  };
}

function slug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function validateDeckText(values: string[]): void {
  for (const value of values) assertNoEmDash(value);
}
