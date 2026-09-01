import { chicagoCalendarDate, getMgbaDswSnapshotsForDate } from "./mgba-dsw";
import { MgbaCollectorError, requestMgbaCollection, type MgbaCollectionResult } from "./mgba-collector";

export const MGBA_FRESHNESS_MS = 12 * 60 * 1000;
type RefreshResult = { requested: boolean; fresh: boolean; collection?: MgbaCollectionResult; error?: MgbaCollectorError };
let inFlight: Promise<RefreshResult> | null = null;

export function isMgbaSnapshotFresh(capturedAt: string | undefined, now = new Date()) {
  const captured = capturedAt ? Date.parse(capturedAt) : Number.NaN;
  return Number.isFinite(captured) && now.getTime() - captured <= MGBA_FRESHNESS_MS;
}

export async function ensureCurrentMgbaSnapshot(operationalDate: string, now = new Date()): Promise<RefreshResult> {
  if (operationalDate !== chicagoCalendarDate(now)) return { requested: false, fresh: false };
  const snapshots = await getMgbaDswSnapshotsForDate(operationalDate);
  if (isMgbaSnapshotFresh(snapshots[0]?.capturedAt, now)) return { requested: false, fresh: true };
  if (inFlight) return inFlight;
  inFlight = requestMgbaCollection(operationalDate).then(collection => ({ requested: true, fresh: false, collection })).catch(error => ({ requested: true, fresh: false, error: error instanceof MgbaCollectorError ? error : new MgbaCollectorError("Monitor collection could not be completed.", "MGBA_COLLECTION_FAILED", 502) })).finally(() => { inFlight = null; });
  return inFlight;
}
