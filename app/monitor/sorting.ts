export type MonitorSortKey = "driver" | "vscan" | "delStops" | "puStops" | "diff" | "actDelStops" | "actDelPkgs" | "actPuStops" | "ilsPercent";
export type MonitorSort = { key: MonitorSortKey; direction: "asc" | "desc" };
export const MONITOR_SORT_KEYS: readonly MonitorSortKey[] = ["driver", "vscan", "delStops", "puStops", "diff", "actDelStops", "actDelPkgs", "actPuStops", "ilsPercent"];
export function nextMonitorSort(current: MonitorSort | null, key: MonitorSortKey): MonitorSort { return current?.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: key === "driver" ? "asc" : "desc" }; }
export function compareNullable(left: number | null, right: number | null, direction: "asc" | "desc") { if (left === null && right === null) return 0; if (left === null) return 1; if (right === null) return -1; return direction === "asc" ? left - right : right - left; }
