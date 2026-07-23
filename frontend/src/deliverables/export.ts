import type { Deliverable, DeliverableBlock, DeliverableSection, DeliverableType } from "./types.ts";
import { deliverableToMarkdown } from "./markdown.ts";
import { calendarStartFromDeliverable } from "../app/dateDefaults.ts";
import type { World } from "../app/useWorld.ts";
import { renderSteelSignalDocument } from "./steelSignalTemplates.tsx";
import { PROFILE } from "../app/config.ts";

export type DownloadFormat = "markdown" | "docx" | "pdf" | "pptx" | "xlsx" | "csv" | "ics";

export const DELIVERABLE_DOWNLOAD_FORMATS: Record<DeliverableType, DownloadFormat[]> = {
  outreach: ["docx", "pdf", "markdown"],
  meeting_brief: ["docx", "pdf", "markdown"],
  weekly_memo: ["docx", "pdf", "markdown"],
  itinerary: ["docx", "pdf", "ics", "markdown"],
  board_deck: ["pptx", "pdf", "markdown"],
  analysis_view: ["xlsx", "csv", "pdf", "markdown"],
  sales_pitch: ["pptx", "docx", "pdf", "markdown"],
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

type DocxModule = typeof import("docx");
type XlsxCell = import("write-excel-file/browser").Cell;
type XlsxSheetData = import("write-excel-file/browser").SheetData;

const DOCX_COLORS = {
  navy: "12263A",
  teal: "0F766E",
  tealSoft: "E6F4F1",
  ink: "17212B",
  muted: "5B6770",
  line: "D8DEE6",
  panel: "F6F8FA",
  white: "FFFFFF",
  olive: "6F7657",
};

function metaLabel(deliverable: Deliverable): string {
  const form = deliverable.form ?? deliverable.type;
  const audience = deliverable.audience ?? "internal";
  return `${audience} ${form.replace(/_/g, " ")} · ${deliverable.confidence} confidence`;
}

function docxTextParagraph(docx: DocxModule, text: string) {
  const { Paragraph, TextRun } = docx;
  return new Paragraph({
    style: "BodyText",
    children: [new TextRun(text || " ")],
  });
}

function docxSectionHeading(docx: DocxModule, heading: string) {
  const { HeadingLevel, Paragraph, TextRun } = docx;
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    style: "BTXHeading2",
    children: [new TextRun({ text: heading, bold: true })],
  });
}

function docxBlock(docx: DocxModule, block: DeliverableBlock) {
  const {
    BorderStyle,
    Paragraph,
    ShadingType,
    Table,
    TableCell,
    TableRow,
    TextRun,
    WidthType,
  } = docx;
  if (block.kind === "text") {
    return block.text.split("\n").filter((line, index, lines) => line.trim() || index === lines.length - 1)
      .map((line) => docxTextParagraph(docx, line));
  }
  if (block.kind === "table") {
    const border = { style: BorderStyle.SINGLE, color: DOCX_COLORS.line, size: 4 };
    return [new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
      rows: [
        new TableRow({
          tableHeader: true,
          children: block.columns.map((column) => new TableCell({
            shading: { type: ShadingType.CLEAR, fill: DOCX_COLORS.navy, color: DOCX_COLORS.navy },
            margins: { top: 120, bottom: 120, left: 120, right: 120 },
            children: [new Paragraph({ children: [new TextRun({ text: column, bold: true, color: DOCX_COLORS.white, size: 19, font: "Arial" })] })],
          })),
        }),
        ...block.rows.map((row, rowIndex) => new TableRow({
          children: row.map((cell) => new TableCell({
            shading: rowIndex % 2 === 0 ? { type: ShadingType.CLEAR, fill: DOCX_COLORS.panel, color: DOCX_COLORS.panel } : undefined,
            margins: { top: 120, bottom: 120, left: 120, right: 120 },
            children: [new Paragraph({ style: "BodyText", children: [new TextRun(String(cell))] })],
          })),
        })),
      ],
    })];
  }
  return [docxTextParagraph(docx, blockText(block))];
}

export function buildDocxDocument(deliverable: Deliverable, docx: DocxModule) {
  const {
    AlignmentType,
    BorderStyle,
    Document,
    HeadingLevel,
    Paragraph,
    Table,
    TextRun,
  } = docx;
  const sections = exportSections(deliverable);
  const title = deliverable.form === "email" ? emailSubject(deliverable) : deliverable.title;
  const children: any[] = [
    new Paragraph({
      style: "BTXBrand",
      children: [new TextRun({ text: "BTX Revenue Brain", bold: true, color: DOCX_COLORS.teal, size: 20, font: "Arial" })],
    }),
    new Paragraph({
      heading: HeadingLevel.TITLE,
      style: "BTXTitle",
      children: [new TextRun({ text: title, bold: true })],
    }),
    new Paragraph({
      style: "BTXMeta",
      children: [new TextRun(metaLabel(deliverable))],
    }),
  ];

  if (deliverable.confidenceReason) {
    children.push(
      new Paragraph({
        style: "BTXCalloutLabel",
        children: [new TextRun({ text: "Confidence", bold: true, color: DOCX_COLORS.teal })],
      }),
      new Paragraph({
        style: "BTXCallout",
        children: [new TextRun(deliverable.confidenceReason)],
      }),
    );
  }

  for (const section of sections) {
    if (deliverable.form !== "email" || section.id !== "body") {
      children.push(docxSectionHeading(docx, section.heading));
    }
    for (const block of section.blocks) {
      children.push(...docxBlock(docx, block));
    }
  }

  children.push(
    new Paragraph({ style: "BTXDivider", thematicBreak: true }),
    new Paragraph({
      style: "BTXFooter",
      children: [
        new TextRun({ text: PROFILE.name, bold: true }),
        new TextRun(" · Generated from cockpit evidence and saved program memory"),
      ],
    }),
  );

  return new Document({
    creator: PROFILE.name,
    title,
    description: `${PROFILE.name} deliverable generated by BTX Revenue Brain`,
    styles: {
      default: {
        document: {
          run: { font: "Arial", size: 21, color: DOCX_COLORS.ink },
          paragraph: { spacing: { after: 120, line: 276 } },
        },
        title: {
          run: { font: "Arial", size: 40, bold: true, color: DOCX_COLORS.navy },
          paragraph: { spacing: { before: 60, after: 80 } },
        },
        heading2: {
          run: { font: "Arial", size: 25, bold: true, color: DOCX_COLORS.teal },
          paragraph: { spacing: { before: 260, after: 80 }, keepNext: true },
        },
      },
      paragraphStyles: [
        {
          id: "BTXBrand",
          name: "BTX Brand",
          basedOn: "Normal",
          run: { font: "Arial", size: 20, bold: true, color: DOCX_COLORS.teal, allCaps: true },
          paragraph: { spacing: { after: 80 } },
        },
        {
          id: "BTXTitle",
          name: "BTX Title",
          basedOn: "Title",
          next: "BTXMeta",
          run: { font: "Arial", size: 40, bold: true, color: DOCX_COLORS.navy },
          paragraph: { spacing: { after: 80 }, keepNext: true },
        },
        {
          id: "BTXMeta",
          name: "BTX Meta",
          basedOn: "Normal",
          run: { font: "Arial", size: 18, color: DOCX_COLORS.muted },
          paragraph: { spacing: { after: 220 }, border: { bottom: { style: BorderStyle.SINGLE, color: DOCX_COLORS.line, size: 6, space: 8 } } },
        },
        {
          id: "BTXHeading2",
          name: "BTX Heading 2",
          basedOn: "Heading2",
          next: "BodyText",
          run: { font: "Arial", size: 25, bold: true, color: DOCX_COLORS.teal },
          paragraph: { spacing: { before: 260, after: 80 }, keepNext: true },
        },
        {
          id: "BTXCalloutLabel",
          name: "BTX Callout Label",
          basedOn: "Normal",
          run: { font: "Arial", size: 17, bold: true, color: DOCX_COLORS.teal, allCaps: true },
          paragraph: {
            shading: { type: "clear", fill: DOCX_COLORS.tealSoft, color: DOCX_COLORS.tealSoft },
            border: { top: { style: BorderStyle.SINGLE, color: DOCX_COLORS.line, size: 4, space: 8 }, left: { style: BorderStyle.SINGLE, color: DOCX_COLORS.teal, size: 16, space: 8 } },
            spacing: { before: 80, after: 20 },
          },
        },
        {
          id: "BTXCallout",
          name: "BTX Callout",
          basedOn: "Normal",
          run: { font: "Arial", size: 20, color: DOCX_COLORS.ink },
          paragraph: {
            shading: { type: "clear", fill: DOCX_COLORS.tealSoft, color: DOCX_COLORS.tealSoft },
            border: { left: { style: BorderStyle.SINGLE, color: DOCX_COLORS.teal, size: 16, space: 8 }, bottom: { style: BorderStyle.SINGLE, color: DOCX_COLORS.line, size: 4, space: 8 } },
            spacing: { after: 180, line: 276 },
          },
        },
        {
          id: "BodyText",
          name: "BTX Body",
          basedOn: "Normal",
          run: { font: "Arial", size: 21, color: DOCX_COLORS.ink },
          paragraph: { spacing: { after: 120, line: 276 } },
        },
        {
          id: "BTXDivider",
          name: "BTX Divider",
          basedOn: "Normal",
          paragraph: { spacing: { before: 160, after: 80 } },
        },
        {
          id: "BTXFooter",
          name: "BTX Footer",
          basedOn: "Normal",
          run: { font: "Arial", color: DOCX_COLORS.olive, size: 18 },
          paragraph: { alignment: AlignmentType.LEFT, spacing: { before: 80 } },
        },
      ],
    },
    sections: [{
      properties: {
        page: { margin: { top: 900, right: 900, bottom: 900, left: 900 } },
      },
      children,
    }],
  });
}

export async function downloadDocx(deliverable: Deliverable): Promise<void> {
  const docx = await import("docx");
  const blob = await docx.Packer.toBlob(buildDocxDocument(deliverable, docx));
  downloadFile(`${slugTitle(deliverable)}.docx`, blob, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
}

export function printDeliverable(deliverable: Deliverable, world?: World): void {
  if (world && ["capabilities_assessment", "outreach", "weekly_memo"].includes(deliverable.type)) {
    openPrintWindow(deliverable.title, renderSteelSignalDocument(deliverable, world));
    return;
  }
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
  openPrintWindow(deliverable.title, html);
}

function openPrintWindow(_title: string, html: string): void {
  const win = window.open("", "_blank", "noopener,noreferrer");
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();
  win.print();
}

export async function downloadXlsx(deliverable: Deliverable): Promise<void> {
  const { default: writeXlsxFile } = await import("write-excel-file/browser");
  const deliverableSheet: XlsxSheetData = [[xlsxHeading(deliverable.title)]];
  for (const section of exportSections(deliverable)) {
    deliverableSheet.push([]);
    deliverableSheet.push([xlsxSubheading(section.heading)]);
    for (const block of section.blocks) {
      if (block.kind === "table") {
        deliverableSheet.push(block.columns.map((column) => xlsxColumn(column)));
        block.rows.forEach((row) => deliverableSheet.push(row));
      } else {
        deliverableSheet.push([blockText(block)]);
      }
    }
  }
  const provenanceSheet: XlsxSheetData = [[xlsxColumn("Source"), xlsxColumn("Reason"), xlsxColumn("Records")]];
  deliverable.sources.forEach((source) => provenanceSheet.push([source.source, source.reason, source.records.join(", ")]));
  const blob = await writeXlsxFile([
    { sheet: "Deliverable", data: deliverableSheet, columns: [{ width: 36 }, { width: 28 }, { width: 28 }, { width: 28 }] },
    { sheet: "Provenance", data: provenanceSheet, columns: [{ width: 28 }, { width: 44 }, { width: 44 }] },
  ]).toBlob();
  downloadFile(`${slugTitle(deliverable)}.xlsx`, blob, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}

function xlsxHeading(value: string): XlsxCell {
  return { value, fontWeight: "bold", fontSize: 16, textColor: "12263A", wrap: true };
}

function xlsxSubheading(value: string): XlsxCell {
  return { value, fontWeight: "bold", textColor: "0F766E", wrap: true };
}

function xlsxColumn(value: string): XlsxCell {
  return { value, fontWeight: "bold", backgroundColor: "E6F4F1", wrap: true };
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
  const start = calendarStartFromDeliverable(deliverable.createdAt);
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
