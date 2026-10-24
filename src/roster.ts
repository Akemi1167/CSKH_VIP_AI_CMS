import type { Leave, Shift } from "./types.ts";

export type Mark = "none" | "N" | "S" | "C" | "K";

export type Window = { start: Date; end: Date };

export type DayWindows = {
  full: Window;
  morning: Window;
  afternoon: Window;
};

export type DayCell = {
  mark: Mark;
  owned: Leave[];
  locked: boolean;
};

const ORDER: Mark[] = ["none", "N", "S", "C", "K"];
const SLACK_MS = 60_000;

export function nextMark(mark: Mark): Mark {
  const index = ORDER.indexOf(mark);
  return ORDER[(index + 1) % ORDER.length] ?? "none";
}

export function dayWindows(shift: Shift, year: number, month: number, day: number): DayWindows {
  const start = clock(shift.start_local);
  const end = clock(shift.end_local);
  const fullStart = zonedTime(year, month, day, start.hour, start.minute, shift.timezone);
  const fullEnd = zonedTime(year, month, day, end.hour, end.minute, shift.timezone);
  let morningEnd = fullStart;
  let afternoonStart = fullEnd;
  if (shift.break_start_local && shift.break_end_local) {
    const breakStart = clock(shift.break_start_local);
    const breakEnd = clock(shift.break_end_local);
    morningEnd = zonedTime(year, month, day, breakStart.hour, breakStart.minute, shift.timezone);
    afternoonStart = zonedTime(year, month, day, breakEnd.hour, breakEnd.minute, shift.timezone);
  } else {
    const mid = new Date(fullStart.getTime() + (fullEnd.getTime() - fullStart.getTime()) / 2);
    morningEnd = mid;
    afternoonStart = mid;
  }
  return {
    full: { start: fullStart, end: fullEnd },
    morning: { start: fullStart, end: morningEnd },
    afternoon: { start: afternoonStart, end: fullEnd },
  };
}

export function classifyDay(leaves: Leave[], windows: DayWindows): DayCell {
  const touching = leaves.filter((leave) => overlaps(leave, windows.full));
  const owned = touching.filter((leave) => inside(leave, windows.full));
  const locked = touching.some((leave) => !inside(leave, windows.full));
  const source = locked ? touching : owned;
  return { mark: markOf(source, windows), owned, locked };
}

export function markBody(
  mark: Exclude<Mark, "none">,
  windows: DayWindows,
): { kind: "leave" | "absence"; starts_at: string; ends_at: string } | null {
  const window = mark === "S" ? windows.morning : mark === "C" ? windows.afternoon : windows.full;
  if (window.end.getTime() <= window.start.getTime()) {
    return null;
  }
  return {
    kind: mark === "K" ? "absence" : "leave",
    starts_at: window.start.toISOString(),
    ends_at: window.end.toISOString(),
  };
}

function markOf(leaves: Leave[], windows: DayWindows): Mark {
  if (leaves.some((leave) => leave.kind === "absence" && covers(leave, windows.full))) {
    return "K";
  }
  if (leaves.some((leave) => leave.kind === "leave" && covers(leave, windows.full))) {
    return "N";
  }
  if (leaves.some((leave) => leave.kind === "leave" && covers(leave, windows.morning) && !covers(leave, windows.afternoon))) {
    return "S";
  }
  if (leaves.some((leave) => leave.kind === "leave" && covers(leave, windows.afternoon) && !covers(leave, windows.morning))) {
    return "C";
  }
  return "none";
}

function covers(leave: Leave, window: Window): boolean {
  return time(leave.starts_at) <= window.start.getTime() + SLACK_MS && time(leave.ends_at) >= window.end.getTime() - SLACK_MS;
}

function inside(leave: Leave, window: Window): boolean {
  return time(leave.starts_at) >= window.start.getTime() - SLACK_MS && time(leave.ends_at) <= window.end.getTime() + SLACK_MS;
}

function overlaps(leave: Leave, window: Window): boolean {
  return time(leave.starts_at) < window.end.getTime() && time(leave.ends_at) > window.start.getTime();
}

function time(value: string): number {
  return new Date(value).getTime();
}

function clock(value: string): { hour: number; minute: number } {
  const [hour, minute] = value.slice(0, 5).split(":");
  return { hour: Number(hour), minute: Number(minute) };
}

function zonedTime(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const utc = Date.UTC(year, month - 1, day, hour, minute, 0);
  const first = utc - offsetMs(new Date(utc), timeZone);
  return new Date(utc - offsetMs(new Date(first), timeZone));
}

function offsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) => {
    const raw = parts.find((item) => item.type === type)?.value ?? "0";
    const value = Number(raw);
    return type === "hour" && value === 24 ? 0 : value;
  };
  const asUtc = Date.UTC(pick("year"), pick("month") - 1, pick("day"), pick("hour"), pick("minute"), pick("second"));
  return asUtc - date.getTime();
}
