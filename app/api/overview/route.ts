import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { issues, teamMembers, vehicles } from "../../../db/schema";
import { requireUser } from "../../auth/server";

export async function GET(request: Request) {
  const auth = await requireUser(request); if (auth instanceof Response) return auth;
  try {
    const db = getDb();
    const [vehicleCount] = await db.select({ count: sql<number>`count(*)` }).from(vehicles);
    const [teamCount] = await db.select({ count: sql<number>`count(*)` }).from(teamMembers);
    const openIssues = await db.select({
      id: issues.id,
      vehicleId: vehicles.id,
      vehicleNumber: vehicles.number,
      routeNumber: vehicles.routeNumber,
      type: issues.type,
      notes: issues.notes,
      serviceScheduled: issues.serviceScheduled,
      createdAt: issues.createdAt,
    }).from(issues).innerJoin(vehicles, eq(issues.vehicleId, vehicles.id))
      .where(eq(issues.status, "open")).orderBy(desc(issues.createdAt));

    return Response.json({
      vehicleCount: Number(vehicleCount?.count || 0),
      teamCount: Number(teamCount?.count || 0),
      openIssues,
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not load overview." }, { status: 500 });
  }
}
