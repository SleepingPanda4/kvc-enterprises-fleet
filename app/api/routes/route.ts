import { getDb } from "../../../db";
import { routeSettings, vehicles } from "../../../db/schema";
import { requireManager, requireUser } from "../../auth/server";
import { defaultRouteColor, routeColorPalette, routeNumbers } from "../../routes/config";

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  try {
    const db = getDb();
    const [settings, fleet] = await Promise.all([
      db.select().from(routeSettings),
      db.select({ id: vehicles.id, number: vehicles.number, routeNumber: vehicles.routeNumber, makeModel: vehicles.makeModel }).from(vehicles),
    ]);
    const colorByRoute = new Map(settings.map(setting => [setting.routeNumber, setting.color]));
    const vehicleByRoute = new Map(fleet.filter(vehicle => vehicle.routeNumber).map(vehicle => [vehicle.routeNumber, vehicle]));

    return Response.json({
      routes: routeNumbers.map(routeNumber => ({
        routeNumber,
        color: colorByRoute.get(routeNumber) || defaultRouteColor,
        vehicle: vehicleByRoute.get(routeNumber) || null,
      })),
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not load routes." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const auth = await requireManager(request);
  if (auth instanceof Response) return auth;

  try {
    const payload = await request.json() as { routeNumber?: string; color?: string };
    const routeNumber = String(payload.routeNumber || "").trim();
    const color = String(payload.color || "").trim().toUpperCase();
    if (!routeNumbers.some(route => route === routeNumber) || !routeColorPalette.some(option => option === color)) {
      return Response.json({ error: "Choose a valid route and color.", code: "ROUTE_COLOR_INVALID" }, { status: 400 });
    }

    const now = new Date().toISOString();
    const [setting] = await getDb().insert(routeSettings)
      .values({ routeNumber, color, updatedAt: now })
      .onConflictDoUpdate({ target: routeSettings.routeNumber, set: { color, updatedAt: now } })
      .returning();
    return Response.json({ route: setting });
  } catch (error) {
    const errorId = crypto.randomUUID();
    console.error("Route color update failed", { errorId, error });
    return Response.json({ error: "Route color could not be saved.", code: "ROUTE_COLOR_SAVE_FAILED", errorId }, { status: 500 });
  }
}
