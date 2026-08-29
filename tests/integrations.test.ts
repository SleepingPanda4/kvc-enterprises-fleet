import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createClient } from "@libsql/client";
import { parseHomebaseAssignment } from "../services/integrations/homebase-assignment";
import { calculateDroMetrics } from "../services/integrations/dro-calculations";

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
      rows: [{ routeNumber: "621", rawWaNumber: "WA-NEXT", deliveryCube: 700, vehicleCapacity: 998 }],
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
    await client.close();
    await closeDb();
  } finally {
    delete process.env.DATABASE_URL;
    await rm(temporaryDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
