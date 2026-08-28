import { eq } from "drizzle-orm";
import { getDb, type Database } from "../../db";
import { routes } from "../../db/schema";

export async function ensureRoute(routeNumber: string, database: Database = getDb()) {
  const normalized = routeNumber.trim();
  if (!normalized) return null;

  await database.insert(routes).values({ routeNumber: normalized }).onConflictDoNothing({ target: routes.routeNumber });
  const [route] = await database.select().from(routes).where(eq(routes.routeNumber, normalized)).limit(1);
  return route || null;
}
