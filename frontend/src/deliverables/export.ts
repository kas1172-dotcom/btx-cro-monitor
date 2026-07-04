import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import ExcelJS from "exceljs";
import type { Deliverable, DeliverableBlock, DeliverableSection, DeliverableType } from "./types.ts";
import { deliverableToMarkdown } from "./markdown.ts";

export type DownloadFormat = "markdown" | "docx" | "pdf" | "pptx" | "xlsx" | "csv" | "ics";

export const DELIVERABLE_DOWNLOAD_FORMATS: Record<DeliverableType, DownloadFormat[]> = {
  outreach: ["docx", "pdf", "markdown"],
  meeting_brief: ["docx", "pdf", "markdown"],
  weekly_memo: ["docx", "pdf", "markdown"],
  itinerary: ["docx", "pdf", "ics", "markdown"],
  board_deck: ["pptx", "pdf", "markdown"],
  analysis_view: ["xlsx", "csv", "pdf", "markdown"],
  sales_pitch: ["docx", "pdf", "markdown"],
  capabilities_assessment: ["docx", "pdf", "markdown"],
};

export function downloadFile(filename: string, content: BlobPart, type: string): void {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function slugTitle(deliverable: Pick<Deliverable, "title">): string {
  return deliverable.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function exportSections(deliverable: Deliverable): DeliverableSection[] {
  if (deliverable.form === "email") {
    return deliverable.sections.filter((section) => ["recipient", "subject", "body"].includes(section.id));
  }
  return deliverable.sections;
}

function blockText(block: DeliverableBlock): string {
  if (block.kind === "text") return block.text;
  if (block.kind === "table") return [block.columns.join("\t"), ...block.rows.map((row) => row.join("\t"))].join("\n");
  if (block.kind === "chart-spec") return `${block.title}\n${JSON.stringify(block.spec, null, 2)}`;
  return `${block.title}\n${(block.stops ?? []).map((stop, index) => `${index + 1}. ${stop.label}`).join("\n")}`;
}

function emailSubject(deliverable: Deliverable): string {
  const subject = deliverable.sections.find((section) => section.id === "subject");
  const block = subject?.blocks.find((item) => item.kind === "text");
  return block?.kind === "text" ? block.text : deliverable.title;
}

function emailBody(deliverable: Deliverable): string {
  const body = deliverable.sections.find((section) => section.id === "body");
  return body?.blocks.map(blockText).join("\n\n") ?? "";
}

export async function downloadDocx(deliverable: Deliverable): Promise<void> {
  const sections = exportSections(deliverable);
  const children: Array<Paragraph | Table> = [
    new Paragraph({ text: deliverable.form === "email" ? emailSubject(deliverable) : deliverable.title, heading: HeadingLevel.TITLE }),
  ];

  for (const section of sections) {
    if (deliverable.form !== "email" || section.id !== "body") {
      children.push(new Paragraph({ text: section.heading, heading: HeadingLevel.HEADING_2 }));
    }
    for (const block of section.blocks) {
      if (block.kind === "text") {
        for (const line of block.text.split("\n")) {
          children.push(new Paragraph({ children: [new TextRun(line)] }));
        }
      } else if (block.kind === "table") {
        children.push(new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({ children: block.columns.map((column) => new TableCell({ children: [new Paragraph({ text: column })] })) }),
            ...block.rows.map((row) => new TableRow({ children: row.map((cell) => new TableCell({ children: [new Paragraph({ text: cell })] })) })),
          ],
        }));
      } else {
        children.push(new Paragraph({ text: blockText(block) }));
      }
    }
  }
  children.push(new Paragraph({ text: "BTX Precision", style: "Footer" }));

  const doc = new Document({
    sections: [{ children }],
    styles: {
      paragraphStyles: [{
        id: "Footer",
        name: "Footer",
        basedOn: "Normal",
        run: { color: "6f7657", size: 18 },
      }],
    },
  });
  const blob = await Packer.toBlob(doc);
  downloadFile(`${slugTitle(deliverable)}.docx`, blob, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
}

export function printDeliverable(deliverable: Deliverable): void {
  const sections = exportSections(deliverable);
  const html = [
    "<!doctype html><html><head><title>",
    deliverable.title,
    "</title><style>body{font-family:Arial,sans-serif;color:#111;background:#fff;margin:36px;line-height:1.45}h1{font-size:26px}h2{font-size:16px;margin-top:24px}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border-bottom:1px solid #ddd;text-align:left;padding:7px;vertical-align:top}pre{white-space:pre-wrap}.footer{margin-top:32px;color:#666;font-size:11px}</style></head><body>",
    `<h1>${deliverable.form === "email" ? emailSubject(deliverable) : deliverable.title}</h1>`,
    ...sections.map((section) => [
      deliverable.form === "email" && section.id === "body" ? "" : `<h2>${section.heading}</h2>`,
      ...section.blocks.map((block) => {
        if (block.kind === "text") return `<p>${block.text.replace(/\n/g, "<br>")}</p>`;
        if (block.kind === "table") return `<table><thead><tr>${block.columns.map((column) => `<th>${column}</th>`).join("")}</tr></thead><tbody>${block.rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
        return `<pre>${blockText(block)}</pre>`;
      }),
    ].join("")).join(""),
    '<div class="footer">BTX Precision</div></body></html>',
  ].join("");
  const win = window.open("", "_blank", "noopener,noreferrer");
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();
  win.print();
}

export async function downloadXlsx(deliverable: Deliverable): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "BTX Precision";
  const sheet = workbook.addWorksheet("Deliverable");
  sheet.addRow([deliverable.title]);
  for (const section of exportSections(deliverable)) {
    sheet.addRow([]);
    sheet.addRow([section.heading]);
    for (const block of section.blocks) {
      if (block.kind === "table") {
        sheet.addRow(block.columns);
        block.rows.forEach((row) => sheet.addRow(row));
      } else {
        sheet.addRow([blockText(block)]);
      }
    }
  }
  const provenance = workbook.addWorksheet("Provenance");
  provenance.addRow(["Source", "Reason", "Records"]);
  deliverable.sources.forEach((source) => provenance.addRow([source.source, source.reason, source.records.join(", ")]));
  const buffer = await workbook.xlsx.writeBuffer();
  downloadFile(`${slugTitle(deliverable)}.xlsx`, new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}

export function downloadCsv(deliverable: Deliverable): void {
  const rows = [["Section", "Field", "Value"]];
  for (const section of exportSections(deliverable)) {
    for (const block of section.blocks) {
      if (block.kind === "table") {
        rows.push(["", ...block.columns].slice(0, 3));
        block.rows.forEach((row) => rows.push([section.heading, row[0] ?? "", row.slice(1).join(" | ")]));
      } else {
        rows.push([section.heading, "", blockText(block)]);
      }
    }
  }
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
  downloadFile(`${slugTitle(deliverable)}.csv`, csv, "text/csv;charset=utf-8");
}

export function downloadIcs(deliverable: Deliverable): void {
  const stops = deliverable.sections.flatMap((section) => section.blocks).flatMap((block) => block.kind === "map-ref" ? block.stops ?? [] : []);
  const start = new Date("2026-07-07T09:00:00");
  const events = stops.map((stop, index) => {
    const eventStart = new Date(start.getTime() + index * 2.5 * 60 * 60 * 1000);
    const eventEnd = new Date(eventStart.getTime() + 45 * 60 * 1000);
    const dt = (date: Date) => date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    return [
      "BEGIN:VEVENT",
      `UID:${deliverable.id}-${stop.entityId}@btx-demo`,
      `DTSTAMP:${dt(new Date())}`,
      `DTSTART:${dt(eventStart)}`,
      `DTEND:${dt(eventEnd)}`,
      `SUMMARY:${stop.label}`,
      `LOCATION:${stop.lat},${stop.lon}`,
      `DESCRIPTION:Visit stop ${index + 1} from ${deliverable.title}`,
      "END:VEVENT",
    ].join("\r\n");
  });
  downloadFile(`${slugTitle(deliverable)}.ics`, ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//BTX//Revenue Brain//EN", ...events, "END:VCALENDAR"].join("\r\n"), "text/calendar;charset=utf-8");
}

export function downloadMarkdown(deliverable: Deliverable): void {
  downloadFile(`${slugTitle(deliverable)}.md`, deliverableToMarkdown({ ...deliverable, sections: exportSections(deliverable) }), "text/markdown;charset=utf-8");
}
