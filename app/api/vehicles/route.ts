import { eq, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { issues, vehicleModels, vehicles } from "../../../db/schema";
import { requireManager, requireUser } from "../../auth/server";

export async function GET(request: Request) {
  const auth = await requireUser(request); if (auth instanceof Response) return auth;
  try { const db = getDb(); const rows = await db.select({ id: vehicles.id, number: vehicles.number, routeNumber: vehicles.routeNumber, makeModel: vehicles.makeModel, year: vehicles.year, openIssues: sql<number>`sum(case when ${issues.status} = 'open' then 1 else 0 end)` }).from(vehicles).leftJoin(issues, eq(vehicles.id, issues.vehicleId)).groupBy(vehicles.id).orderBy(vehicles.number); return Response.json({ vehicles: rows }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Could not load vehicles" }, { status: 500 }); }
}

export async function POST(request: Request) {
  const auth = await requireManager(request); if (auth instanceof Response) return auth;
  try { const payload = await request.json() as Record<string, string>; const routeNumber = payload.routeNumber?.trim() || null; const makeModel = (payload.makeModel || payload.presetModel || "").trim(); if (!payload.number?.trim() || !makeModel) return Response.json({ error: "Vehicle number and model are required" }, { status: 400 }); const db = getDb(); if (routeNumber) { const [owner] = await db.select({ number: vehicles.number }).from(vehicles).where(eq(vehicles.routeNumber, routeNumber)).limit(1); if (owner) return Response.json({ error: `Route ${routeNumber} is already assigned to vehicle #${owner.number}.` }, { status: 409 }); } await db.insert(vehicleModels).values({ name: makeModel }).onConflictDoNothing(); const [row] = await db.insert(vehicles).values({ number: payload.number.trim(), routeNumber, makeModel, year: payload.year ? Number(payload.year) : null }).returning(); return Response.json({ vehicle: row }, { status: 201 }); }
  catch (error) { const message = error instanceof Error ? error.message : "Could not add vehicle"; return Response.json({ error: message.includes("vehicles_route_number_unique") ? "That route is already assigned." : message }, { status: message.includes("vehicles_route_number_unique") ? 409 : 500 }); }
}
