export type ComparableMgbaDswRoute = {
  serviceArea: string | null; waName: string | null; vehicleNumber: string | null; driverName: string;
  routeNumber: string | null; rawRoute: string | null; dst: string | null;
  vscanPkgs: number | null; delStops: number | null; puStops: number | null; diff: number | null;
  actDelStops: number | null; actDelPkgs: number | null; actPuStops: number | null; actPuPkgs: number | null;
  ilsPercent: number | null; allStatusCodePkgs: number | null; driverOrder?: number;
};

function normalizeText(value: string | null) { return value?.trim() || null; }
function comparable(row: ComparableMgbaDswRoute) {
  return [normalizeText(row.serviceArea), normalizeText(row.waName), normalizeText(row.vehicleNumber), row.driverName.trim(),
    normalizeText(row.routeNumber), normalizeText(row.rawRoute), normalizeText(row.dst), row.vscanPkgs, row.delStops,
    row.puStops, row.diff, row.actDelStops, row.actDelPkgs, row.actPuStops, row.actPuPkgs, row.ilsPercent, row.allStatusCodePkgs, row.driverOrder ?? 0];
}

export function mgbaDswRoutesAreIdentical(left: readonly ComparableMgbaDswRoute[], right: readonly ComparableMgbaDswRoute[]) {
  if (left.length !== right.length) return false;
  const sortRows = (rows: readonly ComparableMgbaDswRoute[]) => rows.map(comparable).map(row => JSON.stringify(row)).sort();
  const leftRows = sortRows(left);
  const rightRows = sortRows(right);
  return leftRows.every((row, index) => row === rightRows[index]);
}
