import type { QuarterWindow, TimeRange } from "./types.ts";

export function quarterWindow(label: string): QuarterWindow {
  const match = label.match(/Q([1-4])\s+(\d{4})/i);
  if (!match) throw new Error(`Unsupported quarter label: ${label}`);
  const quarter = Number(match[1]);
  const year = Number(match[2]);
  const startMonth = (quarter - 1) * 3 + 1;
  const endMonth = startMonth + 2;
  return {
    label: `Q${quarter} ${year}`,
    quarter,
    year,
    from: `${year}-${String(startMonth).padStart(2, "0")}`,
    to: `${year}-${String(endMonth).padStart(2, "0")}`,
  };
}

export function priorQuarter(window: QuarterWindow): QuarterWindow {
  const priorQuarterNo = window.quarter === 1 ? 4 : window.quarter - 1;
  const year = window.quarter === 1 ? window.year - 1 : window.year;
  return quarterWindow(`Q${priorQuarterNo} ${year}`);
}

export function inMonthRange(month: string, range?: TimeRange): boolean {
  if (!range) return true;
  return month >= range.from.slice(0, 7) && month <= range.to.slice(0, 7);
}
