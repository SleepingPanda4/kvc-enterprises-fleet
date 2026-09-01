import { desc, eq } from "drizzle-orm";
import { getDb, type Database } from "../db";
import { issues, vehicles } from "../db/schema";

export async function getVehicleIssueTickets(database: Database = getDb()) {
  return database.select({
    id: issues.id,
    vehicleId: vehicles.id,
    vehicleNumber: vehicles.number,
    routeNumber: vehicles.routeNumber,
    type: issues.type,
    notes: issues.notes,
    status: issues.status,
    serviceScheduled: issues.serviceScheduled,
    createdAt: issues.createdAt,
    resolvedAt: issues.resolvedAt,
    resolutionNotes: issues.resolutionNotes,
    reportedByName: issues.reportedByName,
  }).from(issues).innerJoin(vehicles, eq(issues.vehicleId, vehicles.id))
    .orderBy(desc(issues.createdAt), desc(issues.id));
}
