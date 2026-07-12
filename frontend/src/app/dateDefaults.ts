import type { World } from "./useWorld.ts";
import type { TimeRange } from "../metrics/types.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

function validDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function defaultDateAnchor(world?: Pick<World, "snapshot"> | null, now = new Date()): Date {
  return validDate(world?.snapshot?.publicSignals.run_at) ?? now;
}

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function defaultTripWindow(anchor = new Date()): { startDate: string; endDate: string } {
  const start = new Date(anchor.getTime() + DAY_MS);
  const end = new Date(anchor.getTime() + 3 * DAY_MS);
  return { startDate: isoDate(start), endDate: isoDate(end) };
}

export function latestCompletedQuarter(anchor = new Date()): string {
  let year = anchor.getUTCFullYear();
  const currentQuarter = Math.floor(anchor.getUTCMonth() / 3) + 1;
  let quarter = currentQuarter - 1;
  if (quarter < 1) {
    quarter = 4;
    year -= 1;
  }
  return `Q${quarter} ${year}`;
}

export function previousQuarter(label: string): string {
  const match = label.match(/Q([1-4])\s+(\d{4})/i);
  if (!match) throw new Error(`Unsupported quarter label: ${label}`);
  let quarter = Number(match[1]) - 1;
  let year = Number(match[2]);
  if (quarter < 1) {
    quarter = 4;
    year -= 1;
  }
  return `Q${quarter} ${year}`;
}

export function quarterOptions(anchor = new Date(), count = 3): string[] {
  const options = [latestCompletedQuarter(anchor)];
  while (options.length < count) options.push(previousQuarter(options.at(-1) as string));
  return options;
}

export function sixMonthTrendRangeForQuarter(label: string): TimeRange {
  const match = label.match(/Q([1-4])\s+(\d{4})/i);
  if (!match) throw new Error(`Unsupported quarter label: ${label}`);
  const quarter = Number(match[1]);
  const year = Number(match[2]);
  const endMonthIndex = quarter * 3 - 1;
  const end = new Date(Date.UTC(year, endMonthIndex, 1));
  const start = new Date(Date.UTC(year, endMonthIndex - 5, 1));
  return { from: isoMonth(start), to: isoMonth(end) };
}

export function calendarStartFromDeliverable(createdAt: string, hour = 9): Date {
  const date = validDate(createdAt) ?? new Date();
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hour, 0, 0));
}

function isoMonth(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}
