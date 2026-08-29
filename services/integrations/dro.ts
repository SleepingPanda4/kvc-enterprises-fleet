import { desc, eq, sql } from "drizzle-orm";
import { getDb, type Database } from "../../db";
import { droRouteRows, droSnapshots, routes } from "../../db/schema";
import { calculateDroMetrics, type DroComponents } from "./dro-calculations";
import { ensureRoute } from "./routes";

export type DroRouteInput = DroComponents & {
  routeNumber?: string | null;
  rawWaNumber: string;
  displayWaNumber?: string | null;
  routeType?: string | null;
  routeTime?: string | null;
  distance?: number | null;
};

export type DroSnapshotInput = {
  operationalDate: string;
  capturedAt: string;
  sourceTimestamp?: string | null;
  stationId: string;
  serviceAreaId: string;
  status: string;
  errorMessage?: string | null;
  rows: DroRouteInput[];
};

export async function createDroSnapshot(input: DroSnapshotInput, database: Database = getDb()) {
  const preparedRows: Array<{
    row: DroRouteInput;
    routeNumber: string | null;
    routeId: number | null;
    metrics: ReturnType<typeof calculateDroMetrics>;
  }> = [];
  for (const row of input.rows) {
    const routeNumber = row.routeNumber?.trim() || null;
    const route = routeNumber ? await ensureRoute(routeNumber, database) : null;
    preparedRows.push({ row, routeNumber, routeId: route?.id || null, metrics: calculateDroMetrics(row) });
  }

  return database.transaction(async transaction => {
    const [snapshot] = await transaction.insert(droSnapshots).values({
      operationalDate: input.operationalDate.trim(),
      capturedAt: input.capturedAt.trim(),
      sourceTimestamp: input.sourceTimestamp?.trim() || null,
      stationId: input.stationId.trim(),
      serviceAreaId: input.serviceAreaId.trim(),
      status: input.status.trim(),
      errorMessage: input.errorMessage?.trim() || null,
    }).returning();

    if (preparedRows.length) {
      await transaction.insert(droRouteRows).values(preparedRows.map(({ row, routeNumber, routeId, metrics }) => ({
        snapshotId: snapshot.id,
        routeId,
        routeNumber,
        rawWaNumber: row.rawWaNumber.trim(),
        displayWaNumber: row.displayWaNumber?.trim() || null,
        ...metrics,
        routeType: row.routeType?.trim() || null,
        routeTime: row.routeTime?.trim() || null,
        distance: row.distance ?? null,
      })));
    }
    return snapshot;
  });
}

export async function listDroOperationalDates(database: Database = getDb()) {
  return database.select({
    operationalDate: droSnapshots.operationalDate,
    snapshotCount: sql<number>`COUNT(*)`,
    latestCapturedAt: sql<string>`MAX(${droSnapshots.capturedAt})`,
  }).from(droSnapshots)
    .groupBy(droSnapshots.operationalDate)
    .orderBy(desc(droSnapshots.operationalDate));
}

export async function getDroSnapshotsForDate(operationalDate: string, database: Database = getDb()) {
  return database.select().from(droSnapshots)
    .where(eq(droSnapshots.operationalDate, operationalDate))
    .orderBy(desc(droSnapshots.capturedAt), desc(droSnapshots.id));
}

export async function getDroDateNavigation(operationalDate: string, database: Database = getDb()) {
  const dates = await listDroOperationalDates(database);
  const ascendingDates = dates.map(item => item.operationalDate).sort((left, right) => left.localeCompare(right));
  return {
    previousDate: ascendingDates.filter(date => date < operationalDate).at(-1) || null,
    nextDate: ascendingDates.find(date => date > operationalDate) || null,
    latestDate: ascendingDates.at(-1) || null,
  };
}

async function getDroRouteRows(snapshotId: number, database: Database) {
  const rows = await database.select({
    id: droRouteRows.id,
    snapshotId: droRouteRows.snapshotId,
    routeId: droRouteRows.routeId,
    routeNumber: droRouteRows.routeNumber,
    registeredRouteNumber: routes.routeNumber,
    rawWaNumber: droRouteRows.rawWaNumber,
    displayWaNumber: droRouteRows.displayWaNumber,
    deliveryCube: droRouteRows.deliveryCube,
    pickupCube: droRouteRows.pickupCube,
    combinationCube: droRouteRows.combinationCube,
    usedCapacity: droRouteRows.usedCapacity,
    vehicleCapacity: droRouteRows.vehicleCapacity,
    deliveryPackages: droRouteRows.deliveryPackages,
    pickupPackages: droRouteRows.pickupPackages,
    combinationPackages: droRouteRows.combinationPackages,
    totalPackages: droRouteRows.totalPackages,
    deliveryStops: droRouteRows.deliveryStops,
    pickupStops: droRouteRows.pickupStops,
    combinationStops: droRouteRows.combinationStops,
    totalStops: droRouteRows.totalStops,
    routeType: droRouteRows.routeType,
    routeTime: droRouteRows.routeTime,
    distance: droRouteRows.distance,
    warning: droRouteRows.warning,
  }).from(droRouteRows)
    .leftJoin(routes, eq(droRouteRows.routeId, routes.id))
    .where(eq(droRouteRows.snapshotId, snapshotId));
  return rows;
}

export async function getDroSnapshotById(snapshotId: number, database: Database = getDb()) {
  const [snapshot] = await database.select().from(droSnapshots).where(eq(droSnapshots.id, snapshotId)).limit(1);
  if (!snapshot) return null;
  const rows = await getDroRouteRows(snapshot.id, database);
  return { snapshot, rows };
}

export async function getLatestDroSnapshot(database: Database = getDb()) {
  const [snapshot] = await database.select().from(droSnapshots)
    .orderBy(desc(droSnapshots.operationalDate), desc(droSnapshots.capturedAt), desc(droSnapshots.id)).limit(1);
  return snapshot ? getDroSnapshotById(snapshot.id, database) : null;
}
