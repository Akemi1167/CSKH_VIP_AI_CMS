import type { FieldErrors, Shift } from "./types.ts";

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export type ClockState = "working" | "break" | "off";

export function minutesOfDay(value: string): number {
  const [hour, minute] = value.split(":");
  return Number(hour) * 60 + Number(minute);
}

export function shiftFieldErrors(input: {
  timezone: string;
  start: string;
  end: string;
  breakOn: boolean;
  breakStart: string;
  breakEnd: string;
  when: "now" | "later";
  effective: Date | null;
}): FieldErrors {
  const errors: FieldErrors = {};
  if (!TIME.test(input.start)) {
    errors.start_local = "Chọn giờ bắt đầu";
  }
  if (!TIME.test(input.end)) {
    errors.end_local = "Chọn giờ kết thúc";
  }
  if (!errors.start_local && !errors.end_local && minutesOfDay(input.start) >= minutesOfDay(input.end)) {
    errors.end_local = "Giờ kết thúc phải sau giờ bắt đầu, trong cùng một ngày";
  }
  try {
    new Intl.DateTimeFormat("vi-VN", { timeZone: input.timezone }).format(new Date());
  } catch {
    errors.timezone = "Múi giờ không hợp lệ";
  }
  if (input.breakOn) {
    if (!TIME.test(input.breakStart)) {
      errors.break_start_local = "Chọn giờ bắt đầu nghỉ";
    }
    if (!TIME.test(input.breakEnd)) {
      errors.break_end_local = "Chọn giờ kết thúc nghỉ";
    }
    if (!errors.start_local && !errors.end_local && !errors.break_start_local && !errors.break_end_local) {
      const start = minutesOfDay(input.start);
      const end = minutesOfDay(input.end);
      const breakStart = minutesOfDay(input.breakStart);
      const breakEnd = minutesOfDay(input.breakEnd);
      if (breakStart <= start || breakEnd >= end || breakStart >= breakEnd) {
        errors.break_start_local = "Giờ nghỉ phải nằm trong ca";
      }
    }
  }
  if (input.when === "later" && (!input.effective || Number.isNaN(input.effective.getTime()))) {
    errors.effective_from = "Chọn thời điểm ca bắt đầu có hiệu lực";
  }
  return errors;
}

export function clockState(now: Date, shift: Shift): ClockState {
  const minute = localMinutes(now, shift.timezone);
  const start = minutesOfDay(shift.start_local);
  const end = minutesOfDay(shift.end_local);
  if (minute < start || minute >= end) {
    return "off";
  }
  if (shift.break_start_local && shift.break_end_local) {
    const breakStart = minutesOfDay(shift.break_start_local);
    const breakEnd = minutesOfDay(shift.break_end_local);
    if (minute >= breakStart && minute < breakEnd) {
      return "break";
    }
  }
  return "working";
}

export function clockLabel(state: ClockState): string {
  if (state === "working") {
    return "Trong ca";
  }
  if (state === "break") {
    return "Nghỉ giữa ca";
  }
  return "Ngoài ca";
}

function localMinutes(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  return hour * 60 + minute;
}
