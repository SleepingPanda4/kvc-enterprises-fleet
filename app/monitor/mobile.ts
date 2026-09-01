export function monitorDriverDisplayName(value: string) {
  const [last, first] = value.split(",", 2).map(part => part.trim());
  if (!last || !first) return value;
  const title = (part: string) => part.split(/\s+/).filter(Boolean).map(word => word[0]?.toUpperCase() + word.slice(1).toLowerCase()).join(" ");
  return `${title(first)} ${title(last)}`;
}

export function monitorStopProgress(delStops: number | null, puStops: number | null, actDelStops: number | null, actPuStops: number | null) {
  const planned = (delStops ?? 0) + (puStops ?? 0);
  if (planned <= 0) return null;
  const actual = (actDelStops ?? 0) + (actPuStops ?? 0);
  return Math.min(100, Math.max(0, Math.round((actual / planned) * 100)));
}

export function monitorStopsLeft(delStops: number | null, puStops: number | null, actDelStops: number | null, actPuStops: number | null) {
  const planned = (delStops ?? 0) + (puStops ?? 0);
  if (planned <= 0) return null;
  const actual = (actDelStops ?? 0) + (actPuStops ?? 0);
  return Math.max(0, planned - actual);
}

function nextAvailOnDutyMinutes(nextAvailOnDuty: string | null) {
  if (!nextAvailOnDuty) return null;
  const meridiem = nextAvailOnDuty.match(/(?:^|\D)(\d{1,2}):([0-5]\d)(?::[0-5]\d)?\s*([ap]m)\b/i);
  const clock = meridiem || nextAvailOnDuty.match(/(?:^|\D)([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?\b/);
  if (!clock) return null;
  let hour = Number(clock[1]);
  const minute = Number(clock[2]);
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    hour = hour % 12 + (meridiem[3].toLowerCase() === "pm" ? 12 : 0);
  }
  return hour * 60 + minute;
}

/** Derives a display-only logout clock time from the persisted DSW source value. */
export function monitorLoggedOutTime(nextAvailOnDuty: string | null) {
  const nextAvailMinutes = nextAvailOnDutyMinutes(nextAvailOnDuty);
  if (nextAvailMinutes === null) return null;
  const loggedOutMinutes = (nextAvailMinutes - 10 * 60 + 24 * 60) % (24 * 60);
  const displayHour = loggedOutMinutes / 60 | 0;
  const displayMinute = loggedOutMinutes % 60;
  const suffix = displayHour >= 12 ? "PM" : "AM";
  return `${displayHour % 12 || 12}:${String(displayMinute).padStart(2, "0")} ${suffix}`;
}

/**
 * Minutes relative to the selected operational day. Negative values mean the
 * ten-hour subtraction crossed into the preceding Chicago calendar day.
 */
export function monitorLogoutSortValue(nextAvailOnDuty: string | null) {
  const nextAvailMinutes = nextAvailOnDutyMinutes(nextAvailOnDuty);
  return nextAvailMinutes === null ? null : nextAvailMinutes - 10 * 60;
}

export function monitorLoggedOutOverlayTime(nextAvailOnDuty: string | null) {
  return monitorLoggedOutTime(nextAvailOnDuty);
}

const CHICAGO_TIME_ZONE = "America/Chicago";
const PACE_COLORS = {
  red: "#c7353c",
  orange: "#df7a36",
  yellow: "#d8ab39",
  blue: "#2c7ec4",
  green: "#087a46",
} as const;

export function monitorChicagoCalendarDate(now: Date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: CHICAGO_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find(item => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function monitorMobileCallHref(operationalDate: string, phoneNumber: string | null, now: Date = new Date()) {
  if (operationalDate !== monitorChicagoCalendarDate(now) || !phoneNumber) return null;
  const digits = phoneNumber.replace(/\D/g, "");
  return digits.length === 10 ? `tel:${digits}` : null;
}

function chicagoClockMinutes(capturedAt: string) {
  const timestamp = new Date(capturedAt);
  if (Number.isNaN(timestamp.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: CHICAGO_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(timestamp);
  const hour = Number(parts.find(part => part.type === "hour")?.value);
  const minute = Number(parts.find(part => part.type === "minute")?.value);
  return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : null;
}

export function monitorExpectedProgress(capturedAt: string) {
  const clockMinutes = chicagoClockMinutes(capturedAt);
  if (clockMinutes === null || clockMinutes < 9 * 60) return null;
  return Math.min(100, ((clockMinutes - 9 * 60) / (8 * 60)) * 100);
}

function interpolateColor(from: string, to: string, amount: number) {
  const channel = (value: string, index: number) => Number.parseInt(value.slice(1 + index * 2, 3 + index * 2), 16);
  const ratio = Math.min(1, Math.max(0, amount));
  const result = [0, 1, 2].map(index => Math.round(channel(from, index) + (channel(to, index) - channel(from, index)) * ratio));
  return `#${result.map(value => value.toString(16).padStart(2, "0")).join("")}`;
}

function paceColorForMinutes(paceMinutes: number) {
  if (paceMinutes <= -90) return PACE_COLORS.red;
  if (paceMinutes <= -60) return interpolateColor(PACE_COLORS.red, PACE_COLORS.orange, (paceMinutes + 90) / 30);
  if (paceMinutes <= -30) return interpolateColor(PACE_COLORS.orange, PACE_COLORS.yellow, (paceMinutes + 60) / 30);
  if (paceMinutes <= 0) return interpolateColor(PACE_COLORS.yellow, PACE_COLORS.blue, (paceMinutes + 30) / 30);
  if (paceMinutes <= 30) return PACE_COLORS.blue;
  if (paceMinutes <= 90) return interpolateColor(PACE_COLORS.blue, PACE_COLORS.green, (paceMinutes - 30) / 60);
  return PACE_COLORS.green;
}

/** Returns null when a snapshot predates the workday or progress is unavailable. */
export function monitorMobilePaceColor(completion: number | null, capturedAt: string) {
  if (completion === 100) return PACE_COLORS.green;
  if (completion === null) return null;
  const expected = monitorExpectedProgress(capturedAt);
  if (expected === null) return null;
  return paceColorForMinutes((completion - expected) * 4.8);
}

type MobileSortRow = { routeNumber: string | null; registeredRouteNumber: string | null; nextAvailOnDuty?: string | null; driverOrder?: number; id: number; delStops: number | null; puStops: number | null; actDelStops: number | null; actPuStops: number | null };

type MobileSearchRow = MobileSortRow & { driverName: string; vehicleNumber: string | null };

export function filterMonitorMobileRows<T extends MobileSearchRow>(rows: T[], query: string) {
  const value = query.trim().toLowerCase();
  if (!value) return rows;
  return rows.filter(row => [row.driverName, row.routeNumber || row.registeredRouteNumber || "", row.vehicleNumber || ""].some(field => field.toLowerCase().includes(value)));
}

export function sortMonitorMobileRows<T extends MobileSortRow>(rows: T[]) {
  const routeNumber = (row: T) => row.routeNumber || row.registeredRouteNumber;
  const numericRoute = (row: T) => {
    const value = routeNumber(row)?.trim() || "";
    return /^\d+$/.test(value) ? Number(value) : null;
  };
  return [...rows].sort((left, right) => {
    const leftLogout = monitorLogoutSortValue(left.nextAvailOnDuty ?? null);
    const rightLogout = monitorLogoutSortValue(right.nextAvailOnDuty ?? null);
    if (leftLogout === null && rightLogout !== null) return -1;
    if (leftLogout !== null && rightLogout === null) return 1;
    const leftRoute = numericRoute(left); const rightRoute = numericRoute(right);
    if (leftLogout !== null && rightLogout !== null) {
      if (leftLogout !== rightLogout) return rightLogout - leftLogout;
      if (leftRoute !== null && rightRoute !== null && leftRoute !== rightRoute) return leftRoute - rightRoute;
      if (leftRoute !== null && rightRoute === null) return -1;
      if (leftRoute === null && rightRoute !== null) return 1;
      return (left.driverOrder ?? 0) - (right.driverOrder ?? 0) || left.id - right.id;
    }
    const leftProgress = monitorStopProgress(left.delStops, left.puStops, left.actDelStops, left.actPuStops);
    const rightProgress = monitorStopProgress(right.delStops, right.puStops, right.actDelStops, right.actPuStops);
    if (leftProgress === null && rightProgress !== null) return 1;
    if (leftProgress !== null && rightProgress === null) return -1;
    if (leftProgress !== null && rightProgress !== null && leftProgress !== rightProgress) return leftProgress - rightProgress;
    if (leftRoute !== null && rightRoute !== null && leftRoute !== rightRoute) return leftRoute - rightRoute;
    if (leftRoute !== null && rightRoute === null) return -1;
    if (leftRoute === null && rightRoute !== null) return 1;
    return (left.driverOrder ?? 0) - (right.driverOrder ?? 0) || left.id - right.id;
  });
}
