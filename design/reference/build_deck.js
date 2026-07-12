const pptxgen = require("pptxgenjs");
const p = new pptxgen();
p.defineLayout({ name: "W", width: 13.3, height: 7.5 });
p.layout = "W";
p.author = "BTX Revenue Brain";
p.company = "BTX";

// ---- Steel & Signal palette ----
const NAVY = "12263A", NAVY2 = "1B3A57", TEAL = "2FB6A8", STEEL = "3E7CB1";
const BG = "F6F8FB", PANEL = "EAEFF5", INK = "12263A", MUTED = "6B7787";
const WHITE = "FFFFFF", GREEN = "3FA66A", AMBER = "E0A93B", RED = "D6533C";
const TINT = "E7F4F2"; // teal tint for provenance cards
const HEAD = "Inter", BODY = "Inter";
const W = 13.3, H = 7.5, M = 0.6;

function bg(slide, color) { slide.background = { color }; }

function footer(slide, n) {
  slide.addText([
    { text: "BTX Revenue Brain", options: { bold: true, color: MUTED } },
    { text: "   ·   Confidential · Illustrative sample data", options: { color: MUTED } },
  ], { x: M, y: H - 0.42, w: 9, h: 0.3, fontFace: BODY, fontSize: 9, align: "left", margin: 0, valign: "middle" });
  slide.addText(String(n), { x: W - 1.1, y: H - 0.42, w: 0.5, h: 0.3, fontFace: BODY, fontSize: 9, color: MUTED, align: "right", margin: 0, valign: "middle" });
}

function head(slide, eyebrow, title) {
  slide.addShape(p.ShapeType.ellipse, { x: M, y: M, w: 0.26, h: 0.26, fill: { color: TEAL } });
  slide.addText(eyebrow.toUpperCase(), { x: M + 0.4, y: M - 0.03, w: 10, h: 0.3, fontFace: BODY, fontSize: 11, bold: true, color: TEAL, charSpacing: 2, margin: 0, valign: "middle" });
  slide.addText(title, { x: M, y: M + 0.32, w: W - 2 * M, h: 0.7, fontFace: HEAD, fontSize: 30, bold: true, color: INK, margin: 0 });
}

function stat(slide, x, y, w, big, label, sub, accent) {
  const h = 1.65;
  slide.addShape(p.ShapeType.roundRect, { x, y, w, h, rectRadius: 0.08, fill: { color: WHITE }, line: { color: PANEL, width: 1 }, shadow: { type: "outer", color: "9FB0C3", blur: 6, offset: 2, angle: 90, opacity: 0.35 } });
  slide.addShape(p.ShapeType.ellipse, { x: x + 0.28, y: y + 0.28, w: 0.16, h: 0.16, fill: { color: accent || TEAL } });
  slide.addText(big, { x: x + 0.24, y: y + 0.42, w: w - 0.48, h: 0.75, fontFace: HEAD, fontSize: 40, bold: true, color: INK, margin: 0, align: "left" });
  slide.addText(label, { x: x + 0.28, y: y + 1.12, w: w - 0.5, h: 0.28, fontFace: BODY, fontSize: 12.5, bold: true, color: INK, margin: 0 });
  if (sub) slide.addText(sub, { x: x + 0.28, y: y + 1.36, w: w - 0.5, h: 0.24, fontFace: BODY, fontSize: 9.5, color: MUTED, margin: 0 });
}

function provenance(slide, x, y, w, entity, method, confidence) {
  const h = 0.62;
  slide.addShape(p.ShapeType.roundRect, { x, y, w, h, rectRadius: 0.06, fill: { color: TINT }, line: { color: "BFE3DD", width: 1 } });
  slide.addText("SOURCE", { x: x + 0.2, y: y + 0.09, w: 1.1, h: 0.2, fontFace: BODY, fontSize: 8.5, bold: true, color: "1E8C7E", charSpacing: 2, margin: 0 });
  slide.addText([
    { text: entity, options: { bold: true, color: INK } },
    { text: `   ·   match: ${method}   ·   ${confidence} confidence`, options: { color: MUTED } },
  ], { x: x + 0.2, y: y + 0.28, w: w - 0.4, h: 0.28, fontFace: BODY, fontSize: 10, margin: 0, valign: "middle" });
}

function pill(slide, x, y, text, color) {
  const w = 0.16 + text.length * 0.075;
  slide.addShape(p.ShapeType.roundRect, { x, y, w, h: 0.28, rectRadius: 0.14, fill: { color } });
  slide.addText(text.toUpperCase(), { x, y, w, h: 0.28, fontFace: BODY, fontSize: 8.5, bold: true, color: WHITE, align: "center", valign: "middle", margin: 0, charSpacing: 1 });
  return w;
}

// =================== SLIDE 1 — COVER ===================
let s = p.addSlide(); bg(s, NAVY);
s.addShape(p.ShapeType.ellipse, { x: M, y: 2.1, w: 0.5, h: 0.5, fill: { color: TEAL } });
s.addText("BTX", { x: M, y: 2.1, w: 0.5, h: 0.5, fontFace: HEAD, fontSize: 15, bold: true, color: NAVY, align: "center", valign: "middle", margin: 0 });
s.addText("REVENUE BRAIN", { x: M + 0.7, y: 2.18, w: 8, h: 0.36, fontFace: BODY, fontSize: 13, bold: true, color: TEAL, charSpacing: 3, margin: 0, valign: "middle" });
s.addText("Quarterly Revenue & Account Board Review", { x: M, y: 2.95, w: 11.5, h: 1.5, fontFace: HEAD, fontSize: 40, bold: true, color: WHITE, margin: 0 });
s.addText("Signal-to-action intelligence for precision machining & defense supply", { x: M, y: 4.35, w: 11, h: 0.5, fontFace: BODY, fontSize: 16, color: "AEC3D6", margin: 0 });
s.addText([
  { text: "FY26 · Q3 Board Packet", options: { bold: true, color: WHITE } },
  { text: "        Confidential", options: { color: "8AA0B6" } },
], { x: M, y: 6.4, w: 11, h: 0.35, fontFace: BODY, fontSize: 12, margin: 0 });
s.addNotes("Cover. BTX Revenue Brain quarterly board review. All figures illustrative sample data.");

// =================== SLIDE 2 — EXEC SUMMARY ===================
s = p.addSlide(); bg(s, BG);
head(s, "Executive summary", "The quarter in four numbers");
stat(s, M, 1.7, 2.75, "$18.4M", "Bookings", "+12% vs prior quarter", TEAL);
stat(s, M + 2.95, 1.7, 2.75, "1.18", "Book-to-bill", "Above 1.0 target", GREEN);
stat(s, M + 5.9, 1.7, 2.75, "87%", "Capacity used", "Approaching ceiling", AMBER);
stat(s, M + 8.85, 1.7, 2.75, "$42.1M", "Qualified pipeline", "3.1x coverage", STEEL);
s.addText("What changed this quarter", { x: M, y: 3.75, w: 8, h: 0.35, fontFace: HEAD, fontSize: 16, bold: true, color: INK, margin: 0 });
const rows = [
  ["F-35 sustainment demand is accelerating", "Lockheed lot-19 spares create a build-to-print opening matched to BTX 5-axis capacity.", GREEN],
  ["A tier-1 supplier delay opens a re-shore lane", "Spirit AeroSystems structures slip; two programs need a domestic AS9100 machining partner.", TEAL],
  ["Capacity is the binding constraint, not demand", "Two facilities cross 90% utilization; winning more requires a capacity decision.", AMBER],
];
let ry = 4.2;
rows.forEach(([t, d, c]) => {
  s.addShape(p.ShapeType.ellipse, { x: M, y: ry + 0.05, w: 0.18, h: 0.18, fill: { color: c } });
  s.addText([
    { text: t + "   ", options: { bold: true, color: INK } },
    { text: d, options: { color: MUTED } },
  ], { x: M + 0.35, y: ry - 0.06, w: W - 2 * M - 0.35, h: 0.5, fontFace: BODY, fontSize: 12.5, margin: 0, valign: "middle" });
  ry += 0.72;
});
footer(s, 2);
s.addNotes("Executive summary: five headline metrics, then the three things that actually changed and why they matter to revenue.");

// =================== SLIDE 3 — REVENUE SNAPSHOT (chart) ===================
s = p.addSlide(); bg(s, BG);
head(s, "Revenue snapshot", "Bookings and backlog trend");
s.addChart(p.ChartType.bar, [
  { name: "Bookings ($M)", labels: ["Q4 FY25", "Q1 FY26", "Q2 FY26", "Q3 FY26"], values: [14.2, 15.1, 16.4, 18.4] },
  { name: "Backlog ($M)", labels: ["Q4 FY25", "Q1 FY26", "Q2 FY26", "Q3 FY26"], values: [38.0, 40.2, 41.1, 44.6] },
], {
  x: M, y: 1.6, w: 7.6, h: 4.35, barDir: "col", barGrouping: "clustered",
  chartColors: [TEAL, STEEL], showTitle: false, showLegend: true, legendPos: "t", legendColor: MUTED, legendFontSize: 11, legendFontFace: BODY,
  showValue: true, dataLabelPosition: "outEnd", dataLabelColor: INK, dataLabelFontSize: 10, dataLabelFontFace: BODY, dataLabelFormatCode: "0.0",
  catAxisTitle: "Fiscal quarter", showCatAxisTitle: true, catAxisTitleColor: MUTED, catAxisTitleFontSize: 10, catAxisTitleFontFace: BODY,
  catAxisLabelColor: MUTED, catAxisLabelFontFace: BODY, catAxisLabelFontSize: 11, catGridLine: { style: "none" },
  valAxisTitle: "$ millions", showValAxisTitle: true, valAxisTitleColor: MUTED, valAxisTitleFontSize: 10, valAxisTitleFontFace: BODY,
  valAxisHidden: true, valGridLine: { style: "none" }, valAxisLabelColor: MUTED,
  barGapWidthPct: 55,
});
s.addText([
  { text: "Figure 1.  ", options: { bold: true, color: INK } },
  { text: "Bookings and backlog by fiscal quarter ($M). Bookings rose 12% to $18.4M; backlog is growing faster, indicating capacity-limited conversion.", options: { color: MUTED } },
], { x: M, y: 6.05, w: 7.6, h: 0.7, fontFace: BODY, fontSize: 10, margin: 0, valign: "top" });
s.addShape(p.ShapeType.roundRect, { x: 8.5, y: 1.7, w: W - M - 8.5, h: 4.9, rectRadius: 0.08, fill: { color: WHITE }, line: { color: PANEL, width: 1 } });
s.addText("Read", { x: 8.8, y: 1.95, w: 3.5, h: 0.3, fontFace: BODY, fontSize: 11, bold: true, color: TEAL, charSpacing: 2, margin: 0 });
s.addText("Backlog is growing faster than bookings", { x: 8.8, y: 2.25, w: 3.7, h: 0.7, fontFace: HEAD, fontSize: 16, bold: true, color: INK, margin: 0 });
s.addText("Book-to-bill held at 1.18 for a third straight quarter. Demand is not the problem; converting backlog against finite capacity is. The board decision this quarter is capacity, covered on slide 6.", { x: 8.8, y: 3.05, w: 3.7, h: 2.0, fontFace: BODY, fontSize: 12, color: MUTED, margin: 0 });
provenance(s, 8.5, 5.98, W - M - 8.5, "HubSpot deals + ERP bookings", "canonical account roll-up", "high");
footer(s, 3);
s.addNotes("Bookings vs backlog over four quarters. Point: healthy demand, capacity-limited conversion.");

// =================== SLIDE 4 — ACCOUNT IN FOCUS ===================
s = p.addSlide(); bg(s, BG);
head(s, "Account in focus", "Lockheed Martin: F-35 sustainment");
s.addShape(p.ShapeType.roundRect, { x: M, y: 1.75, w: 6.1, h: 3.05, rectRadius: 0.08, fill: { color: WHITE }, line: { color: PANEL, width: 1 } });
s.addText("Capability fit", { x: M + 0.3, y: 1.95, w: 5, h: 0.3, fontFace: BODY, fontSize: 11, bold: true, color: TEAL, charSpacing: 2, margin: 0 });
s.addText("91%", { x: M + 0.3, y: 2.2, w: 2.4, h: 0.9, fontFace: HEAD, fontSize: 52, bold: true, color: INK, margin: 0 });
s.addText("5-axis CNC · build-to-print · AS9100 · ITAR-registered, matched against lot-19 spares scope.", { x: M + 2.7, y: 2.35, w: 3.1, h: 1.1, fontFace: BODY, fontSize: 12, color: MUTED, margin: 0 });
let px = M + 0.3; const pw1 = pill(s, px, 3.55, "specific account", NAVY); px += pw1 + 0.15;
const pw2 = pill(s, px, 3.55, "contract award", GREEN); px += pw2 + 0.15;
pill(s, px, 3.55, "high value", TEAL);
s.addText("Top signal:  “Lockheed awards F-35 lot-19 sustainment; spares volume rises into FY27.”", { x: M + 0.3, y: 3.95, w: 5.5, h: 0.7, fontFace: BODY, fontSize: 12.5, italic: true, color: INK, margin: 0 });
s.addShape(p.ShapeType.roundRect, { x: M + 6.4, y: 1.75, w: W - M - (M + 6.4), h: 3.05, rectRadius: 0.08, fill: { color: NAVY } });
s.addText("RECOMMENDED ACTION", { x: M + 6.7, y: 1.98, w: 5, h: 0.3, fontFace: BODY, fontSize: 11, bold: true, color: TEAL, charSpacing: 2, margin: 0 });
s.addText("Open a build-to-print RFQ conversation on lot-19 spares", { x: M + 6.7, y: 2.32, w: 5.2, h: 1.0, fontFace: HEAD, fontSize: 18, bold: true, color: WHITE, margin: 0 });
s.addText([
  { text: "Owner: ", options: { bold: true, color: "AEC3D6" } }, { text: "VP Sales", options: { color: WHITE } },
  { text: "     Due: ", options: { bold: true, color: "AEC3D6" } }, { text: "5 business days", options: { color: WHITE } },
], { x: M + 6.7, y: 3.5, w: 5.2, h: 0.3, fontFace: BODY, fontSize: 12, margin: 0 });
s.addText("Draft outreach + capabilities one-pager are prepared and awaiting approval.", { x: M + 6.7, y: 3.85, w: 5.2, h: 0.7, fontFace: BODY, fontSize: 11.5, color: "AEC3D6", margin: 0 });
provenance(s, M, 5.0, W - 2 * M, "Monitor artifact → Lockheed Martin Corp (CAGE 81755)", "CAGE + program (F-35)", "high");
s.addText("Every account claim on this page resolves through a canonical-account relationship record, not a text guess.", { x: M, y: 5.75, w: W - 2 * M, h: 0.4, fontFace: BODY, fontSize: 10.5, italic: true, color: MUTED, margin: 0 });
footer(s, 4);
s.addNotes("Account deep-dive with the signature provenance block. Fit, signal, scope pills, recommended action with owner/due, and the source relationship record.");

// =================== SLIDE 5 — MARKET SIGNALS ===================
s = p.addSlide(); bg(s, BG);
head(s, "Market signals", "What changed, tiered by relevance");
const sig = [
  ["Lockheed F-35 lot-19 sustainment award", "specific account", GREEN, "Lockheed Martin Corp · CAGE match · high"],
  ["Spirit AeroSystems structures schedule slip", "program", AMBER, "Spirit AeroSystems · program match · medium"],
  ["DoD FY27 budget lifts precision-component demand", "market", STEEL, "Portfolio-level · unlinked · n/a"],
  ["New ITAR guidance on machining data handling", "market", STEEL, "Portfolio-level · unlinked · n/a"],
];
let y = 1.75;
sig.forEach(([t, scope, c, prov]) => {
  s.addShape(p.ShapeType.roundRect, { x: M, y, w: W - 2 * M, h: 1.0, rectRadius: 0.06, fill: { color: WHITE }, line: { color: PANEL, width: 1 } });
  s.addShape(p.ShapeType.ellipse, { x: M + 0.28, y: y + 0.4, w: 0.2, h: 0.2, fill: { color: c } });
  s.addText(t, { x: M + 0.7, y: y + 0.14, w: 7.2, h: 0.4, fontFace: HEAD, fontSize: 14.5, bold: true, color: INK, margin: 0, valign: "middle" });
  s.addText(prov, { x: M + 0.7, y: y + 0.54, w: 7.6, h: 0.3, fontFace: BODY, fontSize: 10, color: MUTED, margin: 0, valign: "middle" });
  pill(s, W - M - 2.0, y + 0.36, scope, c);
  y += 1.13;
});
footer(s, 5);
s.addNotes("Tiered signals. Note that market-scope items are shown honestly as portfolio-level / unlinked, never pinned to a specific account without evidence.");

// =================== SLIDE 6 — CAPACITY vs DEMAND ===================
s = p.addSlide(); bg(s, BG);
head(s, "Capacity assessment", "The binding constraint on growth");
s.addChart(p.ChartType.bar, [
  { name: "Utilization %", labels: ["Fort Worth", "Wichita", "Tulsa"], values: [93, 88, 71] },
], {
  x: M, y: 1.7, w: 7.4, h: 4.2, barDir: "col",
  chartColors: [TEAL, TEAL, STEEL],
  showTitle: false, showLegend: false,
  showValue: true, dataLabelPosition: "outEnd", dataLabelColor: INK, dataLabelFontSize: 12, dataLabelFontFace: BODY, dataLabelFormatCode: '0"%"',
  catAxisTitle: "Facility", showCatAxisTitle: true, catAxisTitleColor: MUTED, catAxisTitleFontSize: 10, catAxisTitleFontFace: BODY,
  catAxisLabelColor: INK, catAxisLabelFontFace: BODY, catAxisLabelFontSize: 12, catGridLine: { style: "none" },
  valAxisTitle: "Capacity utilization (%)", showValAxisTitle: true, valAxisTitleColor: MUTED, valAxisTitleFontSize: 10, valAxisTitleFontFace: BODY,
  valAxisHidden: true, valGridLine: { style: "none" }, valAxisMaxVal: 100, barGapWidthPct: 60,
});
s.addText([
  { text: "Figure 2.  ", options: { bold: true, color: INK } },
  { text: "Facility capacity utilization, current quarter (%). Fort Worth at 93% is the binding constraint; Tulsa at 71% has headroom but lacks the AS9100 line for this scope.", options: { color: MUTED } },
], { x: M, y: 6.0, w: 7.4, h: 0.7, fontFace: BODY, fontSize: 10, margin: 0, valign: "top" });
s.addShape(p.ShapeType.roundRect, { x: 8.3, y: 1.8, w: W - M - 8.3, h: 4.7, rectRadius: 0.08, fill: { color: WHITE }, line: { color: PANEL, width: 1 } });
s.addText("Decision", { x: 8.6, y: 2.05, w: 3.5, h: 0.3, fontFace: BODY, fontSize: 11, bold: true, color: TEAL, charSpacing: 2, margin: 0 });
s.addText("Fort Worth is effectively full", { x: 8.6, y: 2.35, w: 3.8, h: 0.7, fontFace: HEAD, fontSize: 16, bold: true, color: INK, margin: 0 });
s.addText("At 93% utilization, the F-35 opportunity cannot be absorbed without a second shift or capital add. Tulsa has headroom but lacks the AS9100 line for this scope.", { x: 8.6, y: 3.15, w: 3.8, h: 1.6, fontFace: BODY, fontSize: 12, color: MUTED, margin: 0 });
s.addText([{ text: "Ask: ", options: { bold: true, color: INK } }, { text: "approve a Fort Worth second shift to capture lot-19.", options: { color: INK } }], { x: 8.6, y: 5.5, w: 3.8, h: 0.8, fontFace: BODY, fontSize: 12.5, margin: 0 });
footer(s, 6);
s.addNotes("Capacity is BTX's differentiator view: ties machining capacity to the demand signal. Fort Worth is the constraint; the board ask is a second shift.");

// =================== SLIDE 7 — RISKS ===================
s = p.addSlide(); bg(s, BG);
head(s, "Risks & watch items", "What could bend the number");
const risks = [
  ["Capacity ceiling", RED, "Winning F-35 without added capacity risks on-time delivery on existing backlog."],
  ["Single-prime concentration", AMBER, "Lockheed would exceed 40% of bookings; diversify with the Spirit re-shore lane."],
  ["ITAR data-handling change", AMBER, "New guidance may add compliance cost to machining-data workflows; assess by Q4."],
];
let rx = M;
const cw = (W - 2 * M - 0.6) / 3;
risks.forEach(([t, c, d]) => {
  s.addShape(p.ShapeType.roundRect, { x: rx, y: 1.9, w: cw, h: 3.6, rectRadius: 0.08, fill: { color: WHITE }, line: { color: PANEL, width: 1 } });
  s.addShape(p.ShapeType.ellipse, { x: rx + 0.35, y: 2.25, w: 0.3, h: 0.3, fill: { color: c } });
  s.addText(t, { x: rx + 0.35, y: 2.75, w: cw - 0.7, h: 0.7, fontFace: HEAD, fontSize: 17, bold: true, color: INK, margin: 0 });
  s.addText(d, { x: rx + 0.35, y: 3.5, w: cw - 0.7, h: 1.7, fontFace: BODY, fontSize: 12.5, color: MUTED, margin: 0 });
  rx += cw + 0.3;
});
footer(s, 7);
s.addNotes("Three watch items with severity dots. Concentration and capacity are the two the board should weigh against the F-35 upside.");

// =================== SLIDE 8 — RECOMMENDED ACTIONS ===================
s = p.addSlide(); bg(s, BG);
head(s, "Recommended actions", "What we do next, and who owns it");
const rowsA = [
  ["Action", "Account", "Owner", "Due"],
  ["Open lot-19 build-to-print RFQ", "Lockheed Martin", "VP Sales", "5 days"],
  ["Approve Fort Worth second shift", "Internal", "COO / Board", "This quarter"],
  ["Qualify Spirit re-shore lane", "Spirit AeroSystems", "BD Lead", "2 weeks"],
  ["Scope ITAR data-handling change", "Internal", "Compliance", "Q4"],
];
const tableColW = [4.9, 3.2, 2.2, 1.8];
s.addTable(rowsA.map((r, ri) => r.map((cell, ci) => ({
  text: cell,
  options: {
    fontFace: BODY, fontSize: ri === 0 ? 12 : 13, bold: ri === 0,
    color: ri === 0 ? WHITE : INK, fill: { color: ri === 0 ? NAVY : (ri % 2 ? WHITE : PANEL) },
    align: ci === 3 ? "center" : "left", valign: "middle", margin: [4, 8, 4, 8],
  },
}))), { x: M, y: 1.85, w: W - 2 * M, colW: tableColW, rowH: [0.5, 0.62, 0.62, 0.62, 0.62], border: { type: "solid", color: "D8E0EA", pt: 1 } });
provenance(s, M, 5.7, W - 2 * M, "Generated from work-item queue", "canonical account + relationship record", "high");
footer(s, 8);
s.addNotes("Action table maps each recommendation to account, owner, and due date, the durable work-loop output. Provenance confirms each links to a real account.");

// =================== SLIDE 9 — CLOSE ===================
s = p.addSlide(); bg(s, NAVY);
s.addShape(p.ShapeType.ellipse, { x: M, y: 2.3, w: 0.5, h: 0.5, fill: { color: TEAL } });
s.addText("BTX", { x: M, y: 2.3, w: 0.5, h: 0.5, fontFace: HEAD, fontSize: 15, bold: true, color: NAVY, align: "center", valign: "middle", margin: 0 });
s.addText("The decision this quarter", { x: M, y: 3.05, w: 11, h: 0.9, fontFace: HEAD, fontSize: 34, bold: true, color: WHITE, margin: 0 });
s.addText("Approve a Fort Worth second shift to convert the F-35 sustainment opening. The demand is evidenced, the fit is 91%, and capacity is the only thing standing between backlog and bookings.", { x: M, y: 4.05, w: 11.2, h: 1.3, fontFace: BODY, fontSize: 16, color: "AEC3D6", margin: 0 });
s.addText("Sources: HubSpot CRM · monitor-engine market artifacts · ERP capacity · SAM.gov entity registry. Account links resolved via canonical relationship records. Figures illustrative.", { x: M, y: 6.35, w: 11.2, h: 0.6, fontFace: BODY, fontSize: 10, color: "7E93A9", margin: 0 });
s.addNotes("Close on the single decision. Restate the evidence chain and list sources.");

p.writeFile({ fileName: "/sessions/compassionate-gallant-ptolemy/mnt/outputs/BTX_Board_Deck_Template.pptx" }).then(f => console.log("WROTE", f));
