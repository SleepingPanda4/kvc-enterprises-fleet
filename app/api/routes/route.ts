import { eq, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { routes, routeSettings, vehicles } from "../../../db/schema";
import { requireManager, requireUser } from "../../auth/server";
import { routeColorPalette } from "../../routes/config";
import { getLatestDroSnapshot } from "../../../services/integrations/dro";
import { listHomebaseAssignments, tomorrowInTimeZone } from "../../../services/integrations/homebase";

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  try {
    const db = getDb();
    const [routeRows, fleet, assignments, latestDro] = await Promise.all([
      db.select().from(routes).orderBy(sql`CAST(${routes.routeNumber} AS INTEGER)`),
      db.select({ id: vehicles.id, number: vehicles.number, routeNumber: vehicles.routeNumber, makeModel: vehicles.makeModel }).from(vehicles),
      listHomebaseAssignments(tomorrowInTimeZone(), db),
      getLatestDroSnapshot(db),
    ]);
    const vehicleByRoute = new Map(fleet.filter(vehicle => vehicle.routeNumber).map(vehicle => [vehicle.routeNumber, vehicle]));
    const assignmentByRoute = new Map(assignments.filter(item => item.routeNumber).map(item => [item.routeNumber, item]));
    const droByRoute = new Map((latestDro?.rows || []).filter(item => item.routeNumber || item.registeredRouteNumber)
      .map(item => [item.routeNumber || item.registeredRouteNumber, item]));

    return Response.json({
      routes: routeRows.map(route => ({
        id: route.id,
        routeNumber: route.routeNumber,
        displayName: route.displayName,
        description: route.description,
        color: route.color,
        vehicle: vehicleByRoute.get(route.routeNumber) || null,
        driver: assignmentByRoute.get(route.routeNumber) || null,
        dro: droByRoute.get(route.routeNumber) || null,
      })),
      droSnapshot: latestDro?.snapshot || null,
    });
  } catch (error) {
    const errorId = crypto.randomUUID();
    console.error("Route read failed", { errorId, error });
    return Response.json({ error: "Routes could not be loaded.", code: "ROUTES_READ_FAILED", errorId }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const auth = await requireManager(request);
  if (auth instanceof Response) return auth;

  try {
    const payload = await request.json() as { routeNumber?: string; color?: string };
    const routeNumber = String(payload.routeNumber || "").trim();
    const color = String(payload.color || "").trim().toUpperCase();
    if (!routeNumber || !routeColorPalette.some(option => option === color)) {
      return Response.json({ error: "Choose a valid route and color.", code: "ROUTE_COLOR_INVALID" }, { status: 400 });
    }

    const db = getDb();
    const [existingRoute] = await db.select().from(routes).where(eq(routes.routeNumber, routeNumber)).limit(1);
    if (!existingRoute) {
      return Response.json({ error: "That route does not exist.", code: "ROUTE_NOT_FOUND" }, { status: 404 });
    }
    const now = new Date().toISOString();
    const [route] = await db.update(routes).set({ color, updatedAt: now })
      .where(eq(routes.id, existingRoute.id)).returning();
    await db.insert(routeSettings)
      .values({ routeNumber, color, updatedAt: now })
      .onConflictDoUpdate({ target: routeSettings.routeNumber, set: { color, updatedAt: now } })
      .returning();
    return Response.json({ route });
  } catch (error) {
    const errorId = crypto.randomUUID();
    console.error("Route color update failed", { errorId, error });
    return Response.json({ error: "Route color could not be saved.", code: "ROUTE_COLOR_SAVE_FAILED", errorId }, { status: 500 });
  }
}
