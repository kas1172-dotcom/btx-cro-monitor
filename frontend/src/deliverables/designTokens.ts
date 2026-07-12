export const steelSignal = {
  colors: {
    navy: "#12263A",
    navyHex: "12263A",
    teal: "#2FB6A8",
    tealHex: "2FB6A8",
    steel: "#3E7CB1",
    steelHex: "3E7CB1",
    ink: "#12263A",
    inkHex: "12263A",
    muted: "#6B7787",
    mutedHex: "6B7787",
    bg: "#F6F8FB",
    bgHex: "F6F8FB",
    panel: "#EAEFF5",
    panelHex: "EAEFF5",
    white: "#FFFFFF",
    whiteHex: "FFFFFF",
    ice: "#AEC3D6",
    iceHex: "AEC3D6",
    line: "#D8E0EA",
    lineHex: "D8E0EA",
    tint: "#E7F4F2",
    tintHex: "E7F4F2",
    provenanceBorder: "#BFE3DD",
    provenanceBorderHex: "BFE3DD",
    provenanceInk: "#1E8C7E",
    provenanceInkHex: "1E8C7E",
    green: "#3FA66A",
    greenHex: "3FA66A",
    amber: "#E0A93B",
    amberHex: "E0A93B",
    red: "#D6533C",
    redHex: "D6533C",
  },
  font: {
    family: "\"Inter\", \"Segoe UI\", Arial, sans-serif",
    pptxFace: "Inter",
    weights: { regular: 400, bold: 700 },
    slide: {
      title: 30,
      sectionHeader: 17,
      body: 12.5,
      caption: 9.5,
      eyebrow: 11,
      stat: 40,
    },
    document: {
      h1: 34,
      section: 17,
      body: 12.5,
      caption: 10,
      eyebrow: 10.5,
    },
  },
  spacing: {
    pageWidth: 816,
    pageHeight: 1056,
    margin: 54,
    cardRadius: 8,
    slideWidth: 13.3,
    slideHeight: 7.5,
    slideMargin: 0.6,
  },
  motif: {
    circleFill: "teal",
    monogramFill: "navy",
  },
  footer: {
    confidential: "Confidential",
    illustrative: "Illustrative sample",
    document: "BTX Precision Machining  ·  Confidential  ·  Illustrative sample",
    board: "BTX Revenue Brain   ·   Confidential · Illustrative sample data",
    pitch: "BTX Precision Machining   ·   Sales pitch · Illustrative sample",
  },
} as const;

export type SteelSignalTokens = typeof steelSignal;

export function stripEmDashes(text: string): string {
  return text.replace(/—/g, ";").replace(/–/g, " to ");
}

export function assertNoEmDash(text: string): void {
  if (/[—–]/.test(text)) {
    throw new Error("Steel & Signal deliverables cannot contain em or en dashes.");
  }
}

export function steelSignalCss(): string {
  const c = steelSignal.colors;
  return `
@font-face{font-family:Inter;src:url("/assets/inter-latin-400-normal.woff2") format("woff2");font-weight:400;font-style:normal;font-display:swap}
@font-face{font-family:Inter;src:url("/assets/inter-latin-700-normal.woff2") format("woff2");font-weight:700;font-style:normal;font-display:swap}
:root{
  --ss-navy:${c.navy};--ss-teal:${c.teal};--ss-steel:${c.steel};--ss-ink:${c.ink};
  --ss-muted:${c.muted};--ss-bg:${c.bg};--ss-panel:${c.panel};--ss-white:${c.white};
  --ss-ice:${c.ice};--ss-line:${c.line};--ss-tint:${c.tint};
  --ss-prov-border:${c.provenanceBorder};--ss-prov-ink:${c.provenanceInk};
  --ss-green:${c.green};--ss-amber:${c.amber};--ss-red:${c.red};
  --ss-font:${steelSignal.font.family};
}
`.trim();
}
