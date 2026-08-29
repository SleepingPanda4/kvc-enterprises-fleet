const DRO_TIME_ZONE = "America/Chicago";

export type ComparableDroRoute = {
  routeNumber: string | null;
  rawWaNumber: string;
  displayWaNumber: string | null;
  deliveryCube: number;
  pickupCube: number;
  combinationCube: number;
  usedCapacity: number;
  vehicleCapacity: number;
  deliveryPackages: number;
  pickupPackages: number;
  combinationPackages: number;
  totalPackages: number;
  deliveryStops: number;
  pickupStops: number;
  combinationStops: number;
  totalStops: number;
  routeType: string | null;
  routeTime: string | null;
  distance: number | null;
  warning: boolean;
};

function normalizedText(value: string | null | undefined) {
  return value?.trim() || null;
}

function normalizedNumber(value: number | null | undefined) {
  const result = Number(value ?? 0);
  return Object.is(result, -0) ? 0 : result;
}

function normalizedNullableNumber(value: number | null | undefined) {
  return value === null || value === undefined ? null : normalizedNumber(value);
}

export function normalizeDroRoutes(rows: readonly ComparableDroRoute[]) {
  return rows.map(row => ({
    routeNumber: normalizedText(row.routeNumber),
    rawWaNumber: row.rawWaNumber.trim(),
    displayWaNumber: normalizedText(row.displayWaNumber),
    deliveryCube: normalizedNumber(row.deliveryCube),
    pickupCube: normalizedNumber(row.pickupCube),
    combinationCube: normalizedNumber(row.combinationCube),
    usedCapacity: normalizedNumber(row.usedCapacity),
    vehicleCapacity: normalizedNumber(row.vehicleCapacity),
    deliveryPackages: normalizedNumber(row.deliveryPackages),
    pickupPackages: normalizedNumber(row.pickupPackages),
    combinationPackages: normalizedNumber(row.combinationPackages),
    totalPackages: normalizedNumber(row.totalPackages),
    deliveryStops: normalizedNumber(row.deliveryStops),
    pickupStops: normalizedNumber(row.pickupStops),
    combinationStops: normalizedNumber(row.combinationStops),
    totalStops: normalizedNumber(row.totalStops),
    routeType: normalizedText(row.routeType),
    routeTime: normalizedText(row.routeTime),
    distance: normalizedNullableNumber(row.distance),
    warning: Boolean(row.warning),
  })).map(row => JSON.stringify(row)).sort();
}

export function droRoutesAreIdentical(left: readonly ComparableDroRoute[], right: readonly ComparableDroRoute[]) {
  const normalizedLeft = normalizeDroRoutes(left);
  const normalizedRight = normalizeDroRoutes(right);
  return normalizedLeft.length === normalizedRight.length
    && normalizedLeft.every((row, index) => row === normalizedRight[index]);
}

function chicagoDateTime(capturedAt: string) {
  const capturedDate = new Date(capturedAt);
  if (Number.isNaN(capturedDate.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: DRO_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(capturedDate);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value || "";
  return {
    localDate: `${part("year")}-${part("month")}-${part("day")}`,
    hour: Number(part("hour")),
    minute: Number(part("minute")),
    second: Number(part("second")),
    millisecond: capturedDate.getUTCMilliseconds(),
  };
}

export function shouldDeduplicateDroSnapshot(capturedAt: string, operationalDate: string) {
  const local = chicagoDateTime(capturedAt);
  if (!local) return false;

  // DRO can retain the prior operational date after midnight. That period is
  // the continuation of the prior evening's late collection window.
  if (local.localDate > operationalDate) return true;
  if (local.localDate !== operationalDate || local.hour !== 23) return false;
  return local.minute > 0 || local.second > 0 || local.millisecond > 0;
}
