import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createClient } from "@libsql/client";
import { parseHomebaseAssignment } from "../services/integrations/homebase-assignment";
import { calculateDroMetrics } from "../services/integrations/dro-calculations";
import { compareDroRouteNumbers, getNextDroSort, parseDroSortParams } from "../app/dro/sorting";
import { buildDroCalendarMonth, isDroDateAvailable, shiftDroCalendarMonth } from "../app/dro/calendar";
import { DRO_OVERVIEW_LINKS } from "../app/overview/dro-links";

const projectRoot = new URL("../", import.meta.url);

function runMigration(databaseUrl: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/migrate.mjs"], {
      cwd: projectRoot,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", code => code === 0 ? resolve() : reject(new Error(`Migration exited ${code}`)));
  });
}

test("Homebase assignment parser identifies routes and special work", () => {
  assert.deepEqual(parseHomebaseAssignment("614 CITY"), { routeNumber: "614", assignmentType: "route", specialType: null });
  assert.deepEqual(parseHomebaseAssignment("STRAIGHT TRUCK 1127"), { routeNumber: "1127", assignmentType: "route", specialType: null });
  for (const special of ["BC", "TRAINING", "MISSED", "MISC TASK"]) {
    const parsed = parseHomebaseAssignment(special);
    assert.equal(parsed.routeNumber, null);
    assert.equal(parsed.assignmentType, "special");
    assert.equal(parsed.specialType, special);
  }
  assert.deepEqual(parseHomebaseAssignment("JUMPER"), { routeNumber: null, assignmentType: "other", specialType: null });
});

test("DRO totals and the exact 600-capacity warning rule are deterministic", () => {
  const atThreshold = calculateDroMetrics({
    deliveryCube: 200, pickupCube: 75, combinationCube: 25, vehicleCapacity: 600,
    deliveryPackages: 10, pickupPackages: 2, combinationPackages: 3,
    deliveryStops: 8, pickupStops: 1, combinationStops: 2,
  });
  assert.equal(atThreshold.usedCapacity, 300);
  assert.equal(atThreshold.totalPackages, 15);
  assert.equal(atThreshold.totalStops, 11);
  assert.equal(atThreshold.warning, false);
  assert.equal(calculateDroMetrics({ deliveryCube: 301, vehicleCapacity: 600 }).warning, true);
  assert.equal(calculateDroMetrics({ deliveryCube: 419, vehicleCapacity: 420 }).warning, false);
  assert.equal(calculateDroMetrics({ deliveryCube: 700, vehicleCapacity: 998 }).warning, false);
});

test("DRO overview links and URL sorting preserve the requested ordering", () => {
  assert.deepEqual(DRO_OVERVIEW_LINKS, {
    routes: "/dro?sort=route&direction=asc",
    packages: "/dro?sort=packages&direction=desc",
    stops: "/dro?sort=stops&direction=desc",
    capacityWarnings: "/dro?sort=cube&direction=desc",
  });
  assert.deepEqual(parseDroSortParams(new URLSearchParams("sort=packages&direction=desc")), { key: "packages", direction: "desc" });
  assert.deepEqual(parseDroSortParams(new URLSearchParams("sort=cube&direction=desc")), { key: "capacity", direction: "desc" });
  assert.deepEqual(parseDroSortParams(new URLSearchParams("sort=invalid&direction=desc")), { key: "route", direction: "asc" });
  assert.deepEqual(getNextDroSort({ key: "route", direction: "asc" }, "packages"), { key: "packages", direction: "desc" });
  assert.deepEqual(getNextDroSort({ key: "packages", direction: "desc" }, "packages"), { key: "packages", direction: "asc" });
  assert.deepEqual(getNextDroSort({ key: "packages", direction: "asc" }, "stops"), { key: "stops", direction: "desc" });
  assert.deepEqual(getNextDroSort({ key: "stops", direction: "desc" }, "capacity"), { key: "capacity", direction: "desc" });
  assert.deepEqual(getNextDroSort({ key: "capacity", direction: "desc" }, "route"), { key: "route", direction: "asc" });

  const routes = ["1127", "617", "645", "621", "9804"];
  assert.deepEqual([...routes].sort((left, right) => compareDroRouteNumbers(left, right, "asc")), ["617", "621", "645", "1127", "9804"]);
  assert.deepEqual([...routes].sort((left, right) => compareDroRouteNumbers(left, right, "desc")), ["645", "621", "617", "9804", "1127"]);
});

test("DRO calendar enables only available dates and navigates months safely", () => {
  const availableDates = ["2026-08-28", "2026-08-31", "2026-09-02"];
  const august = buildDroCalendarMonth("2026-08", availableDates, "2026-08-28");
  const day28 = august.days.find(day => day?.date === "2026-08-28");
  const day29 = august.days.find(day => day?.date === "2026-08-29");
  assert.equal(day28?.available, true);
  assert.equal(day28?.selected, true);
  assert.equal(day29?.available, false);
  assert.equal(day29?.selected, false);
  assert.equal(isDroDateAvailable("2026-08-31", availableDates), true);
  assert.equal(isDroDateAvailable("2026-08-30", availableDates), false, "An unavailable day cannot be selected");
  assert.equal(shiftDroCalendarMonth("2026-08", 1), "2026-09");
  assert.equal(shiftDroCalendarMonth("2026-01", -1), "2025-12");
  const emptyMonth = buildDroCalendarMonth("2026-10", [], "");
  assert.equal(emptyMonth.days.filter(Boolean).every(day => day?.available === false), true);
});

test("Homebase upserts by shift ID and DRO imports retain historical snapshots", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "kvc-integrations-"));
  const databasePath = path.join(temporaryDirectory, "fleet.db");
  const databaseUrl = `file:${databasePath.replaceAll("\\", "/")}`;
  process.env.DATABASE_URL = databaseUrl;

  try {
    await runMigration(databaseUrl);
    const { upsertHomebaseShift, upsertHomebaseUserMapping, upsertHomebaseJobMapping } = await import("../services/integrations/homebase");
    const {
      createDroSnapshot,
      getDroDateNavigation,
      getDroSnapshotById,
      getDroSnapshotsForDate,
      getLatestDroSnapshot,
      getLatestSuccessfulDroSummary,
      listDroOperationalDates,
    } = await import("../services/integrations/dro");
    const { closeDb } = await import("../db/index");

    const client = createClient({ url: databaseUrl });
    const admin = await client.execute("SELECT id FROM team_members WHERE email = 'admin@admin.com'");
    const adminTeamMemberId = Number(admin.rows[0].id);
    await upsertHomebaseUserMapping({ userId: "user-20", teamMemberId: adminTeamMemberId, displayName: "Lincoln Barker" });
    await upsertHomebaseJobMapping({ jobId: "job-30", routeNumber: "614", displayName: "City route", assignmentType: "route" });

    const shift = {
      shiftId: "shift-100",
      userId: "user-20",
      jobId: "job-30",
      employeeDisplayName: "Lincoln Barker",
      scheduleDate: "2026-08-29",
      startTimestamp: "2026-08-29T08:00:00-05:00",
      endTimestamp: "2026-08-29T17:00:00-05:00",
      roleName: "614 CITY",
      note: "First import",
      publishedStatus: "published",
    };
    await upsertHomebaseShift(shift);
    await upsertHomebaseShift({ ...shift, roleName: "617 CRESTWOOD", note: "Updated assignment" });

    const shifts = await client.execute("SELECT raw_assignment, raw_note, team_member_id FROM homebase_shifts WHERE homebase_shift_id = 'shift-100'");
    assert.equal(shifts.rows.length, 1);
    assert.equal(shifts.rows[0].raw_assignment, "617 CRESTWOOD");
    assert.equal(shifts.rows[0].raw_note, "Updated assignment");
    assert.equal(Number(shifts.rows[0].team_member_id), adminTeamMemberId);

    const previousDaySnapshot = await createDroSnapshot({
      operationalDate: "2026-08-28", capturedAt: "2026-08-28T01:00:00Z", stationId: "KVC", serviceAreaId: "STL", status: "complete",
      rows: [{ routeNumber: "614", rawWaNumber: "WA-PREV", deliveryCube: 250, vehicleCapacity: 600 }],
    });
    const firstSnapshot = await createDroSnapshot({
      operationalDate: "2026-08-29", capturedAt: "2026-08-28T20:00:00Z", stationId: "KVC", serviceAreaId: "STL", status: "complete",
      rows: [{ routeNumber: "617", rawWaNumber: "WA-1", deliveryCube: 301, vehicleCapacity: 600 }],
    });
    const secondSnapshot = await createDroSnapshot({
      operationalDate: "2026-08-29", capturedAt: "2026-08-28T21:00:00Z", stationId: "KVC", serviceAreaId: "STL", status: "complete",
      rows: [{ routeNumber: "617", rawWaNumber: "WA-1", deliveryCube: 300, vehicleCapacity: 600 }],
    });
    const newestDaySnapshot = await createDroSnapshot({
      operationalDate: "2026-08-31", capturedAt: "2026-08-31T01:00:00Z", stationId: "KVC", serviceAreaId: "STL", status: "complete",
      rows: [{ routeNumber: "621", rawWaNumber: "WA-NEXT", deliveryCube: 700, vehicleCapacity: 998, deliveryPackages: 10, pickupPackages: 2, combinationPackages: 3, deliveryStops: 8, pickupStops: 1, combinationStops: 2 }],
    });
    const snapshots = await client.execute("SELECT COUNT(*) AS count FROM dro_snapshots WHERE operational_date = '2026-08-29'");
    assert.equal(Number(snapshots.rows[0].count), 2);

    const dates = await listDroOperationalDates();
    assert.deepEqual(dates.map(item => item.operationalDate), ["2026-08-31", "2026-08-29", "2026-08-28"]);
    assert.equal(Number(dates.find(item => item.operationalDate === "2026-08-29")?.snapshotCount), 2);

    const dateSnapshots = await getDroSnapshotsForDate("2026-08-29");
    assert.equal(dateSnapshots.length, 2);
    assert.equal(dateSnapshots[0].id, secondSnapshot.id, "A date should default to its newest snapshot");
    assert.equal((await getDroSnapshotsForDate("2026-08-30")).length, 0, "Dates without snapshots should be empty");

    const selectedSnapshot = await getDroSnapshotById(firstSnapshot.id);
    assert.equal(selectedSnapshot?.snapshot.id, firstSnapshot.id);
    assert.equal(selectedSnapshot?.rows[0].rawWaNumber, "WA-1");
    assert.equal(selectedSnapshot?.rows[0].warning, true);

    assert.deepEqual(await getDroDateNavigation("2026-08-29"), {
      previousDate: "2026-08-28", nextDate: "2026-08-31", latestDate: "2026-08-31",
    });
    assert.deepEqual(await getDroDateNavigation("2026-08-30"), {
      previousDate: "2026-08-29", nextDate: "2026-08-31", latestDate: "2026-08-31",
    });
    assert.equal((await getDroDateNavigation("2026-08-28")).previousDate, null);
    assert.equal(previousDaySnapshot.id > 0, true);

    const latest = await getLatestDroSnapshot();
    assert.equal(latest?.snapshot.id, newestDaySnapshot.id);
    assert.equal(latest?.snapshot.operationalDate, "2026-08-31");
    assert.equal(latest?.rows[0].warning, false);

    await createDroSnapshot({
      operationalDate: "2026-09-02", capturedAt: "2026-09-02T02:00:00Z", stationId: "KVC", serviceAreaId: "STL", status: "failed",
      rows: [{ routeNumber: "9804", rawWaNumber: "WA-FAILED", deliveryCube: 500, vehicleCapacity: 600, deliveryPackages: 999, deliveryStops: 999 }],
    });
    assert.deepEqual(await getLatestSuccessfulDroSummary(), {
      snapshotId: newestDaySnapshot.id,
      operationalDate: "2026-08-31",
      capturedAt: "2026-08-31T01:00:00Z",
      routeCount: 1,
      totalPackages: 15,
      totalStops: 11,
      capacityWarnings: 0,
    });

    const { getOverviewData } = await import("../services/overview");
    const overview = await getOverviewData();
    const vehicleTotal = await client.execute("SELECT COUNT(*) AS count FROM vehicles");
    const teamTotal = await client.execute("SELECT COUNT(*) AS count FROM team_members");
    const openIssueTotal = await client.execute("SELECT COUNT(*) AS count FROM issues WHERE status = 'open'");
    assert.equal(overview.vehicleCount, Number(vehicleTotal.rows[0].count));
    assert.equal(overview.teamCount, Number(teamTotal.rows[0].count));
    assert.equal(overview.openIssues.length, Number(openIssueTotal.rows[0].count));
    assert.equal(overview.droSummary?.snapshotId, newestDaySnapshot.id);

    process.env.DRO_INGEST_TOKEN = "test-ingest-token";
    const { POST: ingestDroSnapshot } = await import("../app/api/internal/dro/snapshot/route");
    const ingestionPayload = {
      operationalDate: "2026-09-01",
      capturedAt: "2026-09-02T01:00:00.000Z",
      sourceTimestamp: "2026-09-01 8:00 PM",
      stationId: "631",
      serviceAreaId: "2994532",
      status: "success",
      rows: [{
        routeNumber: "625", rawWaNumber: "WA-INGEST", displayWaNumber: "WA INGEST",
        deliveryCube: 10, pickupCube: 20, combinationCube: 30, vehicleCapacity: 600,
        deliveryPackages: 1, pickupPackages: 2, combinationPackages: 3,
        deliveryStops: 4, pickupStops: 5, combinationStops: 6, totalStops: 15,
        routeType: "CITY", routeTime: "08:00", distance: 42.5,
        usedCapacity: 999, totalPackages: 999, warning: true,
      }],
    };
    function ingestionRequest(body: unknown, token?: string) {
      const headers = new Headers({ "Content-Type": "application/json" });
      if (token) headers.set("Authorization", `Bearer ${token}`);
      return new Request("http://localhost/api/internal/dro/snapshot", { method: "POST", headers, body: JSON.stringify(body) });
    }

    assert.equal((await ingestDroSnapshot(ingestionRequest(ingestionPayload))).status, 401, "A missing token must be rejected");
    assert.equal((await ingestDroSnapshot(ingestionRequest(ingestionPayload, "wrong-token"))).status, 401, "A wrong token must be rejected");
    assert.equal((await ingestDroSnapshot(ingestionRequest({ ...ingestionPayload, rows: "invalid" }, "test-ingest-token"))).status, 400, "An invalid payload must be rejected");

    const firstIngestion = await ingestDroSnapshot(ingestionRequest(ingestionPayload, "test-ingest-token"));
    assert.equal(firstIngestion.status, 201);
    const firstIngestionBody = await firstIngestion.json() as { snapshotId: number };
    assert.ok(firstIngestionBody.snapshotId > 0);

    const secondIngestion = await ingestDroSnapshot(ingestionRequest({
      ...ingestionPayload,
      capturedAt: "2026-09-02T01:30:00.000Z",
      rows: [{ ...ingestionPayload.rows[0], rawWaNumber: "WA-INGEST-2" }],
    }, "test-ingest-token"));
    assert.equal(secondIngestion.status, 201);
    const secondIngestionBody = await secondIngestion.json() as { snapshotId: number };
    assert.notEqual(firstIngestionBody.snapshotId, secondIngestionBody.snapshotId, "Every valid post must create a new snapshot");

    const ingestedSnapshots = await client.execute("SELECT COUNT(*) AS count FROM dro_snapshots WHERE operational_date = '2026-09-01'");
    assert.equal(Number(ingestedSnapshots.rows[0].count), 2);
    const calculatedRow = await client.execute({
      sql: "SELECT used_capacity, total_packages, total_stops, warning FROM dro_route_rows WHERE snapshot_id = ?",
      args: [firstIngestionBody.snapshotId],
    });
    assert.equal(Number(calculatedRow.rows[0].used_capacity), 60);
    assert.equal(Number(calculatedRow.rows[0].total_packages), 6);
    assert.equal(Number(calculatedRow.rows[0].total_stops), 15);
    assert.equal(Number(calculatedRow.rows[0].warning), 0);
    await client.close();
    await closeDb();
  } finally {
    delete process.env.DATABASE_URL;
    delete process.env.DRO_INGEST_TOKEN;
    await rm(temporaryDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
