const COLLECTOR_URL = "http://127.0.0.1:3101/collect";
const DEFAULT_TIMEOUT_MS = 75_000;

export type DroCollectionResult = {
  ok: true;
  snapshotId: number;
  operationalDate: string;
  capturedAt: string;
  created: boolean;
  deduplicated: boolean;
};

export class DroCollectorError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
  }
}

type CollectorOptions = {
  fetchImplementation?: typeof fetch;
  timeoutMs?: number;
};

function collectorFailure(error: unknown, status: number) {
  const code = error && typeof error === "object" && "error" in error ? String(error.error) : "";
  if (status === 409 || code === "collection_in_progress") {
    return new DroCollectorError("A DRO collection is already in progress. Try again in a moment.", "DRO_COLLECTION_IN_PROGRESS", 409);
  }
  if (code === "ingestion_failed") {
    return new DroCollectorError("DRO was collected, but the snapshot could not be saved.", "DRO_INGESTION_FAILED", 502);
  }
  if (code.includes("auth")) {
    return new DroCollectorError("The DRO collector could not authenticate with DRO.", "DRO_COLLECTOR_AUTH_FAILED", 502);
  }
  return new DroCollectorError("DRO collection could not be completed.", "DRO_COLLECTION_FAILED", 502);
}

export async function requestDroCollection(options: CollectorOptions = {}): Promise<DroCollectionResult> {
  const token = process.env.DRO_INGEST_TOKEN;
  if (!token) {
    throw new DroCollectorError("DRO live collection is not configured.", "DRO_COLLECTOR_NOT_CONFIGURED", 503);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await (options.fetchImplementation || fetch)(COLLECTOR_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
        throw new DroCollectorError("DRO collection timed out.", "DRO_COLLECTION_TIMEOUT", 504);
      }
      throw new DroCollectorError("DRO collector is currently unavailable.", "DRO_COLLECTOR_UNAVAILABLE", 503);
    }

    const body = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok || body?.ok !== true) throw collectorFailure(body, response.status);

    const snapshotId = body.snapshotId;
    const operationalDate = body.operationalDate;
    const capturedAt = body.capturedAt;
    if (!Number.isSafeInteger(snapshotId) || Number(snapshotId) <= 0
      || typeof operationalDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(operationalDate)
      || typeof capturedAt !== "string" || Number.isNaN(Date.parse(capturedAt))) {
      throw new DroCollectorError("DRO collector returned an invalid result.", "DRO_COLLECTOR_INVALID_RESPONSE", 502);
    }

    return {
      ok: true,
      snapshotId: Number(snapshotId),
      operationalDate,
      capturedAt,
      created: body.created !== false,
      deduplicated: body.deduplicated === true,
    };
  } finally {
    clearTimeout(timeout);
  }
}
