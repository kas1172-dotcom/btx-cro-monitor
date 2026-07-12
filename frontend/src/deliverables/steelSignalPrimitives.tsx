import type pptxgen from "pptxgenjs";
import React from "react";
import { steelSignal, stripEmDashes } from "./designTokens.ts";
import type { SignalRelationship, SignalScope } from "../engine/signals/contract.ts";

export const PROVENANCE_CONFIDENCE_FLOOR = 0.7;

export interface FigureMeta {
  number: number;
  title: string;
  xAxis: string;
  yAxis: string;
  caption: string;
  summary: string;
}

export function BrandMark({ size = 44 }: { size?: number }) {
  return (
    <span className="ss-brand-mark" style={{ width: size, height: size, fontSize: Math.max(11, size * 0.34) }}>
      BTX
    </span>
  );
}

export function ProvenanceCard({ relationship }: { relationship: SignalRelationship }) {
  assertRelationship(relationship);
  return (
    <aside className="ss-provenance-card" data-source-entity={relationship.source_entity_name}>
      <strong>SOURCE</strong>
      <span>
        <b>{stripEmDashes(relationship.source_entity_name)}</b>
        {" · "}
        match: {relationship.match_method.replace(/_/g, " ")}
        {" · "}
        {confidenceLabel(relationship.confidence)} confidence
      </span>
    </aside>
  );
}

export function Figure({ meta, children }: { meta: FigureMeta; children: React.ReactNode }) {
  assertFigureMeta(meta);
  return (
    <figure className="ss-figure" data-figure-number={meta.number}>
      <figcaption>
        <b>Figure {meta.number}. {stripEmDashes(meta.title)}</b>
      </figcaption>
      <div className="ss-figure-body">{children}</div>
      <div className="ss-axis-row">
        <span>X-axis: {stripEmDashes(meta.xAxis)}</span>
        <i aria-hidden="true">·</i>
        <span>Y-axis: {stripEmDashes(meta.yAxis)}</span>
      </div>
      <p className="ss-caption">{stripEmDashes(meta.caption)}</p>
      <p className="ss-summary">Summary: {stripEmDashes(meta.summary)}</p>
    </figure>
  );
}

export function ScopePill({ scope }: { scope: SignalScope }) {
  const account = scope === "specific_account";
  return <span className={`ss-pill ${account ? "ss-pill-account" : "ss-pill-market"}`}>{scope.replace(/_/g, " ")}</span>;
}

export function StatusPill({ status, children }: { status: "green" | "amber" | "red" | "steel"; children: React.ReactNode }) {
  return <span className={`ss-pill ss-pill-${status}`}>{children}</span>;
}

export function StatCallout({ value, label, sub }: { value: string; label: string; sub?: string }) {
  return (
    <div className="ss-stat">
      <i />
      <strong>{stripEmDashes(value)}</strong>
      <span>{stripEmDashes(label)}</span>
      {sub && <em>{stripEmDashes(sub)}</em>}
    </div>
  );
}

export function TellShowSoWhatBlock({ number, title, tell, show, showSub, soWhat }: {
  number: string;
  title: string;
  tell: string;
  show: string;
  showSub: string;
  soWhat: string;
}) {
  return (
    <article className="ss-story-card">
      <div className="ss-story-head"><span>{number}</span><h2>{stripEmDashes(title)}</h2></div>
      <p className="ss-eyebrow">Tell me</p>
      <p>{stripEmDashes(tell)}</p>
      <div className="ss-story-grid">
        <div className="ss-show"><p className="ss-eyebrow">Show me</p><strong>{stripEmDashes(show)}</strong><span>{stripEmDashes(showSub)}</span></div>
        <div className="ss-so-what"><p className="ss-eyebrow">So what</p><span>{stripEmDashes(soWhat)}</span></div>
      </div>
    </article>
  );
}

export interface CapacityRow {
  facility: string;
  fiveAxisCenters: string;
  shifts: string;
  utilization: string;
  available: string;
}

export function CapacityTable({ rows }: { rows: CapacityRow[] }) {
  return (
    <table className="ss-capacity-table">
      <thead><tr><th>Facility</th><th>5-axis centers</th><th>Shifts</th><th>Utilization</th><th>Available</th></tr></thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.facility}>
            <td>{stripEmDashes(row.facility)}</td>
            <td>{row.fiveAxisCenters}</td>
            <td>{row.shifts}</td>
            <td>{row.utilization}</td>
            <td><StatusPill status={capacityStatus(row.available)}>{stripEmDashes(row.available)}</StatusPill></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function addPptxBrandMark(slide: pptxgen.Slide, pptx: pptxgen, x: number, y: number, size = 0.5): void {
  const c = steelSignal.colors;
  slide.addShape(pptx.ShapeType.ellipse, { x, y, w: size, h: size, fill: { color: c.tealHex }, line: { color: c.tealHex } });
  slide.addText("BTX", {
    x,
    y,
    w: size,
    h: size,
    fontFace: steelSignal.font.pptxFace,
    fontSize: 15,
    bold: true,
    color: c.navyHex,
    align: "center",
    valign: "middle",
    margin: 0,
  });
}

export function addPptxProvenanceCard(slide: pptxgen.Slide, pptx: pptxgen, relationship: SignalRelationship, x: number, y: number, w: number): void {
  assertRelationship(relationship);
  const c = steelSignal.colors;
  slide.addShape(pptx.ShapeType.roundRect, {
    x,
    y,
    w,
    h: 0.62,
    rectRadius: 0.06,
    fill: { color: c.tintHex },
    line: { color: c.provenanceBorderHex, width: 1 },
  });
  slide.addText("SOURCE", { x: x + 0.2, y: y + 0.09, w: 1.1, h: 0.2, fontFace: steelSignal.font.pptxFace, fontSize: 8.5, bold: true, color: c.provenanceInkHex, charSpacing: 2, margin: 0 });
  slide.addText([
    { text: stripEmDashes(relationship.source_entity_name), options: { bold: true, color: c.inkHex } },
    { text: `   ·   match: ${relationship.match_method.replace(/_/g, " ")}   ·   ${confidenceLabel(relationship.confidence)} confidence`, options: { color: c.mutedHex } },
  ], { x: x + 0.2, y: y + 0.28, w: w - 0.4, h: 0.28, fontFace: steelSignal.font.pptxFace, fontSize: 10, margin: 0, valign: "middle" });
}

export function addPptxFigureLabel(slide: pptxgen.Slide, meta: FigureMeta, x: number, y: number, w: number): void {
  assertFigureMeta(meta);
  const c = steelSignal.colors;
  slide.addText([
    { text: `Figure ${meta.number}.  `, options: { bold: true, color: c.inkHex } },
    { text: `${stripEmDashes(meta.title)}. X-axis: ${stripEmDashes(meta.xAxis)}; Y-axis: ${stripEmDashes(meta.yAxis)}. ${stripEmDashes(meta.caption)} Summary: ${stripEmDashes(meta.summary)}`, options: { color: c.mutedHex } },
  ], { x, y, w, h: 0.85, fontFace: steelSignal.font.pptxFace, fontSize: 9.5, margin: 0, valign: "top" });
}

export function assertRelationship(relationship: SignalRelationship): void {
  if (!relationship.source_entity_name || relationship.confidence < PROVENANCE_CONFIDENCE_FLOOR) {
    throw new Error("Account-linked claims require a high-confidence relationship record.");
  }
}

export function assertFigureMeta(meta: FigureMeta): void {
  const missing = [meta.number, meta.title, meta.xAxis, meta.yAxis, meta.caption, meta.summary].some((value) => value === "" || value === null || value === undefined);
  if (missing) throw new Error("Figures require number, title, axis labels with units, caption, and summary.");
  if (!/\(.+\)|%|\$|quarter|date|year|account|facility/i.test(meta.xAxis) || !/\(.+\)|%|\$|revenue|utilization|count|value/i.test(meta.yAxis)) {
    throw new Error("Figure axes must include labels with units.");
  }
}

function confidenceLabel(confidence: number): string {
  if (confidence >= 0.9) return "high";
  if (confidence >= PROVENANCE_CONFIDENCE_FLOOR) return "medium";
  return "low";
}

function capacityStatus(value: string): "green" | "amber" | "red" | "steel" {
  const normalized = value.toLowerCase();
  if (normalized.includes("now")) return "green";
  if (normalized.includes("limited") || normalized.includes("q")) return "amber";
  if (normalized.includes("none") || normalized.includes("full")) return "red";
  return "steel";
}
