import { ingestHomebaseSchedule, type HomebaseCollectedShiftInput, type HomebaseScheduleInput } from "../../../../../services/integrations/homebase";
import { validOperationalDate } from "../../../../../services/integrations/daily-assignments";
import { validInternalBearer } from "../../bearer";

class PayloadError extends Error {}

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PayloadError(`${field} must be an object.`);
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string, maxLength: number, optional = false) {
  if (optional && (value === undefined || value === null || value === "")) return null;
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
    throw new PayloadError(`${field} must be ${optional ? "text" : "provided"} and no longer than ${maxLength} characters.`);
  }
  return value.trim();
}

function timestamp(value: unknown, field: string) {
  const result = text(value, field, 100);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(result || "") || Number.isNaN(Date.parse(result || ""))) {
    throw new PayloadError(`${field} must be an ISO timestamp.`);
  }
  return result as string;
}

function parseShift(value: unknown, index: number): HomebaseCollectedShiftInput {
  const shift = object(value, `shifts[${index}]`);
  const prefix = `shifts[${index}]`;
  const date = text(shift.date, `${prefix}.date`, 10) as string;
  if (!validOperationalDate(date)) throw new PayloadError(`${prefix}.date must be a real date in YYYY-MM-DD format.`);
  const type = text(shift.type, `${prefix}.type`, 20, true);
  if (type && !["route", "special", "other"].includes(type.toLowerCase())) {
    throw new PayloadError(`${prefix}.type must be route, special, or other.`);
  }
  const route = text(shift.route, `${prefix}.route`, 40, true);
  if (route && !/^\d{3,4}$/.test(route)) throw new PayloadError(`${prefix}.route must be a 3- or 4-digit route number.`);

  return {
    homebaseShiftId: text(shift.homebaseShiftId, `${prefix}.homebaseShiftId`, 200) as string,
    homebaseUserId: text(shift.homebaseUserId, `${prefix}.homebaseUserId`, 200) as string,
    homebaseJobId: text(shift.homebaseJobId, `${prefix}.homebaseJobId`, 200, true),
    date,
    employee: text(shift.employee, `${prefix}.employee`, 200) as string,
    firstName: text(shift.firstName, `${prefix}.firstName`, 100, true),
    lastName: text(shift.lastName, `${prefix}.lastName`, 100, true),
    startAt: timestamp(shift.startAt, `${prefix}.startAt`),
    endAt: timestamp(shift.endAt, `${prefix}.endAt`),
    assignment: text(shift.assignment, `${prefix}.assignment`, 200) as string,
    route,
    type,
    confidence: text(shift.confidence, `${prefix}.confidence`, 40, true),
    note: text(shift.note, `${prefix}.note`, 1000, true),
    publishedStatus: text(shift.publishedStatus, `${prefix}.publishedStatus`, 40, true),
  };
}

export function parseHomebaseSchedulePayload(value: unknown): HomebaseScheduleInput {
  const payload = object(value, "Request body");
  const rangeStart = text(payload.rangeStart, "rangeStart", 10) as string;
  const rangeEnd = text(payload.rangeEnd, "rangeEnd", 10) as string;
  if (!validOperationalDate(rangeStart) || !validOperationalDate(rangeEnd) || rangeStart > rangeEnd) {
    throw new PayloadError("rangeStart and rangeEnd must be a valid ascending YYYY-MM-DD range.");
  }
  if (!Array.isArray(payload.shifts) || payload.shifts.length > 1000) {
    throw new PayloadError("shifts must be an array containing no more than 1000 shifts.");
  }
  return {
    rangeStart,
    rangeEnd,
    collectedAt: timestamp(payload.collectedAt, "collectedAt"),
    shifts: payload.shifts.map(parseShift),
  };
}

export async function POST(request: Request) {
  if (!validInternalBearer(request, process.env.HOMEBASE_INGEST_TOKEN)) {
    return Response.json({ error: "Valid Homebase ingestion credentials are required.", code: "HOMEBASE_INGEST_UNAUTHORIZED" }, { status: 401 });
  }
  try {
    const payload = parseHomebaseSchedulePayload(await request.json());
    return Response.json(await ingestHomebaseSchedule(payload));
  } catch (error) {
    if (error instanceof PayloadError || error instanceof SyntaxError) {
      return Response.json({ error: error instanceof PayloadError ? error.message : "Request body must be valid JSON.", code: "HOMEBASE_INGEST_INVALID" }, { status: 400 });
    }
    const errorId = crypto.randomUUID();
    console.error("Homebase schedule ingestion failed", { errorId });
    return Response.json({ error: "The Homebase schedule could not be saved.", code: "HOMEBASE_INGEST_FAILED", errorId }, { status: 500 });
  }
}
