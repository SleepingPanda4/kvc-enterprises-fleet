import { desc, eq, sql } from "drizzle-orm";
import { getDb, type Database } from "../../db";
import { mgbaDswRouteRows, mgbaDswSnapshots, routes } from "../../db/schema";
import { mgbaDswRoutesAreIdentical, type ComparableMgbaDswRoute } from "./mgba-dsw-deduplication";
import { normalizeMgbaDswRoute } from "./mgba-dsw-normalization";
import { ensureRoute } from "./routes";

export type MgbaDswRouteInput = ComparableMgbaDswRoute;
export type MgbaDswSnapshotInput = { operationalDate: string; dswDate: string; capturedAt: string; source: string; routeCount: number; routes: MgbaDswRouteInput[] };
let mgbaSnapshotQueue: Promise<void> = Promise.resolve();

export { normalizeMgbaDswRoute, normalizeMgbaRouteNumber } from "./mgba-dsw-normalization";

async function withMgbaSnapshotLock<T>(work: () => Promise<T>) {
  const previous = mgbaSnapshotQueue;
  let release: () => void = () => {};
  mgbaSnapshotQueue = new Promise(resolve => { release = resolve; });
  await previous;
  try { return await work(); } finally { release(); }
}

export async function createMgbaDswSnapshot(input: MgbaDswSnapshotInput, database: Database = getDb()) {
  return withMgbaSnapshotLock(async () => {
    const prepared = input.routes.map(normalizeMgbaDswRoute);
    const [newest] = await database.select().from(mgbaDswSnapshots)
      .where(eq(mgbaDswSnapshots.operationalDate, input.operationalDate)).orderBy(desc(mgbaDswSnapshots.capturedAt), desc(mgbaDswSnapshots.id)).limit(1);
    if (newest) {
      const existingRows = await getMgbaDswRouteRows(newest.id, database);
      if (mgbaDswRoutesAreIdentical(prepared, existingRows)) return { ...newest, created: false, deduplicated: true };
    }
    const resolvedRoutes = await Promise.all(prepared.map(async row => ({ row, route: row.routeNumber ? await ensureRoute(row.routeNumber, database) : null })));
    return database.transaction(async transaction => {
      const [snapshot] = await transaction.insert(mgbaDswSnapshots).values({
        operationalDate: input.operationalDate, dswDate: input.dswDate, capturedAt: input.capturedAt, source: input.source, routeCount: prepared.length,
      }).returning();
      if (resolvedRoutes.length) await transaction.insert(mgbaDswRouteRows).values(resolvedRoutes.map(({ row, route }) => ({ ...row, snapshotId: snapshot.id, routeId: route?.id || null })));
      return { ...snapshot, created: true, deduplicated: false };
    });
  });
}

export async function listMgbaDswOperationalDates(database: Database = getDb()) {
  return database.select({ operationalDate: mgbaDswSnapshots.operationalDate, snapshotCount: sql<number>`COUNT(*)`, latestCapturedAt: sql<string>`MAX(${mgbaDswSnapshots.capturedAt})` })
    .from(mgbaDswSnapshots).groupBy(mgbaDswSnapshots.operationalDate).orderBy(desc(mgbaDswSnapshots.operationalDate));
}
export async function getMgbaDswSnapshotsForDate(operationalDate: string, database: Database = getDb()) {
  return database.select().from(mgbaDswSnapshots).where(eq(mgbaDswSnapshots.operationalDate, operationalDate)).orderBy(desc(mgbaDswSnapshots.capturedAt), desc(mgbaDswSnapshots.id));
}
export async function getMgbaDswDateNavigation(operationalDate: string, database: Database = getDb()) {
  const dates = (await listMgbaDswOperationalDates(database)).map(item => item.operationalDate).sort();
  return { previousDate: dates.filter(date => date < operationalDate).at(-1) || null, nextDate: dates.find(date => date > operationalDate) || null, latestDate: dates.at(-1) || null };
}
export async function getMgbaDswRouteRows(snapshotId: number, database: Database = getDb()) {
  return database.select({ id: mgbaDswRouteRows.id, snapshotId: mgbaDswRouteRows.snapshotId, routeId: mgbaDswRouteRows.routeId, registeredRouteNumber: routes.routeNumber,
    serviceArea: mgbaDswRouteRows.serviceArea, waName: mgbaDswRouteRows.waName, vehicleNumber: mgbaDswRouteRows.vehicleNumber, driverName: mgbaDswRouteRows.driverName,
    routeNumber: mgbaDswRouteRows.routeNumber, rawRoute: mgbaDswRouteRows.rawRoute, dst: mgbaDswRouteRows.dst, vscanPkgs: mgbaDswRouteRows.vscanPkgs,
    delStops: mgbaDswRouteRows.delStops, puStops: mgbaDswRouteRows.puStops, diff: mgbaDswRouteRows.diff, actDelStops: mgbaDswRouteRows.actDelStops,
    actDelPkgs: mgbaDswRouteRows.actDelPkgs, actPuStops: mgbaDswRouteRows.actPuStops, actPuPkgs: mgbaDswRouteRows.actPuPkgs,
    ilsPercent: mgbaDswRouteRows.ilsPercent, allStatusCodePkgs: mgbaDswRouteRows.allStatusCodePkgs,
  }).from(mgbaDswRouteRows).leftJoin(routes, eq(mgbaDswRouteRows.routeId, routes.id)).where(eq(mgbaDswRouteRows.snapshotId, snapshotId));
}
export async function getMgbaDswSnapshotById(snapshotId: number, database: Database = getDb()) {
  const [snapshot] = await database.select().from(mgbaDswSnapshots).where(eq(mgbaDswSnapshots.id, snapshotId)).limit(1);
  return snapshot ? { snapshot, rows: await getMgbaDswRouteRows(snapshot.id, database) } : null;
}
