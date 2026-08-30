export type SelectedDroSnapshot = {
  id: number;
  capturedAt: string;
  sourceTimestamp: string | null;
};

/**
 * Snapshot-specific UI must only render metadata that belongs to the route
 * rows currently on screen. Staffing is intentionally scoped to the date.
 */
export function selectedDroSnapshot<T extends SelectedDroSnapshot>(
  selectedSnapshotId: number | null,
  snapshot: T | null,
) {
  return selectedSnapshotId !== null && snapshot?.id === selectedSnapshotId ? snapshot : null;
}

export function selectedSnapshotTimestamp(snapshot: SelectedDroSnapshot | null) {
  return snapshot?.sourceTimestamp || snapshot?.capturedAt || null;
}
