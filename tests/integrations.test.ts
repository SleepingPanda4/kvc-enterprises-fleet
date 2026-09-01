import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { mock } from "node:test";
import { createClient } from "@libsql/client";
import { parseHomebaseAssignment } from "../services/integrations/homebase-assignment";
import { calculateDroMetrics, capacityUtilization, hasCapacityWarning } from "../services/integrations/dro-calculations";
import { droRoutesAreIdentical, shouldDeduplicateDroSnapshot, type ComparableDroRoute } from "../services/integrations/dro-deduplication";
import { DroCollectorError, requestDroCollection } from "../services/integrations/dro-collector";
import { DRO_REFRESH_WINDOW_MESSAGE, isDroManualRefreshAllowed, operationalDateForDroCapture } from "../services/integrations/dro-operational-date";
import { DroRefreshWindowError, requestManualDroCollection } from "../services/integrations/dro-refresh-window";
import { HomebaseCollectorError, requestHomebaseCollection } from "../services/integrations/homebase-collector";
import { compareDroRouteNumbers, getNextDroSort, parseDroSortParams } from "../app/dro/sorting";
import { buildDroCalendarMonth, isDroDateAvailable, shiftDroCalendarMonth } from "../app/dro/calendar";
import { LiveDroRefreshGuard, loadCollectedDroView, requestLiveDroRefresh } from "../app/dro/live-refresh";
import { refetchHomebaseAssignments } from "../app/dro/homebase-refresh";
import { selectedDroSnapshot, selectedSnapshotTimestamp } from "../app/dro/selected-snapshot";
import { DRO_OVERVIEW_LINKS } from "../app/overview/dro-links";
import { clearDroRouteSelection, selectDroRouteRow, selectedDroRouteRowId } from "../app/dro/row-selection";
import { mgbaDswRoutesAreIdentical } from "../services/integrations/mgba-dsw-deduplication";
import { normalizeMgbaDswRoute, normalizeMgbaRouteNumber } from "../services/integrations/mgba-dsw-normalization";
import { MgbaCollectorError, requestMgbaCollection } from "../services/integrations/mgba-collector";
import { compareMonitorRouteNumbers, DEFAULT_MONITOR_SORT, MONITOR_SORT_KEYS, compareNullable, nextMonitorSort } from "../app/monitor/sorting";
import { monitorBackHref, statusPackagesHref, stopStatusPackageLinkPropagation } from "../app/monitor/status-packages/navigation";
import { filterMonitorMobileRows, monitorDriverDisplayName, monitorExpectedProgress, monitorLoggedOutOverlayTime, monitorLoggedOutTime, monitorLogoutSortValue, monitorMobileCallHref, monitorMobilePaceColor, monitorStopProgress, monitorStopsLeft, sortMonitorMobileRows } from "../app/monitor/mobile";
import { MAX_RESOLUTION_NOTES_LENGTH, normalizeResolutionNotes } from "../services/issue-resolution";
import { MAX_ISSUE_ATTACHMENT_BYTES, validateIssueAttachmentFiles } from "../services/issue-attachment-validation";

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
  for (const special of ["BC", "TBD ROUTE", "ON CALL AT HOME", "TRAINING", "MISSED", "MISC TASK"]) {
    const parsed = parseHomebaseAssignment(special);
    assert.equal(parsed.routeNumber, null);
    assert.equal(parsed.assignmentType, "special");
    assert.equal(parsed.specialType, special);
  }
  assert.deepEqual(parseHomebaseAssignment("JUMPER"), { routeNumber: null, assignmentType: "other", specialType: null });
});

test("DRO totals and capacity warnings use the actual vehicle capacity", () => {
  const atThreshold = calculateDroMetrics({
    deliveryCube: 200, pickupCube: 75, combinationCube: 25, vehicleCapacity: 600,
    deliveryPackages: 10, pickupPackages: 2, combinationPackages: 3,
    deliveryStops: 8, pickupStops: 1, combinationStops: 2,
  });
  assert.equal(atThreshold.usedCapacity, 300);
  assert.equal(atThreshold.totalPackages, 15);
  assert.equal(atThreshold.totalStops, 11);
  assert.equal(atThreshold.warning, true, "50% is a warning");
  assert.equal(calculateDroMetrics({ deliveryCube: 299, vehicleCapacity: 600 }).warning, false);
  assert.equal(calculateDroMetrics({ deliveryCube: 210, vehicleCapacity: 420 }).warning, true);
  assert.equal(calculateDroMetrics({ deliveryCube: 419, vehicleCapacity: 420 }).warning, true);
  assert.equal(calculateDroMetrics({ deliveryCube: 499, vehicleCapacity: 998 }).warning, true);
  assert.equal(calculateDroMetrics({ deliveryCube: 498, vehicleCapacity: 998 }).warning, false);
  assert.equal(capacityUtilization(420, 420), 1);
  assert.equal(capacityUtilization(1, 0), null);
  assert.equal(hasCapacityWarning(0, 0), false);
});

test("Issue resolution notes require meaningful text and retain safe trimmed content", () => {
  assert.equal(normalizeResolutionNotes(undefined), null);
  assert.equal(normalizeResolutionNotes("   \n  "), null);
  assert.equal(normalizeResolutionNotes("  Replaced the worn tire.  "), "Replaced the worn tire.");
  assert.equal(normalizeResolutionNotes("x".repeat(MAX_RESOLUTION_NOTES_LENGTH + 1)), null);
});

test("Issue attachment validation accepts supported media and rejects unsafe uploads", () => {
  assert.equal(validateIssueAttachmentFiles([new File(["photo"], "repair.jpg", { type: "image/jpeg" })]), null);
  assert.equal(validateIssueAttachmentFiles([new File(["video"], "walkaround.mp4", { type: "video/mp4" })]), null);
  assert.match(validateIssueAttachmentFiles([new File(["text"], "not-media.txt", { type: "text/plain" })]) || "", /not a supported/);
  assert.match(validateIssueAttachmentFiles([new File([new Uint8Array(MAX_ISSUE_ATTACHMENT_BYTES + 1)], "large.jpg", { type: "image/jpeg" })]) || "", /25 MB/);
});

test("MGBA DSW normalization, deduplication, sorting, and worker errors preserve source meaning", async () => {
  const source = { serviceArea: null, waName: "  UNKNOWN AREA ", vehicleNumber: "415659 431928", driverName: " Driver One ", routeNumber: "000621", rawRoute: "000621", dst: null,
    vscanPkgs: 0, delStops: 12, puStops: null, diff: 0, actDelStops: 10, actDelPkgs: 99, actPuStops: null, actPuPkgs: null, ilsPercent: 97.5, allStatusCodePkgs: 7 };
  const normalized = normalizeMgbaDswRoute(source);
  assert.equal(normalized.routeNumber, "621");
  assert.equal(normalized.vehicleNumber, "415659 431928", "Multiple vehicle IDs remain source text");
  assert.equal(normalized.puStops, null, "Blank source values remain null");
  assert.notEqual(normalized.puStops, normalized.vscanPkgs, "Null is distinct from zero");
  assert.equal(normalizeMgbaRouteNumber("0000"), "0");
  assert.equal(mgbaDswRoutesAreIdentical([normalized], [{ ...normalized, allStatusCodePkgs: 8 }]), false, "Status packages are an independent source field");
  assert.equal(mgbaDswRoutesAreIdentical([normalized, { ...normalized, driverName: "Driver Two" }], [{ ...normalized, driverName: "Driver Two" }, normalized]), true, "Row ordering does not affect deduplication");
  assert.equal(compareNullable(null, 0, "asc"), 1);
  assert.deepEqual(DEFAULT_MONITOR_SORT, { key: "route", direction: "asc" });
  assert.deepEqual(["614", "617", "618", "621", "622", "625", "626", "629", "630", "634", "637", "641", "1127"].sort((left, right) => compareMonitorRouteNumbers(left, right, "desc")), ["1127", "641", "637", "634", "630", "629", "626", "625", "622", "621", "618", "617", "614"], "Monitor route sorting is numeric descending by default");
  assert.deepEqual(["641", "1127"].sort((left, right) => compareMonitorRouteNumbers(left, right, "asc")), ["641", "1127"]);
  assert.deepEqual(nextMonitorSort(DEFAULT_MONITOR_SORT, "route"), { key: "route", direction: "desc" });
  assert.deepEqual(nextMonitorSort({ key: "route", direction: "desc" }, "route"), { key: "route", direction: "asc" });
  assert.deepEqual(["junk", null, "641", "1127"].sort((left, right) => compareMonitorRouteNumbers(left, right, "desc")), ["1127", "641", "junk", null]);
  assert.equal(nextMonitorSort(null, "vscan").direction, "desc");
  assert.equal(MONITOR_SORT_KEYS.includes("vscan"), true);
  assert.equal((MONITOR_SORT_KEYS as readonly string[]).includes("allStatusCodePkgs"), false, "All Status Code Pkgs is intentionally not sortable");
  await assert.rejects(requestMgbaCollection("2026-08-29", { token: "test-worker-token", fetchImplementation: async () => Response.json({ error: "collection_in_progress" }, { status: 409 }) }), error => error instanceof MgbaCollectorError && error.code === "MGBA_COLLECTION_IN_PROGRESS");
  await assert.rejects(requestMgbaCollection("2026-08-29", { token: "test-worker-token", fetchImplementation: async () => { throw new TypeError("offline"); } }), error => error instanceof MgbaCollectorError && error.code === "MGBA_WORKER_UNAVAILABLE");
  let workerUrl = "";
  await requestMgbaCollection("2026-08-29", { token: "test-worker-token", fetchImplementation: async (input, init) => { workerUrl = String(input); assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-worker-token"); return Response.json({ ok: true, operationalDate: "2026-08-29" }); } });
  assert.match(workerUrl, /date=08%2F29%2F2026$/);
});

test("Monitor status-package links retain the exact persisted row and Monitor context", () => {
  assert.equal(statusPackagesHref(123, "2026-08-29", 7), "/monitor/status-packages/123?date=2026-08-29&snapshot=7");
  assert.equal(statusPackagesHref(456, "2026-08-29", 7), "/monitor/status-packages/456?date=2026-08-29&snapshot=7", "Duplicate route numbers still use distinct route-row IDs");
  assert.equal(statusPackagesHref(123, "2026-08-29", null), "/monitor/status-packages/123?date=2026-08-29");
  assert.equal(monitorBackHref(new URLSearchParams("date=2026-08-29&snapshot=7")), "/monitor?date=2026-08-29&snapshot=7");
  assert.equal(monitorBackHref(new URLSearchParams()), "/monitor");

  let propagationStopped = false;
  let defaultPrevented = false;
  const linkClick = {
    stopPropagation: () => { propagationStopped = true; },
    preventDefault: () => { defaultPrevented = true; },
  };
  stopStatusPackageLinkPropagation(linkClick);
  assert.equal(propagationStopped, true, "Package link clicks do not reach the row-selection handler");
  assert.equal(defaultPrevented, false, "Package link clicks retain native anchor navigation");
});

test("Monitor mobile cards use stop-only completion progress without manufacturing missing data", () => {
  assert.equal(monitorStopProgress(100, 20, 60, 10), 58);
  assert.equal(monitorStopProgress(126, null, 57, null), 45);
  assert.equal(monitorStopProgress(112, null, 50, null), 45);
  assert.equal(monitorStopProgress(144, null, 56, null), 39);
  assert.equal(monitorStopProgress(119, 5, 116, 5), 98);
  assert.equal(monitorStopProgress(100, 10, 105, 10), 100);
  assert.equal(monitorStopProgress(100, 20, 100, 20), 100);
  assert.equal(monitorStopProgress(100, 20, 0, 0), 0);
  assert.equal(monitorStopProgress(null, null, 116, 4), null, "A multi-driver child without planned stops remains unavailable");
  assert.equal(monitorStopsLeft(144, null, 61, null), 83);
  assert.equal(monitorStopsLeft(128, 2, 107, null), 23);
  assert.equal(monitorStopsLeft(119, 5, 116, 5), 3);
  assert.equal(monitorStopsLeft(100, 10, 105, 10), 0, "Stops Left never becomes negative");
  assert.equal(monitorStopsLeft(null, null, 116, 4), null, "A multi-driver child without planned stops has no Stops Left value");
  assert.equal(monitorDriverDisplayName("GALLAGHER,JOSHUA"), "Joshua Gallagher");
  assert.equal(monitorDriverDisplayName("Trapp,Phillip Michael"), "Phillip Michael Trapp");
  assert.equal(monitorDriverDisplayName("Unparseable"), "Unparseable");
});

test("Monitor mobile quick search filters the current mobile order without mutating it", () => {
  const source = [
    { id: 1, driverName: "GALLAGHER,WILLIAM", routeNumber: "621", registeredRouteNumber: null, vehicleNumber: "439198", delStops: 100, puStops: null, actDelStops: 48, actPuStops: null, driverOrder: 0 },
    { id: 2, driverName: "TRAPP,PHILLIP", routeNumber: "614", registeredRouteNumber: null, vehicleNumber: "439201", delStops: 100, puStops: null, actDelStops: 42, actPuStops: null, driverOrder: 0 },
    { id: 3, driverName: "UNAVAILABLE DRIVER", routeNumber: "625", registeredRouteNumber: null, vehicleNumber: "510252", delStops: null, puStops: null, actDelStops: 3, actPuStops: null, driverOrder: 0 },
  ];
  const ordered = sortMonitorMobileRows(source);
  assert.deepEqual(ordered.map(row => row.id), [2, 1, 3]);
  assert.deepEqual(filterMonitorMobileRows(ordered, "439").map(row => row.id), [2, 1], "Search preserves the completion-sorted order among matches");
  assert.deepEqual(filterMonitorMobileRows(ordered, "gallagher").map(row => row.id), [1]);
  assert.deepEqual(filterMonitorMobileRows(ordered, "62").map(row => row.id), [1, 3]);
  assert.deepEqual(filterMonitorMobileRows(ordered, "").map(row => row.id), [2, 1, 3]);
  assert.deepEqual(source.map(row => row.id), [1, 2, 3], "Search and sorting leave source rows intact");
});

test("Monitor mobile ordering keeps active drivers first and orders logged-out rows by real logout chronology", () => {
  const rows = [
    { id: 1, driverName: "Active Later", routeNumber: "625", registeredRouteNumber: null, vehicleNumber: null, nextAvailOnDuty: null, delStops: 100, puStops: null, actDelStops: 50, actPuStops: null, driverOrder: 0 },
    { id: 2, driverName: "Logged Out Previous Afternoon", routeNumber: "634", registeredRouteNumber: null, vehicleNumber: null, nextAvailOnDuty: "01:15", delStops: 100, puStops: null, actDelStops: 1, actPuStops: null, driverOrder: 0 },
    { id: 3, driverName: "Active Early", routeNumber: "621", registeredRouteNumber: null, vehicleNumber: null, nextAvailOnDuty: null, delStops: 100, puStops: null, actDelStops: 20, actPuStops: null, driverOrder: 0 },
    { id: 4, driverName: "Logged Out Same Day", routeNumber: "630", registeredRouteNumber: null, vehicleNumber: null, nextAvailOnDuty: "23:15", delStops: 100, puStops: null, actDelStops: 99, actPuStops: null, driverOrder: 0 },
    { id: 5, driverName: "Invalid Signal Is Active", routeNumber: "622", registeredRouteNumber: null, vehicleNumber: null, nextAvailOnDuty: "not a time", delStops: 100, puStops: null, actDelStops: 30, actPuStops: null, driverOrder: 0 },
    { id: 6, driverName: "Logged Out Previous Evening", routeNumber: "637", registeredRouteNumber: null, vehicleNumber: null, nextAvailOnDuty: "05:15", delStops: 100, puStops: null, actDelStops: 2, actPuStops: null, driverOrder: 0 },
    { id: 7, driverName: "Logged Tie B", routeNumber: "621", registeredRouteNumber: null, vehicleNumber: null, nextAvailOnDuty: "23:15", delStops: 100, puStops: null, actDelStops: 3, actPuStops: null, driverOrder: 2 },
    { id: 8, driverName: "Logged Tie A", routeNumber: "614", registeredRouteNumber: null, vehicleNumber: null, nextAvailOnDuty: "23:15", delStops: 100, puStops: null, actDelStops: 4, actPuStops: null, driverOrder: 1 },
    { id: 9, driverName: "Child Without Signal", routeNumber: "621", registeredRouteNumber: null, vehicleNumber: null, nextAvailOnDuty: null, delStops: null, puStops: null, actDelStops: 50, actPuStops: null, driverOrder: 3 },
  ];
  assert.equal(monitorLogoutSortValue("01:15"), -525, "1:15 AM next availability means a prior-day 3:15 PM logout");
  assert.equal(monitorLogoutSortValue("23:15"), 795, "11:15 PM next availability means a same-day 1:15 PM logout");
  const ordered = sortMonitorMobileRows(rows);
  assert.deepEqual(ordered.map(row => row.id), [3, 5, 1, 9, 8, 7, 4, 6, 2]);
  assert.deepEqual(filterMonitorMobileRows(ordered, "logged").map(row => row.id), [8, 7, 4, 6, 2], "Search retains active/logged-out ordering among matching rows");
  assert.equal(ordered.at(-1)?.id, 2, "The earliest logged-out driver stays at the bottom");
  assert.equal(ordered.find(row => row.id === 9)?.nextAvailOnDuty, null, "A multi-driver child without its own value remains active");
});

test("Monitor mobile pace color uses the persisted snapshot time in America/Chicago", () => {
  const beforeWorkday = "2026-08-30T13:30:00.000Z"; // 8:30 AM CDT
  const tenThirty = "2026-08-30T15:30:00.000Z"; // 10:30 AM CDT
  const afterWorkday = "2026-08-30T23:00:00.000Z"; // 6:00 PM CDT

  assert.equal(monitorExpectedProgress(beforeWorkday), null, "Snapshots before 9 AM do not receive a pace target");
  assert.equal(monitorExpectedProgress(tenThirty), 18.75, "Chicago clock time determines expected completion");
  assert.equal(monitorExpectedProgress(afterWorkday), 100, "Expected completion remains capped after 5 PM");
  assert.equal(monitorMobilePaceColor(50, beforeWorkday), null, "Pre-workday snapshots retain the neutral bar color");
  assert.equal(monitorMobilePaceColor(null, tenThirty), null, "Unavailable progress does not manufacture a pace color");
  assert.equal(monitorMobilePaceColor(100, beforeWorkday), "#087a46", "Completion always overrides pace with green");
  assert.equal(monitorMobilePaceColor(19, tenThirty), "#2c7ec4", "A historical snapshot close to pace is blue");
  assert.equal(monitorMobilePaceColor(0, afterWorkday), "#c7353c", "Routes ninety minutes or more behind are red");
  assert.notEqual(monitorMobilePaceColor(5, tenThirty), monitorMobilePaceColor(10, tenThirty), "Intermediate pace values use smooth color interpolation");
});

test("Monitor logged-out overlay derives only valid persisted Next Avail On Duty source times", () => {
  assert.equal(monitorLoggedOutTime("03:30 AM"), "5:30 PM");
  assert.equal(monitorLoggedOutTime("08/30/2026 03:30:00 AM"), "5:30 PM", "Date-bearing source text preserves its clock meaning");
  assert.equal(monitorLoggedOutTime("23:15"), "1:15 PM", "24-hour source clocks wrap across midnight safely");
  assert.equal(monitorLoggedOutTime(null), null);
  assert.equal(monitorLoggedOutTime("not available"), null);
  assert.equal(monitorStopProgress(100, null, 99, null), 99);
  assert.equal(monitorLoggedOutOverlayTime("03:30 AM"), "5:30 PM", "A valid source value shows the overlay even below 100% completion");
  assert.equal(monitorStopProgress(100, null, 100, null), 100);
  assert.equal(monitorLoggedOutOverlayTime("03:30 AM"), "5:30 PM", "A valid source value also shows the overlay at 100% completion");
  assert.equal(monitorLoggedOutOverlayTime(null), null, "Completion at 100% without a source value does not show the overlay");
  assert.equal(monitorLoggedOutOverlayTime("not available"), null, "Invalid source values do not show the overlay");
  assert.equal(monitorLoggedOutOverlayTime("08/29/2026 03:30 AM"), "5:30 PM", "Historical snapshot source values remain eligible for the mobile overlay");
});

test("Monitor mobile call links are Chicago-today only and retain native phone dialing", () => {
  const chicagoToday = new Date("2026-08-30T05:30:00.000Z"); // 12:30 AM CDT
  assert.equal(monitorMobileCallHref("2026-08-30", "(314) 555-0101", chicagoToday), "tel:3145550101");
  assert.equal(monitorMobileCallHref("2026-08-29", "(314) 555-0101", chicagoToday), null, "Historical operational dates never show a phone action");
  assert.equal(monitorMobileCallHref("2026-08-30", null, chicagoToday), null, "Missing Team phone numbers do not create dead phone actions");
  assert.equal(monitorMobileCallHref("2026-08-30", "not a phone", chicagoToday), null, "Only usable Team phone values become tel links");
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

test("DRO route selection remains singular, stable, and context-local", () => {
  let selection = selectDroRouteRow(101, "2026-08-29", 11);
  assert.equal(selectedDroRouteRowId(selection, "2026-08-29", 11), 101, "Clicking a row selects its stable snapshot-row ID");
  selection = selectDroRouteRow(202, "2026-08-29", 11);
  assert.equal(selectedDroRouteRowId(selection, "2026-08-29", 11), 202, "Selecting another row replaces the previous visual selection");
  selection = selectDroRouteRow(202, "2026-08-29", 11);
  assert.equal(selectedDroRouteRowId(selection, "2026-08-29", 11), 202, "Clicking the selected row keeps it selected");
  assert.equal(selectedDroRouteRowId(selectDroRouteRow(303, "2026-08-29", 11), "2026-08-29", 11), 303, "Selection does not depend on the click target, so row controls can keep their native behavior");
  assert.equal(selectedDroRouteRowId(selection, "2026-08-30", 11), null, "A date change clears the visible selection");
  assert.equal(selectedDroRouteRowId(selection, "2026-08-29", 12), null, "A snapshot change clears the visible selection");
  assert.equal(clearDroRouteSelection(), null);
});

test("DRO operational dates, refresh window, and deduplication use Chicago time", async () => {
  assert.equal(operationalDateForDroCapture("2026-08-30T00:59:59.000Z"), "2026-08-29", "7:59:59 PM remains the same operational date");
  for (const capturedAt of ["2026-08-30T01:00:00.000Z", "2026-08-30T01:30:00.000Z", "2026-08-30T04:00:00.000Z", "2026-08-30T04:59:59.000Z"]) {
    assert.equal(operationalDateForDroCapture(capturedAt), "2026-08-30", `${capturedAt} rolls to the next operational date`);
  }
  assert.equal(operationalDateForDroCapture("2026-08-30T17:00:00.000Z"), "2026-08-30", "Noon remains its local calendar date");
  assert.equal(isDroManualRefreshAllowed(new Date("2026-08-30T00:59:59.000Z")), false);
  assert.equal(isDroManualRefreshAllowed(new Date("2026-08-30T01:00:00.000Z")), true);
  assert.equal(isDroManualRefreshAllowed(new Date("2026-08-30T04:59:59.000Z")), true);
  assert.equal(isDroManualRefreshAllowed(new Date("2026-08-30T05:00:00.000Z")), false, "Midnight is outside the preparation window");
  assert.equal(isDroManualRefreshAllowed(new Date("2026-08-30T17:00:00.000Z")), false);
  let collectorCalls = 0;
  await assert.rejects(
    requestManualDroCollection(new Date("2026-08-30T00:59:59.000Z"), async () => {
      collectorCalls += 1;
      throw new Error("This must not run");
    }),
    error => error instanceof DroRefreshWindowError && error.message === DRO_REFRESH_WINDOW_MESSAGE,
  );
  assert.equal(collectorCalls, 0, "The collector is never called outside the window");
  const collected = await requestManualDroCollection(new Date("2026-08-30T01:00:00.000Z"), async () => {
    collectorCalls += 1;
    return { ok: true, snapshotId: 1, operationalDate: "2026-08-30", capturedAt: "2026-08-30T01:00:00.000Z", created: true, deduplicated: false };
  });
  assert.equal(collected.snapshotId, 1);
  assert.equal(collectorCalls, 1);

  assert.equal(shouldDeduplicateDroSnapshot("2026-08-30T03:30:00.000Z", "2026-08-30"), false, "10:30 PM remains a normal snapshot");
  assert.equal(shouldDeduplicateDroSnapshot("2026-08-30T04:00:00.000Z", "2026-08-30"), false, "Exactly 11 PM remains a normal snapshot");
  assert.equal(shouldDeduplicateDroSnapshot("2026-08-30T04:00:00.001Z", "2026-08-30"), true, "The cutoff begins immediately after 11 PM");
  assert.equal(shouldDeduplicateDroSnapshot("2026-08-30T04:20:00.000Z", "2026-08-30"), true);
  assert.equal(shouldDeduplicateDroSnapshot("2026-08-30T05:10:00.000Z", "2026-08-30"), false, "Midnight starts a new calendar operational day");
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

test("Homebase assignment refetch uses the local collector path and never starts a DRO collection", async () => {
  const previousToken = process.env.HOMEBASE_COLLECTOR_TOKEN;
  process.env.HOMEBASE_COLLECTOR_TOKEN = "homebase-control-test-token";
  try {
    const collectorUrls: string[] = [];
    const result = await requestHomebaseCollection({ fetchImplementation: async (input, init) => {
      collectorUrls.push(String(input));
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer homebase-control-test-token");
      return Response.json({ ok: true, rangeStart: "2026-08-24", rangeEnd: "2026-08-30", collectedAt: "2026-08-29T01:00:00.000Z", imported: 2, updated: 1, unchanged: 3, removed: 0, dates: ["2026-08-29"], routeAssignments: 4, specialAssignments: 1 });
    } });
    assert.equal(collectorUrls[0], "http://127.0.0.1:3102/collect");
    assert.equal(result.imported, 2);

    const uiUrls: string[] = [];
    const board = await refetchHomebaseAssignments<{ board: { operationalDate: string } }>("2026-08-29", async <TResponse>(url: string) => {
      uiUrls.push(url);
      return { board: { operationalDate: "2026-08-29" } } as TResponse;
    }, async (input, init) => {
      uiUrls.push(`${String(input)}:${init?.method}`);
      return Response.json({ ok: true });
    });
    assert.deepEqual(board, { board: { operationalDate: "2026-08-29" } });
    assert.deepEqual(uiUrls, ["/api/homebase/refresh:POST", "/api/dro/assignments?date=2026-08-29"]);
    assert.equal(uiUrls.some(url => url.includes("/api/dro/refresh")), false, "Refetching assignments never triggers DRO collection");

    let releaseCollection = () => {};
    const inFlight = requestHomebaseCollection({ fetchImplementation: async () => new Promise<Response>(resolve => { releaseCollection = () => resolve(Response.json({ ok: true, rangeStart: "2026-08-24", rangeEnd: "2026-08-30", collectedAt: "2026-08-29T01:00:00.000Z", imported: 0, updated: 0, unchanged: 0, removed: 0, dates: [], routeAssignments: 0, specialAssignments: 0 })); }) });
    await Promise.resolve();
    await assert.rejects(requestHomebaseCollection(), (error: unknown) => error instanceof HomebaseCollectorError && error.code === "HOMEBASE_COLLECTION_IN_PROGRESS" && error.status === 409);
    releaseCollection();
    await inFlight;

    await assert.rejects(requestHomebaseCollection({ fetchImplementation: async () => { throw new TypeError("connection refused"); } }), (error: unknown) => error instanceof HomebaseCollectorError && error.code === "HOMEBASE_COLLECTOR_UNAVAILABLE" && !error.message.includes("refused"));
    await assert.rejects(requestHomebaseCollection({ fetchImplementation: async () => Response.json({ ok: false, error: "auth_failed" }, { status: 401 }) }), (error: unknown) => error instanceof HomebaseCollectorError && error.code === "HOMEBASE_COLLECTOR_AUTH_FAILED");
  } finally {
    if (previousToken === undefined) delete process.env.HOMEBASE_COLLECTOR_TOKEN;
    else process.env.HOMEBASE_COLLECTOR_TOKEN = previousToken;
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

test("Selected DRO snapshot keeps rows, KPIs, and source timestamp on the same snapshot", () => {
  const first = { id: 401, capturedAt: "2026-08-30T01:00:00.000Z", sourceTimestamp: "2026-08-30T00:59:00.000Z" };
  const second = { id: 402, capturedAt: "2026-08-30T02:30:00.000Z", sourceTimestamp: "2026-08-30T02:29:00.000Z" };
  const selectedFirst = selectedDroSnapshot(401, first);
  assert.equal(selectedFirst?.id, 401);
  assert.equal(selectedSnapshotTimestamp(selectedFirst), "2026-08-30T00:59:00.000Z");

  const selectedSecond = selectedDroSnapshot(402, second);
  assert.equal(selectedSecond?.id, 402);
  assert.equal(selectedSnapshotTimestamp(selectedSecond), "2026-08-30T02:29:00.000Z", "Selecting another snapshot updates the displayed source timestamp");
  assert.equal(selectedDroSnapshot(402, first), null, "Stale rows and metadata are not rendered for a different selected snapshot");
  assert.equal(selectedSnapshotTimestamp({ id: 403, capturedAt: "2026-08-30T03:00:00.000Z", sourceTimestamp: null }), "2026-08-30T03:00:00.000Z", "Capture time is the exact-snapshot fallback when no source timestamp was supplied");
});

test("Homebase upserts by shift ID and DRO imports retain historical snapshots", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "kvc-integrations-"));
  const databasePath = path.join(temporaryDirectory, "fleet.db");
  const databaseUrl = `file:${databasePath.replaceAll("\\", "/")}`;
  process.env.DATABASE_URL = databaseUrl;
  process.env.ISSUE_UPLOAD_ROOT = path.join(temporaryDirectory, "uploads", "issues");
  let integrationClient: ReturnType<typeof createClient> | null = null;

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
    const { chicagoCalendarDate, chicagoHourKey, createMgbaDswSnapshot, getMgbaDswDateNavigation, getMgbaDswSnapshotById, getMgbaDswSnapshotsForDate, getMgbaDswStatusPackagesForRouteRow, listMgbaDswOperationalDates } = await import("../services/integrations/mgba-dsw");
    const { closeDb } = await import("../db/index");

    const client = createClient({ url: databaseUrl });
    integrationClient = client;
    const issueColumns = await client.execute("PRAGMA table_info(issues)");
    assert.equal(issueColumns.rows.some(row => String(row.name) === "resolution_notes"), true, "Resolution notes migration is additive");
    await client.execute({ sql: "INSERT INTO vehicles (number, make_model) VALUES (?, ?)", args: ["RES-100", "Ford Transit"] });
    const resolutionVehicle = await client.execute("SELECT id FROM vehicles WHERE number = 'RES-100'");
    const resolutionVehicleId = Number(resolutionVehicle.rows[0].id);
    await client.execute({ sql: "INSERT INTO issues (vehicle_id, type, notes, status, resolved_at) VALUES (?, ?, ?, 'open', ?)", args: [resolutionVehicleId, "Maintenance", "Replace worn tire", "client-controlled-value"] });
    await client.execute({ sql: "INSERT INTO issues (vehicle_id, type, notes, status, resolved_at) VALUES (?, ?, ?, 'resolved', ?)", args: [resolutionVehicleId, "Note", "Legacy resolved issue", "2026-08-29T12:00:00.000Z"] });
    const resolutionIssue = await client.execute("SELECT id FROM issues WHERE notes = 'Replace worn tire'");
    const legacyResolutionIssue = await client.execute("SELECT id FROM issues WHERE notes = 'Legacy resolved issue'");
    await client.execute({ sql: "INSERT INTO users (name, email, phone_number, password_hash, role) VALUES (?, ?, ?, ?, 'Fleet Manager')", args: ["Resolution Manager", "resolution-manager@example.test", "5555550199", "test"] });
    const resolutionUser = await client.execute("SELECT id FROM users WHERE email = 'resolution-manager@example.test'");
    const { displayName, hashPassword, hashToken: hashResolutionToken, normalizeFedexId, requireFleetOwner, requireManager, verifyPassword } = await import("../app/auth/server");
    assert.equal(normalizeFedexId(" 0012345 "), "0012345"); assert.equal(normalizeFedexId("12-345"), null);
    const sessionToken = "resolution-manager-test-token";
    await client.execute({ sql: "INSERT INTO auth_sessions (token_hash, user_id) VALUES (?, ?)", args: [hashResolutionToken(sessionToken), Number(resolutionUser.rows[0].id)] });
    const accountPassword = "OriginalPassword9";
    await client.execute({ sql: "INSERT INTO users (name, email, phone_number, password_hash, role) VALUES (?, ?, ?, ?, 'Team Member')", args: ["Account User", "account-user@example.test", "(555) 555-0123", hashPassword(accountPassword)] });
    const accountUser = await client.execute("SELECT id FROM users WHERE email = 'account-user@example.test'");
    const accountSessionToken = "account-settings-test-token";
    await client.execute({ sql: "INSERT INTO auth_sessions (token_hash, user_id) VALUES (?, ?)", args: [hashResolutionToken(accountSessionToken), Number(accountUser.rows[0].id)] });
    const { GET: getAccount, PATCH: updateAccount, POST: changeAccountPassword } = await import("../app/api/account/route");
    const accountRequest = (method = "GET", body?: unknown) => new Request("http://localhost/api/account", { method, headers: { Cookie: `kvc_session=${accountSessionToken}`, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    assert.equal((await getAccount(new Request("http://localhost/api/account"))).status, 401, "Account settings require authentication");
    const accountUpdate = await updateAccount(accountRequest("PATCH", { name: "Account User Updated", nickname: "Preferred", fedexId: "0012345", email: "account-user@example.test", phoneNumber: "5555550123", role: "FLEET_OWNER", userId: Number(resolutionUser.rows[0].id) }));
    assert.equal(accountUpdate.status, 200);
    const accountBody = await accountUpdate.json() as { account: { displayName: string; role: string } };
    assert.equal(accountBody.account.displayName, "Preferred", "Display name prefers nickname");
    assert.equal(accountBody.account.role, "Team Member", "Account update cannot modify role");
    assert.equal(JSON.stringify(accountBody).includes("password"), false, "Account API never returns password data");
    const accountRow = await client.execute("SELECT name, nickname, fedex_id, role, password_hash FROM users WHERE email = 'account-user@example.test'");
    assert.equal(accountRow.rows[0].name, "Account User Updated"); assert.equal(accountRow.rows[0].nickname, "Preferred"); assert.equal(accountRow.rows[0].fedex_id, "0012345", "FedEx ID preserves leading zeroes"); assert.equal(accountRow.rows[0].role, "Team Member");
    assert.equal((await updateAccount(accountRequest("PATCH", { name: "Account User Updated", nickname: "Preferred", fedexId: "12-345", email: "account-user@example.test", phoneNumber: "5555550123" }))).status, 400, "Non-digit FedEx IDs are rejected server-side");
    await client.execute({ sql: "INSERT INTO users (name, email, phone_number, fedex_id, password_hash, role) VALUES (?, ?, ?, ?, ?, 'Team Member')", args: ["Duplicate FedEx", "duplicate-fedex@example.test", "5555550198", "9988", hashPassword("Password123")] });
    assert.equal((await updateAccount(accountRequest("PATCH", { name: "Account User Updated", nickname: "Preferred", fedexId: "9988", email: "account-user@example.test", phoneNumber: "5555550123" }))).status, 409, "Duplicate FedEx IDs are rejected server-side");
    const loginPassword = "LoginPassword9";
    await client.execute({ sql: "INSERT INTO users (name, email, phone_number, fedex_id, password_hash, role, verified_at) VALUES (?, ?, ?, ?, ?, 'Team Member', ?)", args: ["Login User", "login-fedex@example.test", "(555) 555-0144", "0004422", hashPassword(loginPassword), new Date().toISOString()] });
    const { POST: authPost } = await import("../app/api/auth/route");
    const login = (identifier: string, password = loginPassword) => authPost(new Request("http://localhost/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "login", identifier, password }) }));
    assert.equal((await login("login-fedex@example.test")).status, 200, "Email login remains supported");
    assert.equal((await login("5555550144")).status, 200, "Phone login remains supported");
    assert.equal((await login("0004422")).status, 200, "FedEx ID login is supported");
    assert.equal((await login("0004422", "wrong-password")).status, 401, "Wrong passwords still fail");
    const unknownFedex = await login("0009999");
    assert.equal(unknownFedex.status, 401, "Unknown FedEx IDs fail generically");
    assert.equal((await unknownFedex.json() as { code: string }).code, "AUTH_INVALID_CREDENTIALS");
    const untouchedOtherUser = await client.execute("SELECT name FROM users WHERE email = 'resolution-manager@example.test'");
    assert.equal(untouchedOtherUser.rows[0].name, "Resolution Manager", "Client-supplied account targets are ignored");
    assert.equal((await changeAccountPassword(accountRequest("POST", { currentPassword: "wrong", newPassword: "UpdatedPassword9" }))).status, 400, "Current password is verified server-side");
    const malformedPasswordChange = await changeAccountPassword(new Request("http://localhost/api/account", { method: "POST", headers: { Cookie: `kvc_session=${accountSessionToken}`, "Content-Type": "application/json" }, body: "{" }));
    assert.equal(malformedPasswordChange.status, 400, "Malformed password requests are rejected");
    const passwordBeforeSuccess = await client.execute("SELECT password_hash FROM users WHERE email = 'account-user@example.test'");
    assert.equal(passwordBeforeSuccess.rows[0].password_hash, accountRow.rows[0].password_hash, "Failed password requests do not modify the hash");
    const passwordSuccess = await changeAccountPassword(accountRequest("POST", { currentPassword: accountPassword, newPassword: "UpdatedPassword9" }));
    assert.equal(passwordSuccess.status, 200);
    const passwordSuccessBody = await passwordSuccess.json() as { passwordChanged?: boolean; password?: string; passwordHash?: string };
    assert.equal(passwordSuccessBody.passwordChanged, true, "Password API has an explicit success contract");
    assert.equal(passwordSuccessBody.password, undefined); assert.equal(passwordSuccessBody.passwordHash, undefined);
    const updatedPasswordRow = await client.execute("SELECT password_hash FROM users WHERE email = 'account-user@example.test'");
    assert.notEqual(updatedPasswordRow.rows[0].password_hash, accountRow.rows[0].password_hash); assert.equal(verifyPassword("UpdatedPassword9", String(updatedPasswordRow.rows[0].password_hash)), true, "New password uses the existing secure hash format");
    await client.execute({ sql: "UPDATE users SET verified_at = ? WHERE email = 'account-user@example.test'", args: [new Date().toISOString()] });
    const loginAccount = (password: string) => authPost(new Request("http://localhost/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "login", identifier: "account-user@example.test", password }) }));
    assert.equal((await loginAccount("UpdatedPassword9")).status, 200, "New password authenticates after a successful change");
    assert.equal((await loginAccount(accountPassword)).status, 401, "Old password no longer authenticates");
    assert.equal(displayName({ nickname: "Preferred", name: "Full Name", email: "login@example.test" }), "Preferred");
    assert.equal(displayName({ nickname: " ", name: "Full Name", email: "login@example.test" }), "Full Name");
    assert.equal(displayName({ nickname: "", name: "", email: "login@example.test" }), "login@example.test");
    assert.ok(await requireFleetOwner(accountRequest()) instanceof Response, "Non-owner cannot use the future owner-only authorization path");
    await client.execute("UPDATE users SET role = 'FLEET_OWNER' WHERE email = 'account-user@example.test'");
    assert.equal(await requireFleetOwner(accountRequest()) instanceof Response, false, "Fleet Owner passes owner authorization");
    assert.equal(await requireManager(accountRequest()) instanceof Response, false, "Fleet Owner retains Fleet Manager permissions");
    const credentialKey = Buffer.alloc(32, 7).toString("base64");
    process.env.KVC_CREDENTIAL_MASTER_KEY = credentialKey;
    const { decryptIntegrationPassword, encryptIntegrationPassword } = await import("../services/integration-credential-crypto");
    const firstEncrypted = encryptIntegrationPassword("integration-secret", credentialKey), secondEncrypted = encryptIntegrationPassword("integration-secret", credentialKey);
    assert.equal(decryptIntegrationPassword(firstEncrypted, credentialKey), "integration-secret", "Credentials decrypt only server-side with the master key");
    assert.notEqual(firstEncrypted.ciphertext, secondEncrypted.ciphertext, "Each credential encryption uses a fresh nonce");
    assert.notEqual(firstEncrypted.iv, secondEncrypted.iv, "Each credential encryption uses a fresh IV");
    assert.throws(() => decryptIntegrationPassword(firstEncrypted, Buffer.alloc(32, 8).toString("base64")), /could not be decrypted/);
    assert.throws(() => decryptIntegrationPassword({ ...firstEncrypted, ciphertext: "malformed" }, credentialKey), /could not be decrypted/);
    const { GET: getIntegrations, PATCH: updateIntegration } = await import("../app/api/settings/integrations/route");
    const integrationRequest = (method = "GET", body?: unknown, token = accountSessionToken) => new Request("http://localhost/api/settings/integrations", { method, headers: { Cookie: `kvc_session=${token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    assert.equal((await getIntegrations(new Request("http://localhost/api/settings/integrations"))).status, 401, "Unauthenticated users cannot read integrations");
    assert.equal((await getIntegrations(integrationRequest("GET", undefined, sessionToken))).status, 403, "Fleet Managers cannot read owner-only integrations");
    const initialIntegrationResponse = await getIntegrations(integrationRequest()); const initialIntegrationBody = await initialIntegrationResponse.json() as { integrations: unknown[] };
    assert.equal(JSON.stringify(initialIntegrationBody).includes("password_ciphertext"), false, "GET never returns credential storage fields");
    assert.equal(JSON.stringify(initialIntegrationBody).includes("password"), true, "GET exposes only passwordConfigured metadata");
    const saveMgba = await updateIntegration(integrationRequest("PATCH", { integration: "MGBA", username: "mgba-user", password: "MGBA secret", currentPassword: "UpdatedPassword9", role: "FLEET_OWNER" }));
    assert.equal(saveMgba.status, 200); const saveMgbaBody = await saveMgba.json(); assert.equal(JSON.stringify(saveMgbaBody).includes("MGBA secret"), false, "Credential update response never returns plaintext");
    const storedMgba = await client.execute("SELECT username, password_ciphertext, password_iv, password_tag FROM integration_credentials WHERE integration = 'MGBA'");
    assert.equal(storedMgba.rows[0].username, "mgba-user"); assert.notEqual(storedMgba.rows[0].password_ciphertext, "MGBA secret", "Plaintext is never stored");
    assert.equal((await client.execute("SELECT COUNT(*) AS count FROM integration_credentials WHERE integration = 'HOMEBASE'")).rows[0].count, 0, "MGBA updates do not modify Homebase");
    const originalCiphertext = String(storedMgba.rows[0].password_ciphertext);
    assert.equal((await updateIntegration(integrationRequest("PATCH", { integration: "MGBA", username: "mgba-user-renamed", password: "", currentPassword: "UpdatedPassword9" }))).status, 200, "Blank password preserves the configured secret");
    const renamedMgba = await client.execute("SELECT username, password_ciphertext FROM integration_credentials WHERE integration = 'MGBA'");
    assert.equal(renamedMgba.rows[0].username, "mgba-user-renamed"); assert.equal(renamedMgba.rows[0].password_ciphertext, originalCiphertext);
    assert.equal((await updateIntegration(integrationRequest("PATCH", { integration: "HOMEBASE", username: "homebase-user", password: "Homebase secret", currentPassword: "wrong" }))).status, 400, "Owner current password is required for credential writes");
    assert.equal((await updateIntegration(integrationRequest("PATCH", { integration: "HOMEBASE", username: "homebase-user", password: "Homebase secret", currentPassword: "UpdatedPassword9" }))).status, 200);
    const auditRows = await client.execute("SELECT integration, action, user_id FROM integration_credential_audit ORDER BY id");
    assert.equal(auditRows.rows.length, 3, "Sensitive updates create metadata-only audit records");
    const { PATCH: updateIssue } = await import("../app/api/issues/[id]/route");
    const issueRequest = (body: unknown) => new Request("http://localhost/api/issues/1", { method: "PATCH", headers: { "Content-Type": "application/json", cookie: `kvc_session=${sessionToken}` }, body: JSON.stringify(body) });
    assert.equal((await updateIssue(issueRequest({ status: "resolved" }), { params: Promise.resolve({ id: String(resolutionIssue.rows[0].id) }) })).status, 400, "An open issue cannot resolve without notes");
    const resolvedResponse = await updateIssue(issueRequest({ status: "resolved", resolutionNotes: "  Installed a new tire.  ", resolvedAt: "tampered" }), { params: Promise.resolve({ id: String(resolutionIssue.rows[0].id) }) });
    assert.equal(resolvedResponse.status, 200);
    const resolvedIssue = await resolvedResponse.json() as { issue: { status: string; resolutionNotes: string | null; resolvedAt: string | null } };
    assert.equal(resolvedIssue.issue.status, "resolved");
    assert.equal(resolvedIssue.issue.resolutionNotes, "Installed a new tire.");
    assert.notEqual(resolvedIssue.issue.resolvedAt, "tampered", "The server alone controls resolvedAt");
    const originalResolvedAt = resolvedIssue.issue.resolvedAt;
    const editResponse = await updateIssue(issueRequest({ resolutionNotes: "Added wheel torque check." }), { params: Promise.resolve({ id: String(resolutionIssue.rows[0].id) }) });
    const editedIssue = await editResponse.json() as { issue: { resolutionNotes: string | null; resolvedAt: string | null } };
    assert.equal(editedIssue.issue.resolutionNotes, "Added wheel torque check.");
    assert.equal(editedIssue.issue.resolvedAt, originalResolvedAt, "Editing notes does not replace the resolution timestamp");
    const legacyEditResponse = await updateIssue(issueRequest({ resolutionNotes: "Legacy repair details added later." }), { params: Promise.resolve({ id: String(legacyResolutionIssue.rows[0].id) }) });
    assert.equal(legacyEditResponse.status, 200, "Legacy resolved issues may gain resolution notes later");
    const { listIssueAttachments, readIssueAttachment, saveIssueAttachments } = await import("../services/issue-attachments");
    const savedAttachments = await saveIssueAttachments(Number(resolutionIssue.rows[0].id), [new File(["image bytes"], "../../tire-photo.jpg", { type: "image/jpeg" }), new File(["video bytes"], "walkaround.mp4", { type: "video/mp4" })], "update");
    assert.equal(savedAttachments.length, 2, "Multiple attachment metadata rows are persisted separately from the issue");
    assert.equal(savedAttachments[0].originalFilename, "tire-photo.jpg", "Unsafe client path segments are removed from metadata");
    assert.notEqual(savedAttachments[0].publicId, savedAttachments[1].publicId, "Attachments receive unique opaque public IDs");
    assert.equal((await listIssueAttachments(Number(resolutionIssue.rows[0].id))).length, 2);
    assert.equal((await readIssueAttachment(savedAttachments[0].publicId))?.content.toString(), "image bytes", "Only registered public IDs resolve to their stored binary");
    assert.equal(await readIssueAttachment(String(savedAttachments[0].id)), null, "Sequential attachment IDs are not public endpoints");
    const attachmentColumns = await client.execute("PRAGMA table_info(issue_attachments)");
    assert.equal(attachmentColumns.rows.some(row => String(row.name).includes("content") || String(row.name).includes("binary")), false, "SQLite stores metadata only, never attachment binary content");
    await client.execute({ sql: "INSERT INTO issues (vehicle_id, type, notes, status, created_at, resolved_at, resolution_notes, service_scheduled) VALUES (?, ?, ?, 'resolved', ?, ?, ?, 1)", args: [resolutionVehicleId, "=Formula-like type", "Line one, with a comma\nand a \"quote\"", "2026-08-20T15:42:00.000Z", "2026-08-21T16:17:00.000Z", "+Resolution detail"] });
    const { createCsvExport, createXlsxExport, getIssueExportRows } = await import("../services/issue-export");
    const exportedRows = await getIssueExportRows("all");
    const specialExport = exportedRows.find(row => row["Issue Type"] === "'=Formula-like type");
    assert.equal(specialExport?.["Service Scheduled"], "Yes");
    assert.equal(specialExport?.["Resolution Information"], "'+Resolution detail", "Formula-like values are neutralized in export data");
    assert.equal(specialExport?.["Reported Date"], "08/20/2026", "Export dates use America/Chicago formatting");
    const issueIdsInOrder = exportedRows.filter(row => [Number(resolutionIssue.rows[0].id), Number(legacyResolutionIssue.rows[0].id)].includes(Number(row["Issue ID"]))).map(row => Number(row["Issue ID"]));
    assert.deepEqual(issueIdsInOrder, [...issueIdsInOrder].sort((left, right) => left - right), "Equal creation timestamps use deterministic issue ID ordering");
    const csv = createCsvExport([specialExport!]);
    assert.match(csv, /"Line one, with a comma\n?and a ""quote"""/, "CSV escapes commas, quotes, and multiline descriptions");
    const workbook = createXlsxExport([specialExport!], "all");
    assert.equal(workbook.subarray(0, 2).toString(), "PK", "XLSX is a real ZIP/OpenXML workbook");
    assert.match(workbook.toString("utf8"), /Issue History/, "Workbook includes the Issue History worksheet");
    assert.match(workbook.toString("utf8"), /cellStyle name="Normal" xfId="0" builtinId="0"/, "XLSX includes Excel's required default Normal style");
    const { GET: exportIssues } = await import("../app/api/issues/export/route");
    const exportResponse = await exportIssues(new Request("http://localhost/api/issues/export?scope=resolved&format=csv", { headers: { cookie: `kvc_session=${sessionToken}` } }));
    assert.equal(exportResponse.status, 200); assert.match(exportResponse.headers.get("content-type") || "", /text\/csv/); assert.match(exportResponse.headers.get("content-disposition") || "", /kvc-vehicle-issues-resolved/);
    assert.equal((await exportIssues(new Request("http://localhost/api/issues/export?scope=bad&format=csv", { headers: { cookie: `kvc_session=${sessionToken}` } }))).status, 400);
    const mgbaPayload = {
      operationalDate: "2026-08-29", dswDate: "08/29/2026", capturedAt: "2026-08-29T16:00:00.000Z", source: "MGBA_DSW", routeCount: 2,
      routes: [
        { serviceArea: "631", waName: "UNPLANNED WA", vehicleNumber: "415659 431928", driverName: "Actual Driver", routeNumber: "000621", rawRoute: "000621", dst: null, vscanPkgs: 0, delStops: 10, puStops: null, diff: 0, actDelStops: 9, actDelPkgs: 90, actPuStops: null, actPuPkgs: null, ilsPercent: 99.5, allStatusCodePkgs: 8 },
        { serviceArea: null, waName: "Unknown route driver", vehicleNumber: "1127 204004", driverName: "Not In DRO", routeNumber: "009999", rawRoute: "009999", dst: "R", vscanPkgs: 30, delStops: 20, puStops: 1, diff: -1, actDelStops: 18, actDelPkgs: 80, actPuStops: 1, actPuPkgs: 2, ilsPercent: 88, allStatusCodePkgs: 6 },
      ],
    };
    const firstMgba = await createMgbaDswSnapshot(mgbaPayload);
    const reorderedMgba = await createMgbaDswSnapshot({ ...mgbaPayload, capturedAt: "2026-08-29T16:10:00.000Z", routes: [...mgbaPayload.routes].reverse() });
    assert.equal(reorderedMgba.id, firstMgba.id, "Captured time alone and reordered rows do not create a new Monitor snapshot");
    assert.equal(reorderedMgba.deduplicated, true);
    const changedMgba = await createMgbaDswSnapshot({ ...mgbaPayload, capturedAt: "2026-08-29T16:20:00.000Z", routes: mgbaPayload.routes.map((row, index) => index === 0 ? { ...row, allStatusCodePkgs: 9 } : row) });
    assert.notEqual(changedMgba.id, firstMgba.id, "A changed source field creates a new Monitor snapshot");
    const mgbaRows = (await getMgbaDswSnapshotById(firstMgba.id))?.rows || [];
    assert.equal(mgbaRows.length, 2, "DSW drivers absent from DRO are retained");
    assert.equal(mgbaRows.find(row => row.driverName === "Not In DRO")?.routeNumber, "9999", "Unknown routes remain available in Monitor");
    assert.equal(mgbaRows.find(row => row.driverName === "Actual Driver")?.vehicleNumber, "415659 431928");
    assert.equal(mgbaRows.find(row => row.driverName === "Actual Driver")?.puStops, null);
    assert.equal(mgbaRows.find(row => row.driverName === "Actual Driver")?.allStatusCodePkgs, 8);
    const multiDriver = await createMgbaDswSnapshot({ ...mgbaPayload, operationalDate: "2026-08-30", dswDate: "08/30/2026", capturedAt: "2026-08-30T16:00:00.000Z", routes: [
      { ...mgbaPayload.routes[0], driverName: "Driver A", allStatusCodePkgs: 1, statusPackagesState: "captured", statusPackages: [{ packageNumber: 1, additionalInfo: null, visionLabel: null, trackingId: "A", destinationAddress: null, vehicleNumber: null, vsaStatusCode: null, starStatusCode: null, starScanTime: null, isGreyedOut: false }] },
      { ...mgbaPayload.routes[0], driverName: "Driver B", vehicleNumber: "B-vehicle", delStops: 22, allStatusCodePkgs: 1, statusPackagesState: "captured", statusPackages: [{ packageNumber: 1, additionalInfo: null, visionLabel: null, trackingId: "B", destinationAddress: null, vehicleNumber: null, vsaStatusCode: null, starStatusCode: null, starScanTime: null, isGreyedOut: true }] },
      { ...mgbaPayload.routes[1], driverName: "Driver C", routeNumber: "625" },
    ] });
    const multiRows = (await getMgbaDswSnapshotById(multiDriver.id))?.rows || [];
    const route621 = multiRows.filter(row => row.routeNumber === "621");
    assert.equal(route621.length, 2, "Multiple driver-populated DSW rows for one route remain independent");
    assert.notEqual(route621[0].id, route621[1].id);
    assert.equal(route621.find(row => row.driverName === "Driver B")?.delStops, 22);
    assert.equal((await getMgbaDswStatusPackagesForRouteRow(route621.find(row => row.driverName === "Driver A")!.id))?.packages[0]?.trackingId, "A");
    assert.equal((await getMgbaDswStatusPackagesForRouteRow(route621.find(row => row.driverName === "Driver B")!.id))?.packages[0]?.isGreyedOut, true);
    await client.execute({ sql: "INSERT INTO team_members (name, phone_number, availability_days, dsw_driver_name) VALUES (?, ?, '[]', ?)", args: ["Roster Driver A", "(314) 555-0101", "Driver A"] });
    await client.execute({ sql: "INSERT INTO team_members (name, phone_number, availability_days) VALUES (?, ?, '[]')", args: ["Driver B", "(314) 555-0102"] });
    const todayPhoneRows = (await getMgbaDswSnapshotById(multiDriver.id, undefined, new Date("2026-08-30T18:00:00.000Z")))?.rows || [];
    assert.equal(todayPhoneRows.find(row => row.driverName === "Driver A")?.driverPhone, "3145550101", "Today's Monitor data uses only the exact DSW driver association");
    assert.equal(todayPhoneRows.find(row => row.driverName === "Driver B")?.driverPhone, null, "A matching Team display name without an explicit DSW association is never used");
    const historicalPhoneRows = (await getMgbaDswSnapshotById(multiDriver.id, undefined, new Date("2026-08-31T18:00:00.000Z")))?.rows || [];
    assert.equal(historicalPhoneRows.find(row => row.driverName === "Driver A")?.driverPhone, null, "Historical Monitor snapshots do not expose current Team phone numbers");
    assert.notEqual((await createMgbaDswSnapshot({ ...multiDriver, capturedAt: "2026-08-30T16:10:00.000Z", routes: multiDriver.routeCount ? [
      { ...mgbaPayload.routes[0], driverName: "Driver A", allStatusCodePkgs: 1 }, { ...mgbaPayload.routes[1], driverName: "Driver C", routeNumber: "625" },
    ] : [] })).id, multiDriver.id, "Removing one duplicate route driver is a snapshot change");
    const chicagoToday = new Date("2026-08-29T18:00:00.000Z");
    assert.equal(chicagoCalendarDate(chicagoToday), "2026-08-29");
    assert.deepEqual((await getMgbaDswSnapshotsForDate("2026-08-29", undefined, chicagoToday)).map(snapshot => snapshot.id), [changedMgba.id, firstMgba.id], "Today retains every changed snapshot, newest first");
    assert.deepEqual((await getMgbaDswSnapshotsForDate("2026-08-29", undefined, new Date("2026-08-30T18:00:00.000Z"))).map(snapshot => snapshot.id), [changedMgba.id], "Historical reads retain only the latest snapshot in each Chicago hour");
    assert.deepEqual(await getMgbaDswDateNavigation("2026-08-29"), { previousDate: null, nextDate: "2026-08-30", latestDate: "2026-08-30" });
    assert.equal((await listMgbaDswOperationalDates())[0]?.snapshotCount, 2);
    const utcBoundaryFirst = await createMgbaDswSnapshot({ ...mgbaPayload, operationalDate: "2026-08-28", dswDate: "08/28/2026", capturedAt: "2026-08-29T03:50:00.000Z" });
    const utcBoundaryLatest = await createMgbaDswSnapshot({ ...mgbaPayload, operationalDate: "2026-08-28", dswDate: "08/28/2026", capturedAt: "2026-08-29T04:30:00.000Z", routes: mgbaPayload.routes.map((row, index) => index === 0 ? { ...row, allStatusCodePkgs: 10 } : row) });
    assert.equal(chicagoHourKey("2026-08-29T03:50:00.000Z"), "2026-08-28T22", "UTC day boundaries are converted to Chicago before bucketing");
    assert.equal(chicagoHourKey("2026-08-29T04:30:00.000Z"), "2026-08-28T23");
    assert.deepEqual((await getMgbaDswSnapshotsForDate("2026-08-28", undefined, new Date("2026-08-30T18:00:00.000Z"))).map(snapshot => snapshot.id), [utcBoundaryLatest.id, utcBoundaryFirst.id], "Historical hour buckets preserve newest-to-oldest order");
    const noLogoutSignal = await createMgbaDswSnapshot({ ...mgbaPayload, operationalDate: "2026-08-27", dswDate: "08/27/2026", capturedAt: "2026-08-27T16:00:00.000Z" });
    const logoutSignal = await createMgbaDswSnapshot({ ...mgbaPayload, operationalDate: "2026-08-27", dswDate: "08/27/2026", capturedAt: "2026-08-27T16:10:00.000Z", routes: mgbaPayload.routes.map((row, index) => index === 0 ? { ...row, nextAvailOnDuty: "03:30 AM" } : row) });
    assert.notEqual(logoutSignal.id, noLogoutSignal.id, "A new Next Avail On Duty source value creates a historical snapshot");
    assert.equal((await getMgbaDswSnapshotById(logoutSignal.id))?.rows[0]?.nextAvailOnDuty, "03:30 AM", "Monitor rows return the exact persisted source value");
    process.env.MGBA_INGEST_TOKEN = "mgba-ingest-test-token";
    const { POST: ingestMgba } = await import("../app/api/internal/mgba/snapshot/route");
    const mgbaRequest = (body: unknown, token?: string) => new Request("http://localhost/api/internal/mgba/snapshot", { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    assert.equal((await ingestMgba(mgbaRequest(mgbaPayload))).status, 401);
    assert.equal((await ingestMgba(mgbaRequest({ ...mgbaPayload, routes: [{}] }, "mgba-ingest-test-token"))).status, 400);
    const ingestedMgba = await ingestMgba(mgbaRequest({ ...mgbaPayload, operationalDate: "2026-08-30", dswDate: "08/30/2026", capturedAt: "2026-08-30T16:00:00.000Z", routes: mgbaPayload.routes.map((row, index) => index === 0 ? { ...row, nextAvailOnDuty: "03:30 AM" } : row) }, "mgba-ingest-test-token"));
    assert.equal(ingestedMgba.status, 201);
    const ingestedMgbaBody = await ingestedMgba.json() as { snapshotId: number };
    assert.equal((await getMgbaDswSnapshotById(ingestedMgbaBody.snapshotId))?.rows[0]?.nextAvailOnDuty, "03:30 AM", "The ingestion endpoint accepts and preserves Next Avail On Duty");
    const blankDriverMgba = await ingestMgba(mgbaRequest({ ...mgbaPayload, operationalDate: "2026-08-30", dswDate: "08/30/2026", capturedAt: "2026-08-30T16:24:00.000Z", routes: mgbaPayload.routes.map((row, index) => index === 0 ? { ...row, driverName: "", vehicleNumber: "510252", vscanPkgs: 167, delStops: 123, puStops: 3, diff: 123, nextAvailOnDuty: "18:00" } : row) }, "mgba-ingest-test-token"));
    assert.equal(blankDriverMgba.status, 201, "Operational routes with a blank FedEx driver are accepted");
    const blankDriverBody = await blankDriverMgba.json() as { snapshotId: number };
    const blankDriverRows = (await getMgbaDswSnapshotById(blankDriverBody.snapshotId))?.rows || [];
    assert.equal(blankDriverRows[0]?.driverName, "", "Blank FedEx driver data remains blank rather than fabricated");
    assert.equal(blankDriverRows[0]?.nextAvailOnDuty, "18:00", "Blank-driver parent retains Next Avail On Duty");
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
      operationalDate: "2026-08-29", capturedAt: "2026-08-29T01:00:00Z", stationId: "KVC", serviceAreaId: "STL", status: "complete",
      rows: [{ routeNumber: "617", rawWaNumber: "WA-1", deliveryCube: 301, vehicleCapacity: 600 }],
    });
    const secondSnapshot = await createDroSnapshot({
      operationalDate: "2026-08-29", capturedAt: "2026-08-29T01:30:00Z", stationId: "KVC", serviceAreaId: "STL", status: "complete",
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
    await client.execute({ sql: "UPDATE dro_route_rows SET warning = 0 WHERE snapshot_id = ?", args: [firstSnapshot.id] });
    assert.equal((await getDroSnapshotById(firstSnapshot.id))?.rows[0].warning, true, "Historical warning display is recalculated from the stored capacity values");

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
    assert.equal(latest?.rows[0].warning, true);

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
      capacityWarnings: 1,
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

    const ingestedSnapshots = await client.execute("SELECT COUNT(*) AS count FROM dro_snapshots WHERE operational_date = '2026-09-02' AND station_id = '631'");
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
    assert.notEqual(midnightDuplicate.id, changedLate.id, "Midnight begins a new capture window and preserves the snapshot");

    const afterMidnightChangedRows = capacityChangedRows.map((row, index) => index === 1 ? { ...row, routeTime: "09:30" } : row);
    const afterMidnightChanged = await createDroSnapshot(lateInput("2026-09-04T05:20:00.000Z", afterMidnightChangedRows));
    assert.equal(afterMidnightChanged.created, true, "Changed data after midnight creates a snapshot");

    const concurrentChangedRows = afterMidnightChangedRows.map((row, index) => index === 0 ? { ...row, combinationPackages: row.combinationPackages + 1 } : row);
    const concurrentResults = await Promise.all([
      createDroSnapshot(lateInput("2026-09-04T05:30:00.000Z", concurrentChangedRows)),
      createDroSnapshot(lateInput("2026-09-04T05:31:00.000Z", [...concurrentChangedRows].reverse())),
    ]);
    assert.notEqual(concurrentResults[0].id, concurrentResults[1].id, "Snapshots outside the after-11 PM deduplication window remain historical records");
    assert.equal(concurrentResults.filter(result => result.created).length, 2);
    assert.equal(concurrentResults.filter(result => result.deduplicated).length, 0);

    const lateSnapshotCount = await client.execute("SELECT COUNT(*) AS count FROM dro_snapshots WHERE operational_date = '2026-09-04'");
    assert.equal(Number(lateSnapshotCount.rows[0].count), 8);
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
      mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-04T01:30:00.000Z") });
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
      mock.timers.reset();
      globalThis.fetch = originalFetch;
    }

    const rosterNames = [
      "Joshua Gallagher", "Jay Jones", "Michael Dahl", "Davion Sanderson", "Dennis Davis", "Erik Colon",
      "Phillip Trapp", "Brandon Vickers", "Andrew Kite", "Trent Unknown", "Sarah Example", "Zoe Example",
    ];
    const rosterIds = new Map<string, number>();
    for (const [index, name] of rosterNames.entries()) {
      const inserted = await client.execute({
        sql: "INSERT INTO team_members (name, phone_number, availability_days) VALUES (?, ?, '[]')",
        args: [name, `(555) 700-${String(1000 + index).slice(-4)}`],
      });
      rosterIds.set(name, Number(inserted.lastInsertRowid));
    }

    const homebasePayload = {
      rangeStart: "2026-10-05",
      rangeEnd: "2026-10-11",
      collectedAt: "2026-10-04T23:00:00.000Z",
      shifts: [
        ["hb-josh-05", "hb-josh", "2026-10-05", "JOSHUA GALLAGHER", "621", "621", "route"],
        ["hb-jay-05", "hb-jay", "2026-10-05", "JAY JONES", "TBD ROUTE", null, "special"],
        ["hb-michael-05", "hb-michael", "2026-10-05", "MICHAEL DAHL", "TBD ROUTE", null, "special"],
        ["hb-davion-05", "hb-davion", "2026-10-05", "DAVION SANDERSON", "625", "625", "route"],
        ["hb-dennis-05", "hb-dennis", "2026-10-05", "DENNIS DAVIS", "ON CALL AT HOME", null, "special"],
        ["hb-erik-05", "hb-erik", "2026-10-05", "ERIK COLON", "ON CALL AT HOME", null, "special"],
        ["hb-phillip-05", "hb-phillip", "2026-10-05", "PHILLIP TRAPP", "BC", null, "special"],
        ["hb-brandon-05", "hb-brandon", "2026-10-05", "BRANDON VICKERS", "BC", null, "special"],
        ["hb-andrew-05", "hb-andrew", "2026-10-05", "ANDREW KITE", "622", "622", "route"],
        ["hb-trent-05", "hb-trent", "2026-10-05", "TRENT UNKNOWN", "MISSED", null, "special"],
        ["hb-unmatched-05", "hb-unmatched", "2026-10-05", "UNMATCHED PERSON", "BC", null, "special"],
        ["hb-josh-06", "hb-josh", "2026-10-06", "JOSHUA GALLAGHER", "630", "630", "route"],
      ].map(([homebaseShiftId, homebaseUserId, date, employee, assignment, route, type], index) => ({
        homebaseShiftId,
        homebaseUserId,
        date,
        employee,
        firstName: String(employee).split(" ")[0],
        lastName: String(employee).split(" ").at(-1),
        startAt: `${date}T13:00:00.000Z`,
        endAt: `${date}T22:00:00.000Z`,
        assignment,
        route,
        type,
        confidence: "high",
        note: index === 0 ? "Original note" : null,
        publishedStatus: "published",
      })),
    };
    process.env.HOMEBASE_INGEST_TOKEN = "homebase-server-test-token";
    const { POST: ingestHomebaseSchedule } = await import("../app/api/internal/homebase/schedule/route");
    function homebaseRequest(body: unknown, token?: string) {
      const headers = new Headers({ "Content-Type": "application/json" });
      if (token) headers.set("Authorization", `Bearer ${token}`);
      return new Request("http://localhost/api/internal/homebase/schedule", { method: "POST", headers, body: JSON.stringify(body) });
    }

    const missingHomebaseToken = await ingestHomebaseSchedule(homebaseRequest(homebasePayload));
    assert.equal(missingHomebaseToken.status, 401);
    const wrongHomebaseToken = await ingestHomebaseSchedule(homebaseRequest(homebasePayload, "wrong-homebase-token"));
    assert.equal(wrongHomebaseToken.status, 401);
    assert.equal(JSON.stringify(await wrongHomebaseToken.json()).includes("homebase-server-test-token"), false, "Homebase token must never appear in errors");
    assert.equal((await ingestHomebaseSchedule(homebaseRequest({ ...homebasePayload, rangeStart: "not-a-date" }, "homebase-server-test-token"))).status, 400);

    const firstHomebaseImport = await ingestHomebaseSchedule(homebaseRequest(homebasePayload, "homebase-server-test-token"));
    assert.equal(firstHomebaseImport.status, 200);
    assert.deepEqual(await firstHomebaseImport.json(), {
      imported: 12, updated: 0, unchanged: 0, removed: 0,
      dates: ["2026-10-05", "2026-10-06"], routeAssignments: 4, specialAssignments: 8,
    });
    const repeatedHomebaseImport = await ingestHomebaseSchedule(homebaseRequest(homebasePayload, "homebase-server-test-token"));
    assert.deepEqual(await repeatedHomebaseImport.json(), {
      imported: 0, updated: 0, unchanged: 12, removed: 0,
      dates: ["2026-10-05", "2026-10-06"], routeAssignments: 4, specialAssignments: 8,
    }, "Repeating a full weekly import must be idempotent");
    const importedShiftCount = await client.execute("SELECT COUNT(*) AS count FROM homebase_shifts WHERE schedule_date BETWEEN '2026-10-05' AND '2026-10-11'");
    assert.equal(Number(importedShiftCount.rows[0].count), 12);

    const noteUpdatedPayload = {
      ...homebasePayload,
      collectedAt: "2026-10-04T23:30:00.000Z",
      shifts: homebasePayload.shifts.map((shift, index) => index === 0 ? { ...shift, note: "Updated source note" } : shift),
    };
    const updatedHomebaseImport = await ingestHomebaseSchedule(homebaseRequest(noteUpdatedPayload, "homebase-server-test-token"));
    const updatedHomebaseSummary = await updatedHomebaseImport.json() as Record<string, unknown>;
    assert.equal(updatedHomebaseSummary.updated, 1);
    assert.equal(updatedHomebaseSummary.unchanged, 11);
    const updatedSource = await client.execute("SELECT raw_note FROM homebase_shifts WHERE homebase_shift_id = 'hb-josh-05'");
    assert.equal(updatedSource.rows[0].raw_note, "Updated source note");

    const sundayHomebasePayload = {
      rangeStart: "2026-10-11",
      rangeEnd: "2026-10-11",
      collectedAt: "2026-10-10T23:30:00.000Z",
      shifts: [{
        homebaseShiftId: "hb-josh-11", homebaseUserId: "hb-josh", date: "2026-10-11", employee: "JOSHUA GALLAGHER",
        firstName: "JOSHUA", lastName: "GALLAGHER", startAt: "2026-10-11T13:00:00.000Z", endAt: "2026-10-11T22:00:00.000Z",
        assignment: "621", route: "621", type: "route", confidence: "high", note: null, publishedStatus: "published",
      }],
    };
    assert.equal((await ingestHomebaseSchedule(homebaseRequest(sundayHomebasePayload, "homebase-server-test-token"))).status, 200);

    const {
      getDailyAssignmentBoard,
      resetDailyAssignmentsToHomebase,
      restoreMemberToHomebase,
      swapDailyAssignment,
    } = await import("../services/integrations/daily-assignments");
    const assignmentFor = (board: Awaited<ReturnType<typeof getDailyAssignmentBoard>>, name: string) => {
      const member = board.members.find(item => item.name === name);
      assert.ok(member, `Missing assignment member ${name}`);
      return member;
    };
    let board = await getDailyAssignmentBoard("2026-10-05");
    assert.equal(assignmentFor(board, "Joshua Gallagher").assignmentLabel, "621", "Routes join to assignments by operational date and route");
    assert.equal(board.members.filter(member => member.assignmentLabel === "TBD ROUTE").length, 2);
    assert.equal(board.members.filter(member => member.assignmentLabel === "BC").length, 2);
    assert.equal(board.members.filter(member => member.assignmentLabel === "ON CALL AT HOME").length, 2);
    assert.equal(assignmentFor(board, "Trent Unknown").assignmentLabel, "MISSED", "Unknown Homebase special assignments are retained");
    assert.equal(board.unmatchedHomebase.length, 1, "Unmatched Homebase users remain safe source records");
    assert.equal(board.unmatchedHomebase[0].employeeDisplayName, "UNMATCHED PERSON");

    const boardWithoutHomebase = await getDailyAssignmentBoard("2026-10-12");
    assert.equal(boardWithoutHomebase.hasHomebaseData, false);
    assert.ok(boardWithoutHomebase.members.every(member => member.assignmentLabel === "Unassigned"), "DRO staffing remains usable without Homebase data");
    const historicalBoard = await getDailyAssignmentBoard("2026-10-06");
    assert.equal(assignmentFor(historicalBoard, "Joshua Gallagher").assignmentLabel, "630", "Historical dates retain independent boards");

    const staffingSnapshotOne = await createDroSnapshot({
      operationalDate: "2026-10-05", capturedAt: "2026-10-05T20:00:00.000Z", stationId: "631", serviceAreaId: "2994532", status: "success",
      rows: [{ routeNumber: "621", rawWaNumber: "WA-STAFF-1", deliveryCube: 100, vehicleCapacity: 600 }],
    });
    const staffingSnapshotTwo = await createDroSnapshot({
      operationalDate: "2026-10-05", capturedAt: "2026-10-05T21:00:00.000Z", stationId: "631", serviceAreaId: "2994532", status: "success",
      rows: [{ routeNumber: "621", rawWaNumber: "WA-STAFF-2", deliveryCube: 120, vehicleCapacity: 600 }],
    });
    assert.notEqual(staffingSnapshotOne.id, staffingSnapshotTwo.id);
    const saturdayEveningSnapshot = await createDroSnapshot({
      operationalDate: "2026-10-10", capturedAt: "2026-10-11T01:30:00.000Z", stationId: "631", serviceAreaId: "2994532", status: "success",
      rows: [{ routeNumber: "621", rawWaNumber: "WA-SUNDAY", deliveryCube: 300, vehicleCapacity: 600 }],
    });
    assert.equal(saturdayEveningSnapshot.operationalDate, "2026-10-11", "Saturday evening DRO captures select Sunday operational staffing");
    assert.equal(assignmentFor(await getDailyAssignmentBoard(saturdayEveningSnapshot.operationalDate), "Joshua Gallagher").assignmentLabel, "621");
    assert.equal(assignmentFor(await getDailyAssignmentBoard("2026-10-05"), "Joshua Gallagher").assignmentLabel, "621", "Snapshot changes do not change the date staffing board");
    const immutableDroBefore = await client.execute({ sql: "SELECT captured_at FROM dro_snapshots WHERE id = ?", args: [staffingSnapshotOne.id] });

    board = await swapDailyAssignment({ operationalDate: "2026-10-05", destination: { type: "route", routeNumber: "621" }, replacementTeamMemberId: rosterIds.get("Jay Jones") as number });
    assert.equal(assignmentFor(board, "Jay Jones").assignmentLabel, "621");
    assert.equal(assignmentFor(board, "Joshua Gallagher").assignmentLabel, "TBD ROUTE");
    assert.equal(assignmentFor(board, "Michael Dahl").assignmentLabel, "TBD ROUTE", "Other people in a multi-person bucket remain untouched");

    board = await swapDailyAssignment({ operationalDate: "2026-10-05", destination: { type: "route", routeNumber: "625" }, replacementTeamMemberId: rosterIds.get("Dennis Davis") as number });
    assert.equal(assignmentFor(board, "Dennis Davis").assignmentLabel, "625");
    assert.equal(assignmentFor(board, "Davion Sanderson").assignmentLabel, "ON CALL AT HOME");
    assert.equal(assignmentFor(board, "Erik Colon").assignmentLabel, "ON CALL AT HOME");

    board = await swapDailyAssignment({ operationalDate: "2026-10-05", destination: { type: "route", routeNumber: "625" }, replacementTeamMemberId: rosterIds.get("Phillip Trapp") as number });
    assert.equal(assignmentFor(board, "Phillip Trapp").assignmentLabel, "625");
    assert.equal(assignmentFor(board, "Dennis Davis").assignmentLabel, "BC");
    assert.equal(assignmentFor(board, "Brandon Vickers").assignmentLabel, "BC");

    board = await swapDailyAssignment({ operationalDate: "2026-10-05", destination: { type: "route", routeNumber: "621" }, replacementTeamMemberId: rosterIds.get("Andrew Kite") as number });
    assert.equal(assignmentFor(board, "Andrew Kite").assignmentLabel, "621");
    assert.equal(assignmentFor(board, "Jay Jones").assignmentLabel, "622", "Route-to-route selection performs a true swap");

    board = await swapDailyAssignment({ operationalDate: "2026-10-05", destination: { type: "route", routeNumber: "621" }, replacementTeamMemberId: rosterIds.get("Sarah Example") as number });
    assert.equal(assignmentFor(board, "Sarah Example").assignmentLabel, "621");
    assert.equal(assignmentFor(board, "Andrew Kite").assignmentLabel, "Unassigned");
    assert.ok(board.members.filter(member => member.assignmentLabel === "Unassigned").length >= 2, "UNASSIGNED supports multiple Team members");

    const duplicateMembers = await client.execute("SELECT team_member_id, COUNT(*) AS count FROM daily_assignments WHERE operational_date = '2026-10-05' GROUP BY team_member_id HAVING COUNT(*) > 1");
    const duplicateRoutes = await client.execute("SELECT route_id, COUNT(*) AS count FROM daily_assignments WHERE operational_date = '2026-10-05' AND destination_type = 'route' GROUP BY route_id HAVING COUNT(*) > 1");
    assert.equal(duplicateMembers.rows.length, 0, "A Team member cannot occupy two assignments for one date");
    assert.equal(duplicateRoutes.rows.length, 0, "A route cannot have two current occupants");

    board = await restoreMemberToHomebase("2026-10-05", rosterIds.get("Joshua Gallagher") as number);
    assert.equal(assignmentFor(board, "Joshua Gallagher").assignmentLabel, "621", "A single person can be restored to their Homebase assignment");
    assert.equal(assignmentFor(board, "Sarah Example").assignmentLabel, "TBD ROUTE", "Per-person restore swaps the displaced person safely");

    await Promise.all([
      swapDailyAssignment({ operationalDate: "2026-10-05", destination: { type: "route", routeNumber: "622" }, replacementTeamMemberId: rosterIds.get("Andrew Kite") as number }),
      swapDailyAssignment({ operationalDate: "2026-10-05", destination: { type: "route", routeNumber: "622" }, replacementTeamMemberId: rosterIds.get("Sarah Example") as number }),
    ]);
    board = await getDailyAssignmentBoard("2026-10-05");
    assert.equal(assignmentFor(board, "Sarah Example").assignmentLabel, "622", "Concurrent swaps are serialized without losing the final request");
    const concurrentDuplicateMembers = await client.execute("SELECT team_member_id, COUNT(*) AS count FROM daily_assignments WHERE operational_date = '2026-10-05' GROUP BY team_member_id HAVING COUNT(*) > 1");
    const concurrentDuplicateRoutes = await client.execute("SELECT route_id, COUNT(*) AS count FROM daily_assignments WHERE operational_date = '2026-10-05' AND destination_type = 'route' GROUP BY route_id HAVING COUNT(*) > 1");
    assert.equal(concurrentDuplicateMembers.rows.length, 0, "Concurrent swaps preserve one assignment per Team member");
    assert.equal(concurrentDuplicateRoutes.rows.length, 0, "Concurrent swaps preserve one occupant per route");

    const boardBeforeRefresh = board.members.map(member => ({ name: member.name, assignment: member.assignmentLabel }));
    const manualPreservingRefresh = {
      ...noteUpdatedPayload,
      collectedAt: "2026-10-05T00:30:00.000Z",
      shifts: noteUpdatedPayload.shifts.map((shift, index) => index === 1 ? { ...shift, note: "Homebase changed after manual swaps" } : shift),
    };
    await ingestHomebaseSchedule(homebaseRequest(manualPreservingRefresh, "homebase-server-test-token"));
    board = await getDailyAssignmentBoard("2026-10-05");
    assert.deepEqual(board.members.map(member => ({ name: member.name, assignment: member.assignmentLabel })), boardBeforeRefresh, "Manual overrides survive Homebase re-import");
    const immutableDroAfter = await client.execute({ sql: "SELECT captured_at FROM dro_snapshots WHERE id = ?", args: [staffingSnapshotOne.id] });
    assert.deepEqual(immutableDroAfter.rows, immutableDroBefore.rows, "Homebase ingestion never mutates immutable DRO snapshots");

    board = await resetDailyAssignmentsToHomebase("2026-10-05");
    assert.equal(board.hasManualChanges, false);
    assert.equal(assignmentFor(board, "Joshua Gallagher").assignmentLabel, "621");
    assert.equal(assignmentFor(board, "Jay Jones").assignmentLabel, "TBD ROUTE");
    assert.equal(assignmentFor(board, "Davion Sanderson").assignmentLabel, "625");
    assert.equal(assignmentFor(board, "Phillip Trapp").assignmentLabel, "BC");

    await client.close();
    integrationClient = null;
    await closeDb();
  } finally {
    delete process.env.DATABASE_URL;
    delete process.env.DRO_INGEST_TOKEN;
    delete process.env.MGBA_INGEST_TOKEN;
    delete process.env.HOMEBASE_INGEST_TOKEN;
    delete process.env.KVC_CREDENTIAL_MASTER_KEY;
    delete process.env.ISSUE_UPLOAD_ROOT;
    if (integrationClient) {
      try { await integrationClient.close(); } catch { /* best-effort test cleanup */ }
    }
    const { closeDb: closeApplicationDb } = await import("../db/index");
    await closeApplicationDb().catch(() => undefined);
    await rm(temporaryDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
