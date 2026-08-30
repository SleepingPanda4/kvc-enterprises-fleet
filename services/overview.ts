import { desc, eq, sql } from "drizzle-orm";
import { getDb, type Database } from "../db";
import { issues, teamMembers, vehicles } from "../db/schema";
import { getLatestSuccessfulDroSummary } from "./integrations/dro";

export async function getOverviewData(database: Database = getDb()) {
  const [vehicleCount] = await database.select({ count: sql<number>`count(*)` }).from(vehicles);
  const [teamCount] = await database.select({ count: sql<number>`count(*)` }).from(teamMembers);
  const openIssues = await database.select({
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
  const droSummary = await getLatestSuccessfulDroSummary(database);

  return {
    vehicleCount: Number(vehicleCount?.count || 0),
    teamCount: Number(teamCount?.count || 0),
    openIssues,
    droSummary,
  };
}
