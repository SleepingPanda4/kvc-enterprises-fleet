export type LiveDroRefreshResult = {
  ok: true;
  snapshotId: number;
  operationalDate: string;
  capturedAt: string;
  created: boolean;
  deduplicated: boolean;
};

export class LiveDroRefreshGuard {
  private active = false;

  get isActive() {
    return this.active;
  }

  async run<T>(work: () => Promise<T>) {
    if (this.active) return undefined;
    this.active = true;
    try {
      return await work();
    } finally {
      this.active = false;
    }
  }
}

export async function requestLiveDroRefresh(fetchImplementation: typeof fetch = fetch) {
  let response: Response;
  try {
    response = await fetchImplementation("/api/dro/refresh", { method: "POST" });
  } catch {
    throw new Error("Could not connect to the DRO collection service.");
  }
  const body = await response.json().catch(() => ({ error: "DRO collection could not be completed." })) as Partial<LiveDroRefreshResult> & { error?: string; message?: string };
  if (!response.ok) throw new Error(body.message || body.error || "DRO collection could not be completed.");
  if (body.ok !== true || !Number.isSafeInteger(body.snapshotId) || !body.operationalDate) {
    throw new Error("DRO collection returned an invalid result.");
  }
  return body as LiveDroRefreshResult;
}

export async function loadCollectedDroView<TDateIndex, TDateInfo, TSnapshot>(
  result: Pick<LiveDroRefreshResult, "snapshotId" | "operationalDate">,
  requestJson: <T>(url: string) => Promise<T>,
) {
  const [dateIndex, dateInfo, data] = await Promise.all([
    requestJson<TDateIndex>("/api/dro/dates"),
    requestJson<TDateInfo>(`/api/dro/date?date=${encodeURIComponent(result.operationalDate)}`),
    requestJson<TSnapshot>(`/api/dro/snapshot?id=${result.snapshotId}`),
  ]);
  return { dateIndex, dateInfo, data, selectedDate: result.operationalDate, selectedSnapshotId: result.snapshotId };
}
