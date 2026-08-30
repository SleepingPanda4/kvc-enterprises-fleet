export type DroCalendarDay = {
  date: string;
  day: number;
  available: boolean;
  selected: boolean;
};

function parseMonthKey(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  return { year, month };
}

function formatIsoDate(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function monthKeyForDroDate(date: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date.slice(0, 7) : "";
}

export function shiftDroCalendarMonth(monthKey: string, offset: number) {
  const { year, month } = parseMonthKey(monthKey);
  const shifted = new Date(Date.UTC(year, month - 1 + offset, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function isDroDateAvailable(date: string, availableDates: readonly string[]) {
  return availableDates.includes(date);
}

export function formatDroCalendarMonth(monthKey: string) {
  const { year, month } = parseMonthKey(monthKey);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
}

export function formatDroCalendarDate(date: string, includeWeekday = false) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString(undefined, {
    ...(includeWeekday ? { weekday: "long" as const } : {}), month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  });
}

export function buildDroCalendarMonth(monthKey: string, availableDates: readonly string[], selectedDate: string) {
  const { year, month } = parseMonthKey(monthKey);
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const days: Array<DroCalendarDay | null> = Array.from({ length: firstWeekday }, () => null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = formatIsoDate(year, month, day);
    days.push({ date, day, available: isDroDateAvailable(date, availableDates), selected: date === selectedDate });
  }
  while (days.length % 7 !== 0) days.push(null);
  return { label: formatDroCalendarMonth(monthKey), days };
}
