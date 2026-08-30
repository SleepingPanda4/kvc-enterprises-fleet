export type MonitorSortKey = "route" | "driver" | "vscan" | "delStops" | "puStops" | "diff" | "actDelStops" | "actDelPkgs" | "actPuStops" | "ilsPercent";
export type MonitorSort = { key: MonitorSortKey; direction: "asc" | "desc" };
export const MONITOR_SORT_KEYS: readonly MonitorSortKey[] = ["route", "driver", "vscan", "delStops", "puStops", "diff", "actDelStops", "actDelPkgs", "actPuStops", "ilsPercent"];
export const DEFAULT_MONITOR_SORT: MonitorSort = { key: "route", direction: "asc" };
export function nextMonitorSort(current: MonitorSort | null, key: MonitorSortKey): MonitorSort { return current?.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: key === "route" || key === "driver" ? "asc" : "desc" }; }
export function compareNullable(left: number | null, right: number | null, direction: "asc" | "desc") { if (left === null && right === null) return 0; if (left === null) return 1; if (right === null) return -1; return direction === "asc" ? left - right : right - left; }
export function compareMonitorRouteNumbers(leftRoute: string | null, rightRoute: string | null, direction: "asc" | "desc") {
  const left = leftRoute?.trim() || ""; const right = rightRoute?.trim() || "";
  const leftNumber = /^\d+$/.test(left) ? Number(left) : null; const rightNumber = /^\d+$/.test(right) ? Number(right) : null;
  const comparison = leftNumber !== null && rightNumber !== null ? leftNumber - rightNumber : left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
  return direction === "asc" ? comparison : -comparison;
}
