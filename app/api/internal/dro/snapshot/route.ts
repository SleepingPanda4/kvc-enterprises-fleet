import { createDroSnapshot, type DroRouteInput, type DroSnapshotInput } from "../../../../../services/integrations/dro";
import { validInternalBearer } from "../../bearer";

class PayloadError extends Error {}

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PayloadError(`${field} must be an object.`);
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, field: string, maxLength = 200) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
    throw new PayloadError(`${field} is required and must be ${maxLength} characters or fewer.`);
  }
  return value.trim();
}

function optionalText(value: unknown, field: string, maxLength = 200) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.trim().length > maxLength) {
    throw new PayloadError(`${field} must be text no longer than ${maxLength} characters.`);
  }
  return value.trim() || null;
}

function numberField(record: Record<string, unknown>, field: string, integer = false, nullable = false) {
  const value = record[field];
  if (nullable && (value === null || value === undefined)) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || (integer && !Number.isInteger(value))) {
    throw new PayloadError(`${field} must be a non-negative${integer ? " integer" : " number"}.`);
  }
  return value;
}

function validDateOnly(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function parseRow(value: unknown, index: number): DroRouteInput {
  const row = object(value, `rows[${index}]`);
  const prefix = `rows[${index}]`;
  const deliveryStops = numberField(row, "deliveryStops", true) as number;
  const pickupStops = numberField(row, "pickupStops", true) as number;
  const combinationStops = numberField(row, "combinationStops", true) as number;

  // Accepted for collector compatibility; the service derives the stored total from the components.
  numberField(row, "totalStops", true);

  return {
    routeNumber: optionalText(row.routeNumber, `${prefix}.routeNumber`, 40),
    rawWaNumber: requiredText(row.rawWaNumber, `${prefix}.rawWaNumber`, 100),
    displayWaNumber: optionalText(row.displayWaNumber, `${prefix}.displayWaNumber`, 100),
    deliveryCube: numberField(row, "deliveryCube") as number,
    pickupCube: numberField(row, "pickupCube") as number,
    combinationCube: numberField(row, "combinationCube") as number,
    vehicleCapacity: numberField(row, "vehicleCapacity") as number,
    deliveryPackages: numberField(row, "deliveryPackages", true) as number,
    pickupPackages: numberField(row, "pickupPackages", true) as number,
    combinationPackages: numberField(row, "combinationPackages", true) as number,
    deliveryStops,
    pickupStops,
    combinationStops,
    routeType: optionalText(row.routeType, `${prefix}.routeType`, 100),
    routeTime: optionalText(row.routeTime, `${prefix}.routeTime`, 100),
    distance: numberField(row, "distance", false, true),
  };
}

export function parseDroSnapshotPayload(value: unknown): DroSnapshotInput {
  const payload = object(value, "Request body");
  const operationalDate = requiredText(payload.operationalDate, "operationalDate", 10);
  if (!validDateOnly(operationalDate)) throw new PayloadError("operationalDate must be a real date in YYYY-MM-DD format.");

  const capturedAt = requiredText(payload.capturedAt, "capturedAt", 100);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(capturedAt) || Number.isNaN(Date.parse(capturedAt))) {
    throw new PayloadError("capturedAt must be an ISO timestamp.");
  }
  if (!Array.isArray(payload.rows) || payload.rows.length > 1000) {
    throw new PayloadError("rows must be an array containing no more than 1000 route rows.");
  }

  return {
    operationalDate,
    capturedAt,
    sourceTimestamp: optionalText(payload.sourceTimestamp, "sourceTimestamp", 200),
    stationId: requiredText(payload.stationId, "stationId", 100),
    serviceAreaId: requiredText(payload.serviceAreaId, "serviceAreaId", 100),
    status: requiredText(payload.status, "status", 40),
    rows: payload.rows.map(parseRow),
  };
}

export async function POST(request: Request) {
  if (!validInternalBearer(request, process.env.DRO_INGEST_TOKEN)) {
    return Response.json({ error: "Valid ingestion credentials are required.", code: "DRO_INGEST_UNAUTHORIZED" }, { status: 401 });
  }

  try {
    const payload = parseDroSnapshotPayload(await request.json());
    const snapshot = await createDroSnapshot(payload);
    return Response.json({ snapshotId: snapshot.id, created: snapshot.created, deduplicated: snapshot.deduplicated }, { status: 201 });
  } catch (error) {
    if (error instanceof PayloadError || error instanceof SyntaxError) {
      return Response.json({ error: error instanceof PayloadError ? error.message : "Request body must be valid JSON.", code: "DRO_INGEST_INVALID" }, { status: 400 });
    }
    const errorId = crypto.randomUUID();
    console.error("DRO snapshot ingestion failed", { errorId, error });
    return Response.json({ error: "The DRO snapshot could not be saved.", code: "DRO_INGEST_FAILED", errorId }, { status: 500 });
  }
}
