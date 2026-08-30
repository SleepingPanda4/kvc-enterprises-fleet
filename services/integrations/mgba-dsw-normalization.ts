import type { ComparableMgbaDswRoute } from "./mgba-dsw-deduplication";

export function normalizeMgbaRouteNumber(value: string | null) {
  const trimmed = value?.trim() || null;
  if (!trimmed) return null;
  return /^0+\d+$/.test(trimmed) ? trimmed.replace(/^0+/, "") || "0" : trimmed;
}

export function normalizeMgbaDswRoute(row: ComparableMgbaDswRoute): ComparableMgbaDswRoute {
  const text = (value: string | null) => value?.trim() || null;
  return { serviceArea: text(row.serviceArea), waName: text(row.waName), vehicleNumber: text(row.vehicleNumber), driverName: row.driverName.trim(),
    routeNumber: normalizeMgbaRouteNumber(row.routeNumber), rawRoute: text(row.rawRoute), dst: text(row.dst),
    vscanPkgs: row.vscanPkgs, delStops: row.delStops, puStops: row.puStops, diff: row.diff, actDelStops: row.actDelStops,
    actDelPkgs: row.actDelPkgs, actPuStops: row.actPuStops, actPuPkgs: row.actPuPkgs, ilsPercent: row.ilsPercent, allStatusCodePkgs: row.allStatusCodePkgs };
}
