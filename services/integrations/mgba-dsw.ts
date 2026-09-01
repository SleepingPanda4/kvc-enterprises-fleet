import { asc, desc, eq, sql } from "drizzle-orm";
import { getDb, type Database } from "../../db";
import { mgbaDswRouteRows, mgbaDswSnapshots, mgbaDswStatusPackages, routes, teamMembers } from "../../db/schema";
import { mgbaDswRoutesAreIdentical, type ComparableMgbaDswRoute } from "./mgba-dsw-deduplication";
import { normalizeMgbaDswRoute } from "./mgba-dsw-normalization";
import { ensureRoute } from "./routes";

export type MgbaStatusPackageCaptureState = "not_applicable" | "captured" | "incomplete" | "failed";
export type MgbaDswStatusPackageInput = { packageNumber: number; additionalInfo: string | null; visionLabel: string | null; trackingId: string | null; destinationAddress: string | null; vehicleNumber: string | null; vsaStatusCode: string | null; starStatusCode: string | null; starScanTime: string | null; isGreyedOut: boolean };
export type MgbaDswRouteInput = ComparableMgbaDswRoute & { driverOrder?: number; statusPackagesState?: MgbaStatusPackageCaptureState; statusPackages?: MgbaDswStatusPackageInput[] };
export type MgbaDswSnapshotInput = { operationalDate: string; dswDate: string; capturedAt: string; source: string; routeCount: number; routes: MgbaDswRouteInput[] };
let mgbaSnapshotQueue: Promise<void> = Promise.resolve();

export { normalizeMgbaDswRoute, normalizeMgbaRouteNumber } from "./mgba-dsw-normalization";

function comparablePackages(packages: readonly MgbaDswStatusPackageInput[]) {
  return packages.map(item => JSON.stringify([item.packageNumber, item.additionalInfo, item.visionLabel, item.trackingId, item.destinationAddress, item.vehicleNumber, item.vsaStatusCode, item.starStatusCode, item.starScanTime, item.isGreyedOut])).sort();
}

const CHICAGO_TIME_ZONE = "America/Chicago";

function chicagoParts(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: CHICAGO_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: string) => parts.find(item => item.type === type)?.value || "";
  return { year: part("year"), month: part("month"), day: part("day"), hour: part("hour") };
}

export function chicagoCalendarDate(value: Date = new Date()) {
  const parts = chicagoParts(value);
  return parts ? `${parts.year}-${parts.month}-${parts.day}` : "";
}

export function chicagoHourKey(capturedAt: string) {
  const parts = chicagoParts(capturedAt);
  return parts ? `${parts.year}-${parts.month}-${parts.day}T${parts.hour}` : "";
}

async function withMgbaSnapshotLock<T>(work: () => Promise<T>) {
  const previous = mgbaSnapshotQueue;
  let release: () => void = () => {};
  mgbaSnapshotQueue = new Promise(resolve => { release = resolve; });
  await previous;
  try { return await work(); } finally { release(); }
}

export async function createMgbaDswSnapshot(input: MgbaDswSnapshotInput, database: Database = getDb()) {
  return withMgbaSnapshotLock(async () => {
    const prepared = input.routes.map(inputRow => ({ ...inputRow, ...normalizeMgbaDswRoute(inputRow), driverOrder: inputRow.driverOrder ?? 0, statusPackagesState: inputRow.statusPackagesState || (inputRow.allStatusCodePkgs && inputRow.allStatusCodePkgs > 0 ? "failed" : "not_applicable"), statusPackages: inputRow.statusPackages || [] }));
    const [newest] = await database.select().from(mgbaDswSnapshots)
      .where(eq(mgbaDswSnapshots.operationalDate, input.operationalDate)).orderBy(desc(mgbaDswSnapshots.capturedAt), desc(mgbaDswSnapshots.id)).limit(1);
    if (newest) {
      const existingRows = await getMgbaDswRouteRows(newest.id, database);
      if (mgbaDswRoutesAreIdentical(prepared, existingRows)) {
        const existingPackages = await Promise.all(existingRows.map(row => getMgbaDswStatusPackagesForRouteRow(row.id, database)));
        const identicalPackages = prepared.every((row, index) => row.statusPackagesState === existingRows[index]?.statusPackagesState && JSON.stringify(comparablePackages(row.statusPackages)) === JSON.stringify(comparablePackages(existingPackages[index]?.packages || [])));
        if (identicalPackages) return { ...newest, created: false, deduplicated: true };
      }
    }
    const resolvedRoutes = await Promise.all(prepared.map(async row => ({ row, route: row.routeNumber ? await ensureRoute(row.routeNumber, database) : null })));
    return database.transaction(async transaction => {
      const [snapshot] = await transaction.insert(mgbaDswSnapshots).values({
        operationalDate: input.operationalDate, dswDate: input.dswDate, capturedAt: input.capturedAt, source: input.source, routeCount: prepared.length,
      }).returning();
      if (resolvedRoutes.length) {
        const insertedRows = await transaction.insert(mgbaDswRouteRows).values(resolvedRoutes.map(({ row, route }) => ({ ...row, statusPackages: undefined, snapshotId: snapshot.id, routeId: route?.id || null }))).returning({ id: mgbaDswRouteRows.id });
        const packages = insertedRows.flatMap((inserted, index) => (resolvedRoutes[index].row.statusPackages || []).map(statusPackage => ({ ...statusPackage, routeRowId: inserted.id })));
        if (packages.length) await transaction.insert(mgbaDswStatusPackages).values(packages);
      }
      return { ...snapshot, created: true, deduplicated: false };
    });
  });
}

export async function listMgbaDswOperationalDates(database: Database = getDb()) {
  return database.select({ operationalDate: mgbaDswSnapshots.operationalDate, snapshotCount: sql<number>`COUNT(*)`, latestCapturedAt: sql<string>`MAX(${mgbaDswSnapshots.capturedAt})` })
    .from(mgbaDswSnapshots).groupBy(mgbaDswSnapshots.operationalDate).orderBy(desc(mgbaDswSnapshots.operationalDate));
}
export async function getMgbaDswSnapshotsForDate(operationalDate: string, database: Database = getDb(), now: Date = new Date()) {
  const snapshots = await database.select().from(mgbaDswSnapshots).where(eq(mgbaDswSnapshots.operationalDate, operationalDate)).orderBy(desc(mgbaDswSnapshots.capturedAt), desc(mgbaDswSnapshots.id));
  if (operationalDate === chicagoCalendarDate(now)) return snapshots;

  const seenHours = new Set<string>();
  return snapshots.filter(snapshot => {
    const hour = chicagoHourKey(snapshot.capturedAt);
    if (!hour || seenHours.has(hour)) return false;
    seenHours.add(hour);
    return true;
  });
}
export async function getMgbaDswDateNavigation(operationalDate: string, database: Database = getDb()) {
  const dates = (await listMgbaDswOperationalDates(database)).map(item => item.operationalDate).sort();
  return { previousDate: dates.filter(date => date < operationalDate).at(-1) || null, nextDate: dates.find(date => date > operationalDate) || null, latestDate: dates.at(-1) || null };
}
function dialablePhone(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length === 10 ? digits : null;
}

export async function getMgbaDswRouteRows(snapshotId: number, database: Database = getDb(), includeDriverPhones = false) {
  const rows = await database.select({ id: mgbaDswRouteRows.id, snapshotId: mgbaDswRouteRows.snapshotId, routeId: mgbaDswRouteRows.routeId, registeredRouteNumber: routes.routeNumber,
    serviceArea: mgbaDswRouteRows.serviceArea, waName: mgbaDswRouteRows.waName, vehicleNumber: mgbaDswRouteRows.vehicleNumber, driverName: mgbaDswRouteRows.driverName,
    routeNumber: mgbaDswRouteRows.routeNumber, rawRoute: mgbaDswRouteRows.rawRoute, dst: mgbaDswRouteRows.dst, vscanPkgs: mgbaDswRouteRows.vscanPkgs,
    delStops: mgbaDswRouteRows.delStops, puStops: mgbaDswRouteRows.puStops, diff: mgbaDswRouteRows.diff, actDelStops: mgbaDswRouteRows.actDelStops,
    actDelPkgs: mgbaDswRouteRows.actDelPkgs, actPuStops: mgbaDswRouteRows.actPuStops, actPuPkgs: mgbaDswRouteRows.actPuPkgs,
    ilsPercent: mgbaDswRouteRows.ilsPercent, nextAvailOnDuty: mgbaDswRouteRows.nextAvailOnDuty, allStatusCodePkgs: mgbaDswRouteRows.allStatusCodePkgs, driverOrder: mgbaDswRouteRows.driverOrder, statusPackagesState: mgbaDswRouteRows.statusPackagesState,
  }).from(mgbaDswRouteRows).leftJoin(routes, eq(mgbaDswRouteRows.routeId, routes.id)).where(eq(mgbaDswRouteRows.snapshotId, snapshotId)).orderBy(asc(mgbaDswRouteRows.driverOrder), asc(mgbaDswRouteRows.id));
  if (!includeDriverPhones) return rows.map(row => ({ ...row, driverPhone: null }));
  const roster = await database.select({ dswDriverName: teamMembers.dswDriverName, phoneNumber: teamMembers.phoneNumber }).from(teamMembers);
  const phoneByDswDriverName = new Map(roster.flatMap(member => {
    const phone = dialablePhone(member.phoneNumber);
    return member.dswDriverName && phone ? [[member.dswDriverName, phone] as const] : [];
  }));
  return rows.map(row => ({ ...row, driverPhone: phoneByDswDriverName.get(row.driverName) || null }));
}
export async function getMgbaDswSnapshotById(snapshotId: number, database: Database = getDb(), now: Date = new Date()) {
  const [snapshot] = await database.select().from(mgbaDswSnapshots).where(eq(mgbaDswSnapshots.id, snapshotId)).limit(1);
  return snapshot ? { snapshot, rows: await getMgbaDswRouteRows(snapshot.id, database, snapshot.operationalDate === chicagoCalendarDate(now)) } : null;
}

export async function getMgbaDswStatusPackagesForRouteRow(routeRowId: number, database: Database = getDb()) {
  const [routeRow] = await database.select({ id: mgbaDswRouteRows.id, snapshotId: mgbaDswRouteRows.snapshotId, routeNumber: mgbaDswRouteRows.routeNumber, rawRoute: mgbaDswRouteRows.rawRoute, driverName: mgbaDswRouteRows.driverName, allStatusCodePkgs: mgbaDswRouteRows.allStatusCodePkgs, statusPackagesState: mgbaDswRouteRows.statusPackagesState, capturedAt: mgbaDswSnapshots.capturedAt })
    .from(mgbaDswRouteRows).innerJoin(mgbaDswSnapshots, eq(mgbaDswRouteRows.snapshotId, mgbaDswSnapshots.id)).where(eq(mgbaDswRouteRows.id, routeRowId)).limit(1);
  if (!routeRow) return null;
  const packages = await database.select().from(mgbaDswStatusPackages).where(eq(mgbaDswStatusPackages.routeRowId, routeRowId)).orderBy(mgbaDswStatusPackages.packageNumber, mgbaDswStatusPackages.id);
  return { routeRow, packages };
}
