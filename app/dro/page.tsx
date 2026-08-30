"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "../auth/AuthGate";
import { AppShell } from "../components/AppShell";
import { routeTextColor } from "../routes/config";
import { useRouteColors } from "../routes/useRouteColors";
import { DroCalendarPicker } from "./DroCalendarPicker";
import { refetchHomebaseAssignments } from "./homebase-refresh";
import { LiveDroRefreshGuard, loadCollectedDroView, requestLiveDroRefresh } from "./live-refresh";
import { selectedDroSnapshot, selectedSnapshotTimestamp } from "./selected-snapshot";
import { compareDroRouteNumbers, getNextDroSort, parseDroSortParams, type DroSortConfig, type DroSortKey } from "./sorting";
import { capacityUtilization, hasCapacityWarning } from "../../services/integrations/dro-calculations";
import { DRO_REFRESH_WINDOW_MESSAGE, isDroManualRefreshAllowed } from "../../services/integrations/dro-operational-date";
import { selectDroRouteRow, selectedDroRouteRowId, type DroRouteSelection } from "./row-selection";

type DroSnapshot = {
  id: number;
  operationalDate: string;
  capturedAt: string;
  sourceTimestamp: string | null;
  stationId: string;
  serviceAreaId: string;
  status: string;
  errorMessage: string | null;
};

type DroRouteRow = {
  id: number;
  routeNumber: string | null;
  registeredRouteNumber: string | null;
  rawWaNumber: string;
  displayWaNumber: string | null;
  deliveryCube: number;
  pickupCube: number;
  combinationCube: number;
  usedCapacity: number;
  vehicleCapacity: number;
  deliveryPackages: number;
  pickupPackages: number;
  combinationPackages: number;
  totalPackages: number;
  deliveryStops: number;
  pickupStops: number;
  combinationStops: number;
  totalStops: number;
  routeType: string | null;
  routeTime: string | null;
  distance: number | null;
  warning: boolean;
};

type DroResponse = { snapshot: DroSnapshot | null; rows: DroRouteRow[] };
type DroDateSummary = { operationalDate: string; snapshotCount: number; latestCapturedAt: string };
type DroDateIndex = { dates: DroDateSummary[]; latestDate: string | null };
type DroDateResponse = {
  operationalDate: string;
  snapshots: DroSnapshot[];
  previousDate: string | null;
  nextDate: string | null;
  latestDate: string | null;
};
type DroDateBundle = { dateInfo: DroDateResponse; data: DroResponse; snapshotId: number | null };
type AssignmentDestination =
  | { type: "route"; routeNumber: string }
  | { type: "special"; specialAssignment: string }
  | { type: "unassigned" };
type AssignmentMember = {
  teamMemberId: number;
  name: string;
  destination: AssignmentDestination;
  assignmentLabel: string;
  source: "homebase" | "manual";
  homebase: { rawAssignment: string; destination: AssignmentDestination } | null;
};
type AssignmentBoard = {
  operationalDate: string;
  hasHomebaseData: boolean;
  hasManualChanges: boolean;
  members: AssignmentMember[];
  unmatchedHomebase: Array<{ shiftId: string; employeeDisplayName: string; rawAssignment: string }>;
};

async function requestJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "DRO data could not be loaded.");
  return body as T;
}

async function requestDateBundle(operationalDate: string, preferredSnapshotId: number | null = null): Promise<DroDateBundle> {
  const dateInfo = await requestJson<DroDateResponse>(`/api/dro/date?date=${encodeURIComponent(operationalDate)}`);
  const preferredExists = preferredSnapshotId !== null && dateInfo.snapshots.some(snapshot => snapshot.id === preferredSnapshotId);
  const snapshotId = preferredExists ? preferredSnapshotId : dateInfo.snapshots[0]?.id || null;
  const data = snapshotId === null
    ? { snapshot: null, rows: [] }
    : await requestJson<DroResponse>(`/api/dro/snapshot?id=${snapshotId}`);
  return { dateInfo, data, snapshotId };
}

async function requestAssignmentBoard(operationalDate: string) {
  return requestJson<{ board: AssignmentBoard }>(`/api/dro/assignments?date=${encodeURIComponent(operationalDate)}`);
}

function formatTimestamp(value: string | null) {
  if (!value) return "Not provided";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined, {
    timeZone: "America/Chicago", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
  });
}

function formatCaptureTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString(undefined, {
    timeZone: "America/Chicago", hour: "numeric", minute: "2-digit", timeZoneName: "short",
  });
}

function formatOperationalDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day, 12);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", year: "numeric" });
}

function formatNumber(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value);
}

export default function DroPage() {
  const { user } = useAuth();
  const { colorFor } = useRouteColors();
  const requestedSort = parseDroSortParams(useSearchParams());
  const [data, setData] = useState<DroResponse>({ snapshot: null, rows: [] });
  const [dateIndex, setDateIndex] = useState<DroDateIndex>({ dates: [], latestDate: null });
  const [dateInfo, setDateInfo] = useState<DroDateResponse | null>(null);
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<number | null>(null);
  const [routeSelection, setRouteSelection] = useState<DroRouteSelection | null>(null);
  const [followLatestSnapshot, setFollowLatestSnapshot] = useState(true);
  const [search, setSearch] = useState("");
  const [manualSort, setManualSort] = useState<DroSortConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [collecting, setCollecting] = useState(false);
  const [refreshClock, setRefreshClock] = useState(() => new Date());
  const [refetchingAssignments, setRefetchingAssignments] = useState(false);
  const [assignmentBoard, setAssignmentBoard] = useState<AssignmentBoard | null>(null);
  const [assignmentsLoading, setAssignmentsLoading] = useState(false);
  const [savingAssignment, setSavingAssignment] = useState("");
  const [assignmentError, setAssignmentError] = useState("");
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const collectionGuard = useRef(new LiveDroRefreshGuard());
  const assignmentCollectionGuard = useRef(new LiveDroRefreshGuard());
  const snapshotRequest = useRef(0);
  const selectedDateRef = useRef(selectedDate);
  const { key: sortKey, direction: sortDirection } = manualSort || requestedSort;
  const canManage = user?.role === "Fleet Manager";

  useEffect(() => {
    let cancelled = false;
    async function initialize() {
      try {
        const index = await requestJson<DroDateIndex>("/api/dro/dates");
        const bundle = index.latestDate ? await requestDateBundle(index.latestDate) : null;
        if (cancelled) return;
        setDateIndex(index);
        setSelectedDate(index.latestDate || "");
        setDateInfo(bundle?.dateInfo || null);
        setSelectedSnapshotId(bundle?.snapshotId || null);
        setData(bundle?.data || { snapshot: null, rows: [] });
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Could not connect to DRO data.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void initialize();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    selectedDateRef.current = selectedDate;
  }, [selectedDate]);

  useEffect(() => {
    const refreshClockTimer = window.setInterval(() => setRefreshClock(new Date()), 1000);
    return () => window.clearInterval(refreshClockTimer);
  }, []);

  useEffect(() => {
    if (!selectedDate || selectedDate !== dateIndex.latestDate) return;
    let cancelled = false;
    const refreshTimer = window.setInterval(async () => {
      try {
        const nextIndex = await requestJson<DroDateIndex>("/api/dro/dates");
        const targetDate = nextIndex.latestDate || selectedDate;
        const preferredSnapshot = !followLatestSnapshot && targetDate === selectedDate ? selectedSnapshotId : null;
        const bundle = await requestDateBundle(targetDate, preferredSnapshot);
        if (cancelled) return;
        setDateIndex(nextIndex);
        setSelectedDate(targetDate);
        setDateInfo(bundle.dateInfo);
        setSelectedSnapshotId(bundle.snapshotId);
        setData(bundle.data);
        setError("");
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Could not refresh DRO data.");
      }
    }, 60_000);
    return () => { cancelled = true; window.clearInterval(refreshTimer); };
  }, [dateIndex.latestDate, followLatestSnapshot, selectedDate, selectedSnapshotId]);

  useEffect(() => {
    if (!selectedDate) return;
    let cancelled = false;
    async function loadAssignments() {
      setAssignmentsLoading(true);
      setAssignmentError("");
      try {
        const result = await requestAssignmentBoard(selectedDate);
        if (!cancelled) setAssignmentBoard(result.board);
      } catch (loadError) {
        if (!cancelled) {
          setAssignmentBoard(null);
          setAssignmentError(loadError instanceof Error ? loadError.message : "Assignments could not be loaded.");
        }
      } finally {
        if (!cancelled) setAssignmentsLoading(false);
      }
    }
    void loadAssignments();
    return () => { cancelled = true; };
  }, [selectedDate]);

  async function chooseDate(operationalDate: string) {
    if (!operationalDate) return;
    const requestId = ++snapshotRequest.current;
    setLoading(true);
    setError("");
    setFollowLatestSnapshot(true);
    try {
      const bundle = await requestDateBundle(operationalDate);
      if (requestId !== snapshotRequest.current) return;
      setSelectedDate(operationalDate);
      setDateInfo(bundle.dateInfo);
      setSelectedSnapshotId(bundle.snapshotId);
      setData(bundle.data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load that operational date.");
    } finally {
      setLoading(false);
    }
  }

  async function chooseSnapshot(snapshotId: number) {
    const requestId = ++snapshotRequest.current;
    setLoading(true);
    setError("");
    setSelectedSnapshotId(snapshotId);
    setData({ snapshot: null, rows: [] });
    try {
      const snapshotData = await requestJson<DroResponse>(`/api/dro/snapshot?id=${snapshotId}`);
      if (requestId !== snapshotRequest.current) return;
      if (snapshotData.snapshot?.id !== snapshotId) throw new Error("The selected DRO snapshot could not be loaded.");
      setFollowLatestSnapshot(snapshotId === dateInfo?.snapshots[0]?.id);
      setData(snapshotData);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load that snapshot.");
    } finally {
      setLoading(false);
    }
  }

  async function reloadStoredData() {
    setLoading(true);
    setError("");
    try {
      const nextIndex = await requestJson<DroDateIndex>("/api/dro/dates");
      const wasFollowingNewestDate = !selectedDate || selectedDate === dateIndex.latestDate;
      const targetDate = wasFollowingNewestDate ? nextIndex.latestDate : selectedDate;
      const preferredSnapshot = !followLatestSnapshot && targetDate === selectedDate ? selectedSnapshotId : null;
      const bundle = targetDate ? await requestDateBundle(targetDate, preferredSnapshot) : null;
      setDateIndex(nextIndex);
      setSelectedDate(targetDate || "");
      setDateInfo(bundle?.dateInfo || null);
      setSelectedSnapshotId(bundle?.snapshotId || null);
      setData(bundle?.data || { snapshot: null, rows: [] });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not refresh DRO data.");
    } finally {
      setLoading(false);
    }
  }

  async function collectLiveDro() {
    if (!canManage || !isDroManualRefreshAllowed(refreshClock)) return;
    await collectionGuard.current.run(async () => {
      setCollecting(true);
      setError("");
      setStatusMessage("");
      try {
        const result = await requestLiveDroRefresh();
        const view = await loadCollectedDroView<DroDateIndex, DroDateResponse, DroResponse>(result, requestJson);
        setDateIndex(view.dateIndex);
        setSelectedDate(view.selectedDate);
        setDateInfo(view.dateInfo);
        setSelectedSnapshotId(view.selectedSnapshotId);
        setFollowLatestSnapshot(view.dateInfo.snapshots[0]?.id === view.selectedSnapshotId);
        setData(view.data);
        if (result.deduplicated) setStatusMessage("DRO is already up to date.");
      } catch (collectionError) {
        setError(collectionError instanceof Error ? collectionError.message : "DRO collection could not be completed.");
      } finally {
        setCollecting(false);
      }
    });
  }

  async function refetchAssignments() {
    if (!canManage || !selectedDate || savingAssignment || refetchingAssignments) return;
    const operationalDate = selectedDate;
    await assignmentCollectionGuard.current.run(async () => {
      setRefetchingAssignments(true);
      setAssignmentError("");
      setStatusMessage("");
      try {
        const result = await refetchHomebaseAssignments<{ board: AssignmentBoard }>(operationalDate, requestJson);
        if (selectedDateRef.current === operationalDate) setAssignmentBoard(result.board);
        setStatusMessage("Assignments were refreshed from Homebase.");
      } catch (collectionError) {
        setAssignmentError(collectionError instanceof Error ? collectionError.message : "Homebase assignments could not be refreshed.");
      } finally {
        setRefetchingAssignments(false);
      }
    });
  }

  async function swapAssignment(destination: AssignmentDestination, replacementTeamMemberId: number, replacedTeamMemberId?: number) {
    if (!canManage || !selectedDate || savingAssignment || refetchingAssignments) return;
    const saveKey = destination.type === "route" ? `route:${destination.routeNumber}` : `member:${replacedTeamMemberId || replacementTeamMemberId}`;
    setSavingAssignment(saveKey);
    setAssignmentError("");
    try {
      const response = await fetch("/api/dro/assignments/swap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operationalDate: selectedDate, destination, replacementTeamMemberId, replacedTeamMemberId }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "That assignment could not be changed.");
      setAssignmentBoard(body.board);
    } catch (saveError) {
      setAssignmentError(saveError instanceof Error ? saveError.message : "That assignment could not be changed.");
    } finally {
      setSavingAssignment("");
    }
  }

  async function resetAssignments() {
    if (!canManage || !selectedDate || savingAssignment || refetchingAssignments) return;
    if (assignmentBoard?.hasManualChanges && !window.confirm("Reset all assignments for this date to the current Homebase schedule? Manual changes will be discarded.")) return;
    setSavingAssignment("reset");
    setAssignmentError("");
    try {
      const response = await fetch("/api/dro/assignments/reset", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operationalDate: selectedDate }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Assignments could not be reset.");
      setAssignmentBoard(body.board);
    } catch (saveError) {
      setAssignmentError(saveError instanceof Error ? saveError.message : "Assignments could not be reset.");
    } finally {
      setSavingAssignment("");
    }
  }

  async function restoreHomebase(teamMemberId: number) {
    if (!canManage || !selectedDate || savingAssignment || refetchingAssignments) return;
    setSavingAssignment(`restore:${teamMemberId}`);
    setAssignmentError("");
    try {
      const response = await fetch("/api/dro/assignments/restore", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operationalDate: selectedDate, teamMemberId }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "The Homebase assignment could not be restored.");
      setAssignmentBoard(body.board);
    } catch (saveError) {
      setAssignmentError(saveError instanceof Error ? saveError.message : "The Homebase assignment could not be restored.");
    } finally {
      setSavingAssignment("");
    }
  }

  const driverByRoute = useMemo(() => new Map((assignmentBoard?.members || [])
    .filter(member => member.destination.type === "route")
    .map(member => [(member.destination as { type: "route"; routeNumber: string }).routeNumber, member])), [assignmentBoard]);

  const snapshot = selectedDroSnapshot(selectedSnapshotId, data.snapshot);
  const selectedRows = useMemo(() => snapshot ? data.rows : [], [data.rows, snapshot]);
  const selectedRouteRowId = selectedDroRouteRowId(routeSelection, selectedDate, selectedSnapshotId);

  const visibleRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filteredRows = query
      ? selectedRows.filter(row => {
        const routeNumber = row.routeNumber || row.registeredRouteNumber || "";
        return `${routeNumber} ${driverByRoute.get(routeNumber)?.name || ""} ${row.rawWaNumber} ${row.displayWaNumber || ""} ${row.routeType || ""}`.toLowerCase().includes(query);
      })
      : selectedRows;
    return [...filteredRows].sort((left, right) => {
      if (sortKey === "route") return compareDroRouteNumbers(left.routeNumber || left.registeredRouteNumber, right.routeNumber || right.registeredRouteNumber, sortDirection);
      const leftValue = sortKey === "capacity" ? left.usedCapacity : sortKey === "packages" ? left.totalPackages : left.totalStops;
      const rightValue = sortKey === "capacity" ? right.usedCapacity : sortKey === "packages" ? right.totalPackages : right.totalStops;
      const difference = leftValue - rightValue;
      return sortDirection === "asc" ? difference : -difference;
    });
  }, [driverByRoute, search, selectedRows, sortDirection, sortKey]);

  function changeSort(nextSortKey: DroSortKey) {
    setManualSort(getNextDroSort({ key: sortKey, direction: sortDirection }, nextSortKey));
  }

  function sortIndicator(key: DroSortKey) {
    return key === sortKey ? <span className="dro-sort-indicator" aria-hidden="true">{sortDirection === "asc" ? "↑" : "↓"}</span> : null;
  }

  const totals = useMemo(() => ({
    packages: selectedRows.reduce((sum, row) => sum + row.totalPackages, 0),
    stops: selectedRows.reduce((sum, row) => sum + row.totalStops, 0),
    warnings: selectedRows.filter(row => hasCapacityWarning(row.usedCapacity, row.vehicleCapacity)).length,
  }), [selectedRows]);
  const isLatestDate = Boolean(selectedDate && selectedDate === dateIndex.latestDate);
  const specialNames = ["BC", "TBD ROUTE", "ON CALL AT HOME"];
  const extraSpecialNames = [...new Set((assignmentBoard?.members || [])
    .filter(member => member.destination.type === "special")
    .map(member => (member.destination as { type: "special"; specialAssignment: string }).specialAssignment)
    .filter(name => !specialNames.includes(name)))].sort();
  const assignmentBuckets = [...specialNames, ...extraSpecialNames, "UNASSIGNED"].map(name => ({
    name,
    members: (assignmentBoard?.members || []).filter(member => name === "UNASSIGNED"
      ? member.destination.type === "unassigned"
      : member.destination.type === "special" && member.destination.specialAssignment === name),
  }));
  const manualRefreshAllowed = isDroManualRefreshAllowed(refreshClock);

  return <AppShell active="dro">
    <header className="topbar dro-topbar">
      <div><p className="eyebrow">DAILY ROUTE OPERATIONS</p><h1>DRO</h1><p className="page-intro">Browse route plans by operational date and node-worker snapshot.</p></div>
      {canManage && <div className="header-actions"><button type="button" className="secondary" title={manualRefreshAllowed ? "Collect a DRO snapshot now" : DRO_REFRESH_WINDOW_MESSAGE} disabled={loading || collecting || !manualRefreshAllowed} onClick={() => void collectLiveDro()}>{collecting ? "Collecting…" : "↻ Refresh"}</button>{!manualRefreshAllowed && <small className="dro-refresh-window">DRO refresh available 8:00 PM–11:59 PM CT</small>}</div>}
    </header>
    {error && <div className="error-banner" role="alert">{error}<button onClick={() => setError("")} aria-label="Dismiss error">×</button></div>}
    {assignmentError && <div className="error-banner" role="alert">{assignmentError}<button onClick={() => setAssignmentError("")} aria-label="Dismiss assignment error">×</button></div>}
    {statusMessage && <div className="success-banner" role="status">{statusMessage}</div>}

    {(selectedDate || dateIndex.latestDate) && <section className="dro-history-controls" aria-label="DRO operational date navigation">
      <div className="dro-history-left">
        <button type="button" className="secondary" disabled={loading || !dateInfo?.previousDate} onClick={() => dateInfo?.previousDate && void chooseDate(dateInfo.previousDate)}>← Previous Day</button>
        <DroCalendarPicker availableDates={dateIndex.dates.map(item => item.operationalDate)} selectedDate={selectedDate} loading={loading} onSelect={date => void chooseDate(date)} />
      </div>
      <strong className="dro-date-center">{selectedDate ? formatOperationalDate(selectedDate) : "Choose an operational date"}</strong>
      <div className="dro-history-right">
        <label className="dro-history-snapshot"><span>Snapshot</span><select value={selectedSnapshotId || ""} disabled={loading || !dateInfo?.snapshots.length} onChange={event => void chooseSnapshot(Number(event.target.value))}>{dateInfo?.snapshots.map(item => <option key={item.id} value={item.id}>{formatCaptureTime(item.capturedAt)}</option>)}</select></label>
        <button type="button" className="secondary" disabled={loading || !dateInfo?.nextDate} onClick={() => dateInfo?.nextDate && void chooseDate(dateInfo.nextDate)}>Next Day →</button>
      </div>
    </section>}

    {!snapshot && !loading ? <section className="fleet-card dro-empty-state">
      <span>▤</span><h2>{selectedDate ? `No DRO data for ${formatOperationalDate(selectedDate)}` : "Waiting for DRO data"}</h2><p>{selectedDate ? "No snapshots were collected for this operational date. Use Previous Day, Next Day, or the calendar to choose another date." : "Routes will appear here automatically after a node worker saves the first DRO snapshot."}</p>{dateIndex.latestDate && selectedDate !== dateIndex.latestDate ? <button type="button" className="secondary" onClick={() => void chooseDate(dateIndex.latestDate as string)}>Return to latest date</button> : canManage ? <button type="button" className="secondary" title={manualRefreshAllowed ? "Collect a DRO snapshot now" : DRO_REFRESH_WINDOW_MESSAGE} disabled={collecting || !manualRefreshAllowed} onClick={() => void collectLiveDro()}>{collecting ? "Collecting…" : "Collect DRO now"}</button> : <button type="button" className="secondary" onClick={() => void reloadStoredData()}>Check again</button>}
    </section> : <>
      {snapshot?.errorMessage && <div className="error-banner" role="alert">Worker message: {snapshot.errorMessage}</div>}

      <section className="dro-summary" aria-label="DRO totals">
        <article><small>ROUTES</small><strong>{selectedRows.length}</strong><p>Rows in selected snapshot</p></article>
        <article><small>PACKAGES</small><strong>{formatNumber(totals.packages)}</strong><p>Total delivery, pickup, and combination</p></article>
        <article><small>STOPS</small><strong>{formatNumber(totals.stops)}</strong><p>Total planned stops</p></article>
        <article className={totals.warnings ? "warning" : ""}><small>CAPACITY WARNINGS</small><strong>{totals.warnings}</strong><p>{totals.warnings ? "Routes requiring attention" : "No flagged routes"}</p></article>
      </section>

      <div className="dro-board-grid">
      <section className="fleet-card dro-routes-card">
        <div className="fleet-head"><div><h2>Route list</h2><p>{snapshot ? `Source timestamp: ${formatTimestamp(selectedSnapshotTimestamp(snapshot))}` : "Loading the selected route rows."}</p></div><label className="search">⌕ <input value={search} onChange={event => setSearch(event.target.value)} aria-label="Search DRO routes" placeholder="Search route, WA, or type" /></label></div>
        <div className="table-wrap">
          <table className="dro-table">
            <colgroup><col className="dro-driver-column" /><col className="dro-route-column" /><col className="dro-capacity-column" /><col className="dro-packages-column" /><col className="dro-stops-column" /><col className="dro-details-column" /></colgroup>
            <thead><tr>
              <th>DRIVER</th>
              <th aria-sort={sortKey === "route" ? sortDirection === "asc" ? "ascending" : "descending" : "none"}><button type="button" className="dro-sort-button" onClick={() => changeSort("route")}>ROUTE {sortIndicator("route")}</button></th>
              <th aria-sort={sortKey === "capacity" ? sortDirection === "asc" ? "ascending" : "descending" : "none"}><button type="button" className="dro-sort-button" onClick={() => changeSort("capacity")}>CUBE / CAPACITY {sortIndicator("capacity")}</button></th>
              <th aria-sort={sortKey === "packages" ? sortDirection === "asc" ? "ascending" : "descending" : "none"}><button type="button" className="dro-sort-button" onClick={() => changeSort("packages")}>PACKAGES {sortIndicator("packages")}</button></th>
              <th aria-sort={sortKey === "stops" ? sortDirection === "asc" ? "ascending" : "descending" : "none"}><button type="button" className="dro-sort-button" onClick={() => changeSort("stops")}><span className="dro-stops-heading"><span>STOPS {sortIndicator("stops")}</span><small>Total | PU | Combo</small></span></button></th>
              <th>ROUTE DETAILS</th>
            </tr></thead>
            <tbody>
              {loading && !snapshot ? <tr><td colSpan={6} className="empty">Loading DRO routes…</td></tr> : visibleRows.length === 0 ? <tr><td colSpan={6} className="empty">{selectedRows.length ? "No routes match your search." : "The selected snapshot does not contain route rows."}</td></tr> : visibleRows.map(row => {
                const routeNumber = row.routeNumber || row.registeredRouteNumber;
                const driver = routeNumber ? driverByRoute.get(routeNumber) : undefined;
                const color = colorFor(routeNumber);
                const utilization = capacityUtilization(row.usedCapacity, row.vehicleCapacity);
                const capacityPercent = utilization === null ? 0 : Math.max(0, utilization * 100);
                const capacityWarning = hasCapacityWarning(row.usedCapacity, row.vehicleCapacity);
                const rowClassName = [capacityWarning ? "dro-warning-row" : "", selectedRouteRowId === row.id ? "dro-route-selected" : ""].filter(Boolean).join(" ");
                return <tr key={row.id} className={rowClassName} aria-selected={selectedRouteRowId === row.id} onClick={() => setRouteSelection(selectDroRouteRow(row.id, selectedDate, selectedSnapshotId))}>
                  <td>{canManage && routeNumber ? <select className="dro-driver-select" aria-label={`Driver for route ${routeNumber}`} value={driver?.teamMemberId || ""} disabled={Boolean(savingAssignment) || assignmentsLoading || refetchingAssignments} title={driver?.homebase ? `Homebase: ${driver.homebase.rawAssignment}` : "No Homebase assignment"} onChange={event => void swapAssignment({ type: "route", routeNumber }, Number(event.target.value), driver?.teamMemberId)}><option value="" disabled>{assignmentsLoading ? "Loading assignments…" : "Unassigned"}</option>{assignmentBoard?.members.map(member => <option key={member.teamMemberId} value={member.teamMemberId}>{member.teamMemberId === driver?.teamMemberId ? member.name : `${member.name} — ${member.assignmentLabel}`}</option>)}</select> : <strong className="dro-driver-name" title={driver?.homebase ? `Homebase: ${driver.homebase.rawAssignment}` : undefined}>{assignmentsLoading ? "Loading assignments…" : driver?.name || "Unassigned"}</strong>}</td>
                  <td><span className="dro-driver-route-meta">{routeNumber ? <strong className="route-number-badge" style={{ backgroundColor: color, color: routeTextColor(color) }}>{routeNumber}</strong> : <span className="route-unassigned">Unmapped</span>}{driver?.source === "manual" && <span className="assignment-source" title={`Homebase: ${driver.homebase?.rawAssignment || "not assigned"}`}>Manual</span>}{canManage && driver?.source === "manual" && driver.homebase && <button type="button" className="restore-homebase" disabled={Boolean(savingAssignment) || refetchingAssignments} title={`Use Homebase assignment: ${driver.homebase.rawAssignment}`} onClick={() => void restoreHomebase(driver.teamMemberId)}>↺</button>}</span></td>
                  <td><div className="dro-capacity"><strong>{formatNumber(row.usedCapacity)} / {formatNumber(row.vehicleCapacity)}</strong><span aria-hidden="true"><i style={{ width: `${Math.min(capacityPercent, 100)}%` }} /></span>{capacityWarning && <span className="sr-only">Capacity warning</span>}</div></td>
                  <td><strong className="dro-primary-value">{formatNumber(row.totalPackages)}</strong></td>
                  <td><div className="dro-stop-values" aria-label={`${row.totalStops} total stops, ${row.pickupStops} pickup stops, ${row.combinationStops} combination stops`}><strong>{row.totalStops}</strong><span>|</span><strong>{row.pickupStops}</strong><span>|</span><strong>{row.combinationStops}</strong></div></td>
                  <td><div className="dro-route-details"><strong>{row.routeTime || "—"}</strong><span>•</span><strong>{row.distance !== null ? `${formatNumber(row.distance)} mi` : "—"}</strong></div></td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>
        <footer className="table-foot"><span>{visibleRows.length} of {selectedRows.length} route{selectedRows.length === 1 ? "" : "s"}</span><span>{isLatestDate ? "Refreshes every minute" : "Historical snapshot"}</span></footer>
      </section>
      <aside className="fleet-card other-assignments-card" aria-label="Other assignments">
        <div className="other-assignments-head"><div><h2>Other assignments</h2><p>{selectedDate ? formatOperationalDate(selectedDate) : "Selected operational date"}</p></div>{canManage && <div className="other-assignment-actions"><button type="button" className="secondary" disabled={Boolean(savingAssignment) || assignmentsLoading || refetchingAssignments} onClick={() => void refetchAssignments()}>{refetchingAssignments ? "Refetching…" : "Refetch Assignments"}</button><button type="button" className="secondary" disabled={Boolean(savingAssignment) || assignmentsLoading || refetchingAssignments || !assignmentBoard?.hasHomebaseData} onClick={() => void resetAssignments()}>{savingAssignment === "reset" ? "Resetting…" : "Reset to Homebase"}</button></div>}</div>
        <div className="other-assignments-body">{assignmentsLoading ? <p className="assignment-panel-state">Loading assignments…</p> : !assignmentBoard ? <p className="assignment-panel-state">Assignments are unavailable.</p> : <>
          {!assignmentBoard.hasHomebaseData && <p className="assignment-panel-note">No Homebase schedule for this date. Team members remain available for manual assignment.</p>}
          <div className="assignment-buckets">{assignmentBuckets.map(bucket => <section className="assignment-bucket" key={bucket.name}><header><strong>{bucket.name}</strong><span>{bucket.members.length}</span></header>{bucket.members.length ? <div className="assignment-people">{bucket.members.map(member => <div className="assignment-person" key={member.teamMemberId}>{canManage ? <select aria-label={`Reassign ${member.name} from ${bucket.name}`} value={member.teamMemberId} disabled={Boolean(savingAssignment) || refetchingAssignments} title={member.homebase ? `Homebase: ${member.homebase.rawAssignment}` : "No Homebase assignment"} onChange={event => void swapAssignment(member.destination, Number(event.target.value), member.teamMemberId)}>{assignmentBoard.members.map(option => <option key={option.teamMemberId} value={option.teamMemberId}>{option.name} — {option.assignmentLabel}</option>)}</select> : <strong title={member.homebase ? `Homebase: ${member.homebase.rawAssignment}` : undefined}>{member.name}</strong>}{member.source === "manual" && <span className="assignment-source">Manual</span>}{canManage && member.source === "manual" && member.homebase && <button type="button" className="restore-homebase" disabled={Boolean(savingAssignment) || refetchingAssignments} title={`Use Homebase assignment: ${member.homebase.rawAssignment}`} onClick={() => void restoreHomebase(member.teamMemberId)}>↺</button>}</div>)}</div> : <p>No team members</p>}</section>)}</div>
          {assignmentBoard.unmatchedHomebase.length > 0 && <details className="unmatched-homebase"><summary>Unmatched Homebase employees ({assignmentBoard.unmatchedHomebase.length})</summary><ul>{assignmentBoard.unmatchedHomebase.map(item => <li key={item.shiftId}>{item.employeeDisplayName} — {item.rawAssignment}</li>)}</ul></details>}
        </>}</div>
      </aside>
      </div>
    </>}
  </AppShell>;
}
