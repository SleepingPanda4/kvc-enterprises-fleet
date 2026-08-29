import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createClient } from "@libsql/client";
import { parseHomebaseAssignment } from "../services/integrations/homebase-assignment";
import { calculateDroMetrics } from "../services/integrations/dro-calculations";
import { droRoutesAreIdentical, shouldDeduplicateDroSnapshot, type ComparableDroRoute } from "../services/integrations/dro-deduplication";
import { DroCollectorError, requestDroCollection } from "../services/integrations/dro-collector";
import { compareDroRouteNumbers, getNextDroSort, parseDroSortParams } from "../app/dro/sorting";
import { buildDroCalendarMonth, isDroDateAvailable, shiftDroCalendarMonth } from "../app/dro/calendar";
import { LiveDroRefreshGuard, loadCollectedDroView, requestLiveDroRefresh } from "../app/dro/live-refresh";
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

test("DRO deduplication cutoff and route comparison use Chicago time and meaningful fields", () => {
  assert.equal(shouldDeduplicateDroSnapshot("2026-08-30T03:30:00.000Z", "2026-08-29"), false, "10:30 PM remains a normal snapshot");
  assert.equal(shouldDeduplicateDroSnapshot("2026-08-30T04:00:00.000Z", "2026-08-29"), false, "Exactly 11 PM remains a normal snapshot");
  assert.equal(shouldDeduplicateDroSnapshot("2026-08-30T04:00:00.001Z", "2026-08-29"), true, "The cutoff begins immediately after 11 PM");
  assert.equal(shouldDeduplicateDroSnapshot("2026-08-30T04:20:00.000Z", "2026-08-29"), true);
  assert.equal(shouldDeduplicateDroSnapshot("2026-08-30T05:10:00.000Z", "2026-08-29"), true, "The prior operational day continues across midnight");
  assert.equal(shouldDeduplicateDroSnapshot("2026-08-30T14:00:00.000Z", "2026-08-30"), false, "A new operational day uses its normal window");

  const base: ComparableDroRoute = {
    routeNumber: "621", rawWaNumber: "WA-621", displayWaNumber: "WA 621",
    deliveryCube: 100, pickupCube: 20, combinationCube: 5, usedCapacity: 125, vehicleCapacity: 600,
    deliveryPackages: 30, pickupPackages: 4, combinationPackages: 2, totalPackages: 36,
    deliveryStops: 20, pickupStops: 3, combinationStops: 1, totalStops: 24,
    routeType: "CITY", routeTime: "08:15", distance: 42.5, warning: false,
  };
  const second = { ...base, routeNumber: "1127", rawWaNumber: "WA-1127", displayWaNumber: "WA 1127" };
  assert.equal(droRoutesAreIdentical([base, second], [second, base]), true, "Route ordering is ignored");
  assert.equal(droRoutesAreIdentical([base], [{ ...base, routeNumber: " 621 ", routeType: " CITY " }]), true, "Text is normalized");

  const meaningfulFields: Array<keyof ComparableDroRoute> = [
    "routeNumber", "rawWaNumber", "displayWaNumber", "deliveryCube", "pickupCube", "combinationCube", "usedCapacity", "vehicleCapacity",
    "deliveryPackages", "pickupPackages", "combinationPackages", "totalPackages", "deliveryStops", "pickupStops", "combinationStops", "totalStops",
    "routeType", "routeTime", "distance", "warning",
  ];
  for (const field of meaningfulFields) {
    const changed = { ...base };
    const current = changed[field];
    (changed as Record<keyof ComparableDroRoute, unknown>)[field] = typeof current === "number" ? current + 1 : typeof current === "boolean" ? !current : `${current}-changed`;
    assert.equal(droRoutesAreIdentical([base], [changed]), false, `${field} must be part of the comparison`);
  }
});

test("Fleet Manager collector client keeps authorization server-side and returns safe errors", async () => {
  const previousToken = process.env.DRO_INGEST_TOKEN;
  process.env.DRO_INGEST_TOKEN = "server-only-test-token";
  try {
    let calledUrl = "";
    const success = await requestDroCollection({ fetchImplementation: async (input, init) => {
      calledUrl = String(input);
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer server-only-test-token");
      return Response.json({ ok: true, snapshotId: 77, operationalDate: "2026-08-29", capturedAt: "2026-08-30T04:20:00.000Z", created: false, deduplicated: true });
    } });
    assert.equal(calledUrl, "http://127.0.0.1:3101/collect");
    assert.deepEqual(success, { ok: true, snapshotId: 77, operationalDate: "2026-08-29", capturedAt: "2026-08-30T04:20:00.000Z", created: false, deduplicated: true });
    assert.equal(JSON.stringify(success).includes("server-only-test-token"), false);

    await assert.rejects(
      requestDroCollection({ fetchImplementation: async () => Response.json({ ok: false, error: "collection_in_progress" }, { status: 409 }) }),
      (error: unknown) => error instanceof DroCollectorError && error.code === "DRO_COLLECTION_IN_PROGRESS" && error.status === 409,
    );
    await assert.rejects(
      requestDroCollection({ fetchImplementation: async () => Response.json({ ok: false, error: "ingestion_failed" }, { status: 502 }) }),
      (error: unknown) => error instanceof DroCollectorError && error.code === "DRO_INGESTION_FAILED",
    );
    await assert.rejects(
      requestDroCollection({ fetchImplementation: async () => { throw new TypeError("connection refused"); } }),
      (error: unknown) => error instanceof DroCollectorError && error.code === "DRO_COLLECTOR_UNAVAILABLE" && !error.message.includes("refused"),
    );
    await assert.rejects(
      requestDroCollection({
        timeoutMs: 5,
        fetchImplementation: async (_input, init) => new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        }),
      }),
      (error: unknown) => error instanceof DroCollectorError && error.code === "DRO_COLLECTION_TIMEOUT",
    );
  } finally {
    if (previousToken === undefined) delete process.env.DRO_INGEST_TOKEN;
    else process.env.DRO_INGEST_TOKEN = previousToken;
  }
});

test("Live DRO frontend helpers prevent duplicate requests and select the returned date and exact snapshot", async () => {
  let refreshCalls = 0;
  const refreshResult = await requestLiveDroRefresh(async input => {
    refreshCalls += 1;
    assert.equal(input, "/api/dro/refresh");
    return Response.json({ ok: true, snapshotId: 91, operationalDate: "2026-08-29", capturedAt: "2026-08-30T04:30:00.000Z", created: false, deduplicated: true });
  });
  assert.equal(refreshCalls, 1);

  const requestedUrls: string[] = [];
  const view = await loadCollectedDroView(refreshResult, async <T>(url: string) => {
    requestedUrls.push(url);
    if (url === "/api/dro/dates") return { latestDate: "2026-08-29", dates: [] } as T;
    if (url.startsWith("/api/dro/date")) return { operationalDate: "2026-08-29", snapshots: [{ id: 91 }] } as T;
    return { snapshot: { id: 91 }, rows: [] } as T;
  });
  assert.equal(view.selectedDate, "2026-08-29", "Historical views move to the returned live operational date");
  assert.equal(view.selectedSnapshotId, 91, "The collector snapshot ID is authoritative");
  assert.deepEqual(requestedUrls, ["/api/dro/dates", "/api/dro/date?date=2026-08-29", "/api/dro/snapshot?id=91"]);

  const guard = new LiveDroRefreshGuard();
  let releaseFirst = () => {};
  let guardedCalls = 0;
  const first = guard.run(async () => {
    guardedCalls += 1;
    await new Promise<void>(resolve => { releaseFirst = resolve; });
    return "complete";
  });
  assert.equal(guard.isActive, true);
  assert.equal(await guard.run(async () => { guardedCalls += 1; return "duplicate"; }), undefined);
  assert.equal(guardedCalls, 1, "A second frontend collection request is not started");
  releaseFirst();
  assert.equal(await first, "complete");
  assert.equal(guard.isActive, false);
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
    const firstIngestionBody = await firstIngestion.json() as { snapshotId: number; created: boolean; deduplicated: boolean };
    assert.ok(firstIngestionBody.snapshotId > 0);
    assert.deepEqual({ created: firstIngestionBody.created, deduplicated: firstIngestionBody.deduplicated }, { created: true, deduplicated: false });

    const secondIngestion = await ingestDroSnapshot(ingestionRequest({
      ...ingestionPayload,
      capturedAt: "2026-09-02T01:30:00.000Z",
      rows: [{ ...ingestionPayload.rows[0], rawWaNumber: "WA-INGEST-2" }],
    }, "test-ingest-token"));
    assert.equal(secondIngestion.status, 201);
    const secondIngestionBody = await secondIngestion.json() as { snapshotId: number; created: boolean; deduplicated: boolean };
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

    const richRows = [
      {
        routeNumber: "621", rawWaNumber: "WA-LATE-621", displayWaNumber: "WA LATE 621",
        deliveryCube: 100, pickupCube: 20, combinationCube: 5, vehicleCapacity: 600,
        deliveryPackages: 30, pickupPackages: 4, combinationPackages: 2,
        deliveryStops: 20, pickupStops: 3, combinationStops: 1,
        routeType: "CITY", routeTime: "08:15", distance: 42.5,
      },
      {
        routeNumber: "1127", rawWaNumber: "WA-LATE-1127", displayWaNumber: "WA LATE 1127",
        deliveryCube: 200, pickupCube: 10, combinationCube: 7, vehicleCapacity: 998,
        deliveryPackages: 40, pickupPackages: 3, combinationPackages: 1,
        deliveryStops: 25, pickupStops: 2, combinationStops: 1,
        routeType: "STRAIGHT TRUCK", routeTime: "09:00", distance: 65,
      },
    ];
    const lateInput = (capturedAt: string, rows = richRows, sourceTimestamp = "DRO report A") => ({
      operationalDate: "2026-09-03", capturedAt, sourceTimestamp, stationId: "631", serviceAreaId: "2994532", status: "success", rows,
    });

    const normalDuplicateOne = await createDroSnapshot(lateInput("2026-09-04T03:30:00.000Z"));
    const normalDuplicateTwo = await createDroSnapshot(lateInput("2026-09-04T03:45:00.000Z"));
    assert.notEqual(normalDuplicateOne.id, normalDuplicateTwo.id, "Identical snapshots before 11 PM are retained");
    const exactlyEleven = await createDroSnapshot(lateInput("2026-09-04T04:00:00.000Z"));
    assert.equal(exactlyEleven.created, true, "Exactly 11:00 PM is retained");

    const rowCountAtCutoff = await client.execute({ sql: "SELECT COUNT(*) AS count FROM dro_route_rows WHERE snapshot_id = ?", args: [exactlyEleven.id] });
    const lateDuplicate = await createDroSnapshot(lateInput("2026-09-04T04:20:00.000Z", [...richRows].reverse(), "A naturally different report timestamp"));
    assert.equal(lateDuplicate.id, exactlyEleven.id, "An after-11 duplicate returns the existing snapshot ID");
    assert.deepEqual({ created: lateDuplicate.created, deduplicated: lateDuplicate.deduplicated }, { created: false, deduplicated: true });
    const rowCountAfterDuplicate = await client.execute({ sql: "SELECT COUNT(*) AS count FROM dro_route_rows WHERE snapshot_id = ?", args: [exactlyEleven.id] });
    assert.equal(Number(rowCountAfterDuplicate.rows[0].count), Number(rowCountAtCutoff.rows[0].count), "A duplicate does not insert route rows");

    const capacityChangedRows = richRows.map((row, index) => index === 0 ? { ...row, vehicleCapacity: 420 } : row);
    const changedLate = await createDroSnapshot(lateInput("2026-09-04T04:30:00.000Z", capacityChangedRows));
    assert.notEqual(changedLate.id, exactlyEleven.id);
    assert.deepEqual({ created: changedLate.created, deduplicated: changedLate.deduplicated }, { created: true, deduplicated: false });

    const orderOnlyDuplicate = await createDroSnapshot(lateInput("2026-09-04T04:40:00.000Z", [...capacityChangedRows].reverse(), "DRO report B"));
    assert.equal(orderOnlyDuplicate.id, changedLate.id, "Ordering and snapshot metadata do not create a late duplicate");
    const midnightDuplicate = await createDroSnapshot(lateInput("2026-09-04T05:10:00.000Z", capacityChangedRows, "DRO report after midnight"));
    assert.equal(midnightDuplicate.id, changedLate.id, "Deduplication continues across midnight for the prior operational date");

    const afterMidnightChangedRows = capacityChangedRows.map((row, index) => index === 1 ? { ...row, routeTime: "09:30" } : row);
    const afterMidnightChanged = await createDroSnapshot(lateInput("2026-09-04T05:20:00.000Z", afterMidnightChangedRows));
    assert.equal(afterMidnightChanged.created, true, "Changed data after midnight creates a snapshot");

    const concurrentChangedRows = afterMidnightChangedRows.map((row, index) => index === 0 ? { ...row, combinationPackages: row.combinationPackages + 1 } : row);
    const concurrentResults = await Promise.all([
      createDroSnapshot(lateInput("2026-09-04T05:30:00.000Z", concurrentChangedRows)),
      createDroSnapshot(lateInput("2026-09-04T05:31:00.000Z", [...concurrentChangedRows].reverse())),
    ]);
    assert.equal(concurrentResults[0].id, concurrentResults[1].id, "Equivalent concurrent late ingestions resolve to one authoritative snapshot");
    assert.equal(concurrentResults.filter(result => result.created).length, 1);
    assert.equal(concurrentResults.filter(result => result.deduplicated).length, 1);

    const lateSnapshotCount = await client.execute("SELECT COUNT(*) AS count FROM dro_snapshots WHERE operational_date = '2026-09-03'");
    assert.equal(Number(lateSnapshotCount.rows[0].count), 6);
    const immutableCutoff = await client.execute({ sql: "SELECT captured_at FROM dro_snapshots WHERE id = ?", args: [exactlyEleven.id] });
    assert.equal(immutableCutoff.rows[0].captured_at, "2026-09-04T04:00:00.000Z", "Deduplication never rewrites the existing snapshot");

    const managerSessionToken = "manager-live-refresh-session";
    const { hashToken } = await import("../app/auth/server");
    const managerUser = await client.execute("SELECT id FROM users WHERE email = 'admin@admin.com'");
    assert.equal(managerUser.rows.length, 1);
    await client.execute({
      sql: "INSERT INTO auth_sessions (token_hash, user_id) VALUES (?, ?)",
      args: [hashToken(managerSessionToken), Number(managerUser.rows[0].id)],
    });
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async (input, init) => {
        assert.equal(String(input), "http://127.0.0.1:3101/collect");
        assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-ingest-token");
        return Response.json({
          ok: true, snapshotId: changedLate.id, operationalDate: "2026-09-03", capturedAt: "2026-09-04T04:30:00.000Z", created: false, deduplicated: true,
        });
      };
      const { POST: refreshDro } = await import("../app/api/dro/refresh/route");
      const refreshResponse = await refreshDro(new Request("http://localhost/api/dro/refresh", {
        method: "POST", headers: { Cookie: `kvc_session=${managerSessionToken}` },
      }));
      assert.equal(refreshResponse.status, 200);
      const refreshBody = await refreshResponse.json() as Record<string, unknown>;
      assert.equal(refreshBody.snapshotId, changedLate.id);
      assert.equal(refreshBody.operationalDate, "2026-09-03");
      assert.equal(refreshBody.deduplicated, true);
      assert.equal(JSON.stringify(refreshBody).includes("test-ingest-token"), false, "The browser response never contains the bearer token");
    } finally {
      globalThis.fetch = originalFetch;
    }
    await client.close();
    await closeDb();
  } finally {
    delete process.env.DATABASE_URL;
    delete process.env.DRO_INGEST_TOKEN;
    await rm(temporaryDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
