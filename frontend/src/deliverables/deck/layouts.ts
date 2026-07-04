import pptxgen from "pptxgenjs";
import type { ChartResult } from "../../metrics/types.ts";

export const deckTheme = {
  bg: "11150E",
  panel: "202718",
  text: "F4F1DC",
  muted: "AEB79A",
  accent: "B7C46A",
};

export function createDeck(): pptxgen {
  const pptx = new pptxgen();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "BTX Revenue Brain";
  pptx.subject = "Deterministic CRO board deck";
  pptx.theme = {
    headFontFace: "Aptos Display",
    bodyFontFace: "Aptos",
  };
  return pptx;
}

export function addTitle(slide: pptxgen.Slide, title: string, subtitle: string): void {
  slide.background = { color: deckTheme.bg };
  slide.addText("BTX Revenue Brain", { x: 0.5, y: 0.35, w: 3, h: 0.3, color: deckTheme.accent, fontSize: 12, bold: true });
  slide.addText(title, { x: 0.5, y: 1.55, w: 11.5, h: 0.8, color: deckTheme.text, fontSize: 34, bold: true, fit: "shrink" });
  slide.addText(subtitle, { x: 0.55, y: 2.45, w: 9.5, h: 0.45, color: deckTheme.muted, fontSize: 15, fit: "shrink" });
}

export function addKpiStrip(slide: pptxgen.Slide, title: string, kpis: Array<{ label: string; value: string; note: string }>): void {
  slide.background = { color: deckTheme.bg };
  slide.addText(title, { x: 0.5, y: 0.35, w: 10.5, h: 0.45, color: deckTheme.text, fontSize: 22, bold: true });
  kpis.slice(0, 4).forEach((kpi, index) => {
    const x = 0.55 + index * 3.05;
    slide.addShape("roundRect", { x, y: 1.3, w: 2.72, h: 2.05, rectRadius: 0.08, fill: { color: deckTheme.panel }, line: { color: "39422C" } });
    slide.addText(kpi.value, { x: x + 0.18, y: 1.62, w: 2.35, h: 0.48, color: deckTheme.accent, fontSize: 24, bold: true, fit: "shrink" });
    slide.addText(kpi.label, { x: x + 0.18, y: 2.22, w: 2.35, h: 0.3, color: deckTheme.text, fontSize: 12, bold: true, fit: "shrink" });
    slide.addText(kpi.note, { x: x + 0.18, y: 2.62, w: 2.35, h: 0.42, color: deckTheme.muted, fontSize: 10, fit: "shrink" });
  });
}

export function addVerdictSlide(slide: pptxgen.Slide, title: string, lines: string[]): void {
  slide.background = { color: deckTheme.bg };
  slide.addText(title, { x: 0.5, y: 0.35, w: 11.6, h: 0.48, color: deckTheme.text, fontSize: 24, bold: true, fit: "shrink" });
  lines.slice(0, 3).forEach((line, index) => {
    slide.addShape("roundRect", { x: 0.75, y: 1.2 + index * 1.15, w: 10.8, h: 0.82, rectRadius: 0.06, fill: { color: deckTheme.panel }, line: { color: "39422C" } });
    slide.addText(line, { x: 1.0, y: 1.38 + index * 1.15, w: 10.25, h: 0.4, color: index === 0 ? deckTheme.accent : deckTheme.text, fontSize: index === 0 ? 18 : 15, bold: index === 0, fit: "shrink" });
  });
}

export function addChartSlide(slide: pptxgen.Slide, title: string, chart: ChartResult, soWhat: string): void {
  slide.background = { color: deckTheme.bg };
  slide.addText(title, { x: 0.5, y: 0.35, w: 11.5, h: 0.45, color: deckTheme.text, fontSize: 21, bold: true, fit: "shrink" });
  const series = chart.series?.[0];
  if (series) {
    slide.addChart("line", [{ name: series.label, labels: series.points.map((p) => p.x), values: series.points.map((p) => p.y) }], chartOptions());
  }
  slide.addShape("roundRect", { x: 8.85, y: 1.1, w: 3.25, h: 3.9, rectRadius: 0.08, fill: { color: deckTheme.panel }, line: { color: "39422C" } });
  slide.addText("So what", { x: 9.05, y: 1.35, w: 2.8, h: 0.28, color: deckTheme.accent, fontSize: 11, bold: true });
  slide.addText(soWhat, { x: 9.05, y: 1.78, w: 2.78, h: 2.2, color: deckTheme.text, fontSize: 13, fit: "shrink", breakLine: false });
}

export function addTwoChartSlide(slide: pptxgen.Slide, title: string, left: ChartResult, right: ChartResult, soWhat: string): void {
  slide.background = { color: deckTheme.bg };
  slide.addText(title, { x: 0.5, y: 0.35, w: 11.5, h: 0.45, color: deckTheme.text, fontSize: 21, bold: true, fit: "shrink" });
  const leftSeries = left.series?.[0];
  const rightSeries = right.series?.[0];
  if (leftSeries) slide.addChart("line", [{ name: leftSeries.label, labels: leftSeries.points.map((p) => p.x), values: leftSeries.points.map((p) => p.y) }], chartOptions(0.65, 1.1, 5.55, 3.25));
  if (rightSeries) slide.addChart("line", [{ name: rightSeries.label, labels: rightSeries.points.map((p) => p.x), values: rightSeries.points.map((p) => p.y) }], chartOptions(6.35, 1.1, 5.55, 3.25));
  slide.addText(soWhat, { x: 0.75, y: 4.75, w: 11.0, h: 0.38, color: deckTheme.accent, fontSize: 14, bold: true, fit: "shrink" });
}

export function addBarChartWithTable(slide: pptxgen.Slide, title: string, chart: ChartResult, tableRows: string[][]): void {
  slide.background = { color: deckTheme.bg };
  slide.addText(title, { x: 0.5, y: 0.35, w: 11.5, h: 0.45, color: deckTheme.text, fontSize: 21, bold: true, fit: "shrink" });
  const series = chart.series?.[0];
  if (series) slide.addChart("bar", [{ name: series.label, labels: series.points.slice(0, 6).map((p) => p.x), values: series.points.slice(0, 6).map((p) => p.y) }], chartOptions(0.55, 1.1, 5.55, 3.75));
  tableRows.slice(0, 6).forEach((row, rowIndex) => {
    row.slice(0, 4).forEach((cell, colIndex) => {
      slide.addText(cell, {
        x: 6.35 + colIndex * 1.45,
        y: 1.12 + rowIndex * 0.5,
        w: 1.35,
        h: 0.28,
        color: rowIndex === 0 ? deckTheme.accent : deckTheme.text,
        fontSize: rowIndex === 0 ? 9 : 8.5,
        bold: rowIndex === 0,
        fit: "shrink",
      });
    });
  });
}

export function addBullets(slide: pptxgen.Slide, title: string, bullets: string[]): void {
  slide.background = { color: deckTheme.bg };
  slide.addText(title, { x: 0.5, y: 0.35, w: 10.5, h: 0.45, color: deckTheme.text, fontSize: 22, bold: true });
  bullets.slice(0, 6).forEach((text, index) => {
    slide.addText(text, { x: 0.75, y: 1.2 + index * 0.72, w: 10.7, h: 0.38, color: deckTheme.text, fontSize: 14, bullet: { type: "bullet" }, fit: "shrink" });
  });
}

export function addTable(slide: pptxgen.Slide, title: string, rows: string[][]): void {
  slide.background = { color: deckTheme.bg };
  slide.addText(title, { x: 0.5, y: 0.35, w: 10.5, h: 0.45, color: deckTheme.text, fontSize: 22, bold: true });
  rows.slice(0, 7).forEach((row, rowIndex) => {
    row.slice(0, 4).forEach((cell, colIndex) => {
      slide.addText(cell, {
        x: 0.6 + colIndex * 2.9,
        y: 1.05 + rowIndex * 0.55,
        w: 2.65,
        h: 0.34,
        color: rowIndex === 0 ? deckTheme.accent : deckTheme.text,
        fontSize: rowIndex === 0 ? 11 : 10,
        bold: rowIndex === 0,
        fit: "shrink",
      });
    });
  });
}

function chartOptions(x = 0.65, y = 1.1, w = 7.85, h = 3.75): pptxgen.IChartOpts {
  return {
    x,
    y,
    w,
    h,
    showLegend: false,
    showTitle: false,
    catAxisLabelColor: deckTheme.muted,
    valAxisLabelColor: deckTheme.muted,
    valGridLine: { color: "39422C" },
    showValue: false,
    chartColors: [deckTheme.accent, "7FC7A6", "D3A95F"],
  };
}
