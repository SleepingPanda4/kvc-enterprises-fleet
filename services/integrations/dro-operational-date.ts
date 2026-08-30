export const DRO_TIME_ZONE = "America/Chicago";
export const DRO_PREPARATION_START_HOUR = 20;

export type ChicagoDateTime = {
  localDate: string;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
};

export function chicagoDateTime(value: string | Date): ChicagoDateTime | null {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: DRO_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value || "";
  return {
    localDate: `${part("year")}-${part("month")}-${part("day")}`,
    hour: Number(part("hour")),
    minute: Number(part("minute")),
    second: Number(part("second")),
    millisecond: date.getUTCMilliseconds(),
  };
}

export function nextCalendarDate(dateOnly: string) {
  const date = new Date(`${dateOnly}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/** The evening preparation window produces plans for the following route day. */
export function operationalDateForDroCapture(capturedAt: string | Date) {
  const local = chicagoDateTime(capturedAt);
  if (!local) return null;
  return local.hour >= DRO_PREPARATION_START_HOUR ? nextCalendarDate(local.localDate) : local.localDate;
}

export function isDroManualRefreshAllowed(now: string | Date = new Date()) {
  const local = chicagoDateTime(now);
  return Boolean(local && local.hour >= DRO_PREPARATION_START_HOUR);
}

export const DRO_REFRESH_WINDOW_MESSAGE = "DRO refresh is available from 8:00 PM through 11:59 PM CT.";
