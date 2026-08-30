/** Visual-only selection for the currently displayed DRO snapshot. */
export type DroRouteSelection = { rowId: number; operationalDate: string; snapshotId: number | null };

export function selectDroRouteRow(rowId: number, operationalDate = "", snapshotId: number | null = null): DroRouteSelection {
  return { rowId, operationalDate, snapshotId };
}

export function clearDroRouteSelection() {
  return null;
}

export function selectedDroRouteRowId(selection: DroRouteSelection | null, operationalDate: string, snapshotId: number | null) {
  return selection?.operationalDate === operationalDate && selection.snapshotId === snapshotId ? selection.rowId : null;
}
