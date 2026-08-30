import { requestDroCollection, type DroCollectionResult } from "./dro-collector";
import { DRO_REFRESH_WINDOW_MESSAGE, isDroManualRefreshAllowed } from "./dro-operational-date";

export class DroRefreshWindowError extends Error {
  constructor() {
    super(DRO_REFRESH_WINDOW_MESSAGE);
  }
}

export async function requestManualDroCollection(
  now: Date = new Date(),
  collect: () => Promise<DroCollectionResult> = requestDroCollection,
) {
  if (!isDroManualRefreshAllowed(now)) throw new DroRefreshWindowError();
  return collect();
}
