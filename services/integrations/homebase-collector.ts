const DEFAULT_COLLECTOR_URL = "http://127.0.0.1:3102/collect";
const DEFAULT_TIMEOUT_MS = 90_000;

export type HomebaseCollectionResult = {
  ok: true;
  rangeStart: string;
  rangeEnd: string;
  collectedAt: string;
  imported: number;
  updated: number;
  unchanged: number;
  removed: number;
  dates: string[];
  routeAssignments: number;
  specialAssignments: number;
};

export class HomebaseCollectorError extends Error {
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

let collectionInProgress = false;

function collectorFailure(error: unknown, status: number) {
  const code = error && typeof error === "object" && "error" in error ? String(error.error) : "";
  if (status === 409 || code === "collection_in_progress") {
    return new HomebaseCollectorError("A Homebase collection is already in progress. Try again in a moment.", "HOMEBASE_COLLECTION_IN_PROGRESS", 409);
  }
  if (code === "ingestion_failed") {
    return new HomebaseCollectorError("Homebase was collected, but the schedule could not be imported.", "HOMEBASE_INGESTION_FAILED", 502);
  }
  if (code.includes("auth")) {
    return new HomebaseCollectorError("The Homebase collector could not authenticate.", "HOMEBASE_COLLECTOR_AUTH_FAILED", 502);
  }
  return new HomebaseCollectorError("Homebase assignments could not be refreshed.", "HOMEBASE_COLLECTION_FAILED", 502);
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function count(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export async function requestHomebaseCollection(options: CollectorOptions = {}): Promise<HomebaseCollectionResult> {
  if (collectionInProgress) {
    throw new HomebaseCollectorError("A Homebase collection is already in progress. Try again in a moment.", "HOMEBASE_COLLECTION_IN_PROGRESS", 409);
  }

  const token = process.env.HOMEBASE_COLLECTOR_TOKEN;
  if (!token) {
    throw new HomebaseCollectorError("Homebase live collection is not configured.", "HOMEBASE_COLLECTOR_NOT_CONFIGURED", 503);
  }

  collectionInProgress = true;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await (options.fetchImplementation || fetch)(process.env.HOMEBASE_COLLECTOR_URL || DEFAULT_COLLECTOR_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
        throw new HomebaseCollectorError("Homebase collection timed out.", "HOMEBASE_COLLECTION_TIMEOUT", 504);
      }
      throw new HomebaseCollectorError("The Homebase collector is currently unavailable.", "HOMEBASE_COLLECTOR_UNAVAILABLE", 503);
    }

    const body = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok || body?.ok !== true) throw collectorFailure(body, response.status);
    const imported = count(body.imported);
    const updated = count(body.updated);
    const unchanged = count(body.unchanged);
    const removed = count(body.removed);
    const routeAssignments = count(body.routeAssignments);
    const specialAssignments = count(body.specialAssignments);
    if (!validDate(body.rangeStart) || !validDate(body.rangeEnd)
      || typeof body.collectedAt !== "string" || Number.isNaN(Date.parse(body.collectedAt))
      || !Array.isArray(body.dates) || !body.dates.every(validDate)
      || imported === null || updated === null || unchanged === null || removed === null
      || routeAssignments === null || specialAssignments === null) {
      throw new HomebaseCollectorError("Homebase collector returned an invalid result.", "HOMEBASE_COLLECTOR_INVALID_RESPONSE", 502);
    }
    return { ok: true, rangeStart: body.rangeStart, rangeEnd: body.rangeEnd, collectedAt: body.collectedAt, imported, updated, unchanged, removed, dates: body.dates, routeAssignments, specialAssignments };
  } finally {
    clearTimeout(timeout);
    collectionInProgress = false;
  }
}
