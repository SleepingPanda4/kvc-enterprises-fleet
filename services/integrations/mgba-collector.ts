const DEFAULT_MGBA_WORKER_URL = "http://127.0.0.1:3102";
export type MgbaCollectionResult = { ok: true; operationalDate: string; snapshotId?: number; capturedAt?: string; created?: boolean; deduplicated?: boolean };
export class MgbaCollectorError extends Error { constructor(message: string, readonly code: string, readonly status: number) { super(message); } }
type Options = { fetchImplementation?: typeof fetch; timeoutMs?: number };
function workerDate(value: string) { const [year, month, day] = value.split("-"); return `${month}/${day}/${year}`; }
export async function requestMgbaCollection(operationalDate: string, options: Options = {}): Promise<MgbaCollectionResult> {
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 90_000);
  try {
    let response: Response;
    try { response = await (options.fetchImplementation || fetch)(`${process.env.MGBA_WORKER_URL || DEFAULT_MGBA_WORKER_URL}/collect?date=${encodeURIComponent(workerDate(operationalDate))}`, { method: "POST", signal: controller.signal }); }
    catch (error) { if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) throw new MgbaCollectorError("Monitor collection timed out.", "MGBA_COLLECTION_TIMEOUT", 504); throw new MgbaCollectorError("The Monitor worker is currently unavailable.", "MGBA_WORKER_UNAVAILABLE", 503); }
    const body = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (response.status === 409 || body?.error === "collection_in_progress") throw new MgbaCollectorError("A Monitor collection is already in progress. Try again in a moment.", "MGBA_COLLECTION_IN_PROGRESS", 409);
    if (!response.ok || body?.ok !== true) throw new MgbaCollectorError("Monitor collection could not be completed.", "MGBA_COLLECTION_FAILED", 502);
    const returnedDate = typeof body.operationalDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.operationalDate) ? body.operationalDate : operationalDate;
    return { ok: true, operationalDate: returnedDate, snapshotId: Number.isSafeInteger(body.snapshotId) ? Number(body.snapshotId) : undefined,
      capturedAt: typeof body.capturedAt === "string" && !Number.isNaN(Date.parse(body.capturedAt)) ? body.capturedAt : undefined,
      created: body.created === true, deduplicated: body.deduplicated === true };
  } finally { clearTimeout(timeout); }
}
