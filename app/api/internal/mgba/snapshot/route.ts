import { createMgbaDswSnapshot, type MgbaDswRouteInput, type MgbaDswSnapshotInput } from "../../../../../services/integrations/mgba-dsw";
import { validInternalBearer } from "../../bearer";

class PayloadError extends Error {}
const MAX_BYTES = 2_000_000;
function object(value: unknown, field: string): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new PayloadError(`${field} must be an object.`); return value as Record<string, unknown>; }
function text(value: unknown, field: string, required = false, maxLength = 300) { if (value === null || value === undefined || value === "") { if (required) throw new PayloadError(`${field} is required.`); return null; } if (typeof value !== "string" || value.trim().length > maxLength) throw new PayloadError(`${field} must be text no longer than ${maxLength} characters.`); return value.trim() || null; }
function number(value: unknown, field: string, integer = true) { if (value === null || value === undefined || value === "") return null; if (typeof value !== "number" || !Number.isFinite(value) || (integer && !Number.isInteger(value))) throw new PayloadError(`${field} must be a ${integer ? "whole number" : "number"} or null.`); return value; }
function date(value: unknown, field: string) { const parsed = text(value, field, true, 20); if (!/^\d{4}-\d{2}-\d{2}$/.test(parsed || "")) throw new PayloadError(`${field} must use YYYY-MM-DD.`); return parsed as string; }
function row(value: unknown, index: number): MgbaDswRouteInput {
  const source = object(value, `routes[${index}]`); const prefix = `routes[${index}]`;
  const driverName = text(source.driverName, `${prefix}.driverName`, true);
  return { serviceArea: text(source.serviceArea, `${prefix}.serviceArea`), waName: text(source.waName, `${prefix}.waName`), vehicleNumber: text(source.vehicleNumber, `${prefix}.vehicleNumber`), driverName: driverName as string,
    routeNumber: text(source.route, `${prefix}.route`, false, 80), rawRoute: text(source.rawRoute, `${prefix}.rawRoute`, false, 80), dst: text(source.dst, `${prefix}.dst`),
    vscanPkgs: number(source.vscanPkgs, `${prefix}.vscanPkgs`), delStops: number(source.delStops, `${prefix}.delStops`), puStops: number(source.puStops, `${prefix}.puStops`), diff: number(source.diff, `${prefix}.diff`),
    actDelStops: number(source.actDelStops, `${prefix}.actDelStops`), actDelPkgs: number(source.actDelPkgs, `${prefix}.actDelPkgs`), actPuStops: number(source.actPuStops, `${prefix}.actPuStops`), actPuPkgs: number(source.actPuPkgs, `${prefix}.actPuPkgs`),
    ilsPercent: number(source.ilsPercent, `${prefix}.ilsPercent`, false), allStatusCodePkgs: number(source.allStatusCodePkgs, `${prefix}.allStatusCodePkgs`) };
}
export function parseMgbaDswPayload(value: unknown): MgbaDswSnapshotInput {
  const source = object(value, "Request body"); const operationalDate = date(source.operationalDate, "operationalDate"); const dswDate = text(source.dswDate, "dswDate", true, 20) as string;
  const capturedAt = text(source.capturedAt, "capturedAt", true, 100) as string; if (Number.isNaN(Date.parse(capturedAt))) throw new PayloadError("capturedAt must be an ISO timestamp.");
  const rows = source.routes; if (!Array.isArray(rows) || rows.length > 2000) throw new PayloadError("routes must be an array with no more than 2000 driver rows.");
  const normalizedRows = rows.map(row).filter(item => item.driverName.trim()); if (normalizedRows.length !== rows.length) throw new PayloadError("Every submitted route must have a driverName.");
  return { operationalDate, dswDate, capturedAt, source: (text(source.source, "source", true, 80) as string), routeCount: normalizedRows.length, routes: normalizedRows };
}
export async function POST(request: Request) {
  if (!validInternalBearer(request, process.env.MGBA_INGEST_TOKEN)) return Response.json({ error: "Valid ingestion credentials are required.", code: "MGBA_INGEST_UNAUTHORIZED" }, { status: 401 });
  const length = Number(request.headers.get("content-length") || 0); if (Number.isFinite(length) && length > MAX_BYTES) return Response.json({ error: "Request body is too large.", code: "MGBA_INGEST_TOO_LARGE" }, { status: 413 });
  try { const snapshot = await createMgbaDswSnapshot(parseMgbaDswPayload(await request.json())); return Response.json({ snapshotId: snapshot.id, operationalDate: snapshot.operationalDate, capturedAt: snapshot.capturedAt, created: snapshot.created, deduplicated: snapshot.deduplicated }, { status: 201 }); }
  catch (error) { if (error instanceof PayloadError || error instanceof SyntaxError) return Response.json({ error: error instanceof PayloadError ? error.message : "Request body must be valid JSON.", code: "MGBA_INGEST_INVALID" }, { status: 400 }); const errorId = crypto.randomUUID(); console.error("MGBA DSW ingestion failed", { errorId }); return Response.json({ error: "The Monitor snapshot could not be saved.", code: "MGBA_INGEST_FAILED", errorId }, { status: 500 }); }
}
