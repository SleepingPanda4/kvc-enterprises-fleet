export function statusPackagesHref(routeRowId: number, operationalDate: string, snapshotId: number | null) {
  const query = new URLSearchParams({ date: operationalDate });
  if (snapshotId !== null) query.set("snapshot", String(snapshotId));
  return `/monitor/status-packages/${encodeURIComponent(String(routeRowId))}?${query.toString()}`;
}

export function stopStatusPackageLinkPropagation(event: Pick<MouseEvent, "stopPropagation">) {
  event.stopPropagation();
}

export function monitorBackHref(search: URLSearchParams) {
  const query = new URLSearchParams();
  const date = search.get("date");
  const snapshot = search.get("snapshot");
  if (date) query.set("date", date);
  if (snapshot) query.set("snapshot", snapshot);
  const serialized = query.toString();
  return `/monitor${serialized ? `?${serialized}` : ""}`;
}
