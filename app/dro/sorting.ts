export type DroSortKey = "route" | "capacity" | "packages" | "stops";
export type DroSortDirection = "asc" | "desc";
export type DroSortConfig = { key: DroSortKey; direction: DroSortDirection };

export const DEFAULT_DRO_SORT: DroSortConfig = { key: "route", direction: "asc" };

export function parseDroSortParams(params: Pick<URLSearchParams, "get">): DroSortConfig {
  const requestedSort = params.get("sort")?.toLowerCase();
  const key = requestedSort === "cube" || requestedSort === "capacity"
    ? "capacity"
    : requestedSort === "route" || requestedSort === "packages" || requestedSort === "stops"
      ? requestedSort
      : null;
  if (!key) return DEFAULT_DRO_SORT;
  return { key, direction: params.get("direction")?.toLowerCase() === "desc" ? "desc" : "asc" };
}

export function compareDroRouteNumbers(leftRoute: string | null, rightRoute: string | null, direction: DroSortDirection) {
  const left = leftRoute?.trim() || "";
  const right = rightRoute?.trim() || "";
  const routeGroup = (route: string) => /^\d{3}$/.test(route) ? 0 : /^\d{4,}$/.test(route) ? 1 : 2;
  const groupDifference = routeGroup(left) - routeGroup(right);
  if (groupDifference !== 0) return groupDifference;

  const leftNumber = /^\d+$/.test(left) ? Number(left) : null;
  const rightNumber = /^\d+$/.test(right) ? Number(right) : null;
  const comparison = leftNumber !== null && rightNumber !== null
    ? leftNumber - rightNumber
    : left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
  return direction === "asc" ? comparison : -comparison;
}
