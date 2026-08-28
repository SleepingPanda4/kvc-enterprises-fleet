"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "../components/AppShell";
import { routeTextColor } from "../routes/config";
import { useRouteColors } from "../routes/useRouteColors";

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

async function requestDroData(): Promise<DroResponse> {
  const response = await fetch("/api/dro/latest", { cache: "no-store" });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "The latest DRO snapshot could not be loaded.");
  return { snapshot: body.snapshot || null, rows: body.rows || [] };
}

function formatTimestamp(value: string | null) {
  if (!value) return "Not provided";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatOperationalDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function formatNumber(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value);
}

export default function DroPage() {
  const { colorFor } = useRouteColors();
  const [data, setData] = useState<DroResponse>({ snapshot: null, rows: [] });
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await requestDroData());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not connect to DRO data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const result = await requestDroData();
        if (!cancelled) { setData(result); setError(""); }
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Could not connect to DRO data.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void refresh();
    const refreshTimer = window.setInterval(() => void refresh(), 60_000);
    return () => { cancelled = true; window.clearInterval(refreshTimer); };
  }, []);

  const visibleRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return data.rows;
    return data.rows.filter(row => `${row.routeNumber || row.registeredRouteNumber || ""} ${row.rawWaNumber} ${row.displayWaNumber || ""} ${row.routeType || ""}`.toLowerCase().includes(query));
  }, [data.rows, search]);

  const totals = useMemo(() => ({
    packages: data.rows.reduce((sum, row) => sum + row.totalPackages, 0),
    stops: data.rows.reduce((sum, row) => sum + row.totalStops, 0),
    warnings: data.rows.filter(row => row.warning).length,
  }), [data.rows]);

  const snapshot = data.snapshot;

  return <AppShell active="dro">
    <header className="topbar">
      <div><p className="eyebrow">DAILY ROUTE OPERATIONS</p><h1>DRO</h1><p className="page-intro">The latest route plan received from the KVC node workers.</p></div>
      <div className="header-actions"><button type="button" className="secondary" disabled={loading} onClick={() => void loadData()}>{loading ? "Refreshing…" : "↻ Refresh"}</button></div>
    </header>
    {error && <div className="error-banner" role="alert">{error}<button onClick={() => setError("")} aria-label="Dismiss error">×</button></div>}

    {!snapshot && !loading ? <section className="fleet-card dro-empty-state">
      <span>▤</span><h2>Waiting for DRO data</h2><p>Routes will appear here automatically after a node worker saves the first DRO snapshot.</p><button type="button" className="secondary" onClick={() => void loadData()}>Check again</button>
    </section> : <>
      <section className="dro-snapshot-bar" aria-label="Latest DRO snapshot">
        <div><small>OPERATIONAL DATE</small><strong>{snapshot ? formatOperationalDate(snapshot.operationalDate) : "Loading…"}</strong></div>
        <div><small>STATION / SERVICE AREA</small><strong>{snapshot ? `${snapshot.stationId} / ${snapshot.serviceAreaId}` : "—"}</strong></div>
        <div><small>CAPTURED</small><strong>{snapshot ? formatTimestamp(snapshot.capturedAt) : "—"}</strong></div>
        <span className={`dro-import-status ${snapshot?.status.toLowerCase() === "complete" ? "complete" : "attention"}`}>{snapshot?.status || "Loading"}</span>
      </section>
      {snapshot?.errorMessage && <div className="error-banner" role="alert">Worker message: {snapshot.errorMessage}</div>}

      <section className="dro-summary" aria-label="DRO totals">
        <article><small>ROUTES</small><strong>{data.rows.length}</strong><p>Rows in latest snapshot</p></article>
        <article><small>PACKAGES</small><strong>{formatNumber(totals.packages)}</strong><p>Total delivery, pickup, and combination</p></article>
        <article><small>STOPS</small><strong>{formatNumber(totals.stops)}</strong><p>Total planned stops</p></article>
        <article className={totals.warnings ? "warning" : ""}><small>CAPACITY WARNINGS</small><strong>{totals.warnings}</strong><p>{totals.warnings ? "Routes requiring attention" : "No flagged routes"}</p></article>
      </section>

      <section className="fleet-card dro-routes-card">
        <div className="fleet-head"><div><h2>Route list</h2><p>{snapshot ? `Source timestamp: ${formatTimestamp(snapshot.sourceTimestamp)}` : "Loading the latest route rows."}</p></div><label className="search">⌕ <input value={search} onChange={event => setSearch(event.target.value)} aria-label="Search DRO routes" placeholder="Search route, WA, or type" /></label></div>
        <div className="table-wrap">
          <table className="dro-table">
            <thead><tr><th>ROUTE</th><th>WORK AREA</th><th>CUBE / CAPACITY</th><th>PACKAGES</th><th>STOPS</th><th>ROUTE DETAILS</th><th>STATUS</th></tr></thead>
            <tbody>
              {loading && !snapshot ? <tr><td colSpan={7} className="empty">Loading DRO routes…</td></tr> : visibleRows.length === 0 ? <tr><td colSpan={7} className="empty">{data.rows.length ? "No routes match your search." : "The latest snapshot does not contain route rows."}</td></tr> : visibleRows.map(row => {
                const routeNumber = row.routeNumber || row.registeredRouteNumber;
                const color = colorFor(routeNumber);
                const capacityPercent = row.vehicleCapacity > 0 ? Math.round((row.usedCapacity / row.vehicleCapacity) * 100) : 0;
                return <tr key={row.id} className={row.warning ? "dro-warning-row" : ""}>
                  <td>{routeNumber ? <strong className="route-number-badge" style={{ backgroundColor: color, color: routeTextColor(color) }}>{routeNumber}</strong> : <span className="route-unassigned">Unmapped</span>}</td>
                  <td><div className="dro-cell-stack"><strong>{row.displayWaNumber || row.rawWaNumber}</strong>{row.displayWaNumber && <small>Source: {row.rawWaNumber}</small>}</div></td>
                  <td><div className="dro-capacity"><strong>{formatNumber(row.usedCapacity)} / {formatNumber(row.vehicleCapacity)}</strong><span><i style={{ width: `${Math.min(capacityPercent, 100)}%` }} /></span><small>{formatNumber(row.deliveryCube)} del · {formatNumber(row.pickupCube)} p/u · {formatNumber(row.combinationCube)} combo</small></div></td>
                  <td><div className="dro-cell-stack"><strong>{formatNumber(row.totalPackages)}</strong><small>{row.deliveryPackages} del · {row.pickupPackages} p/u · {row.combinationPackages} combo</small></div></td>
                  <td><div className="dro-cell-stack"><strong>{formatNumber(row.totalStops)}</strong><small>{row.deliveryStops} del · {row.pickupStops} p/u · {row.combinationStops} combo</small></div></td>
                  <td><div className="dro-cell-stack"><strong>{row.routeType || "Not provided"}</strong><small>{row.routeTime || "No route time"}{row.distance !== null ? ` · ${formatNumber(row.distance)} mi` : ""}</small></div></td>
                  <td>{row.warning ? <span className="dro-warning-badge">! Capacity</span> : <span className="dro-normal-badge">Normal</span>}</td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>
        <footer className="table-foot"><span>{visibleRows.length} of {data.rows.length} route{data.rows.length === 1 ? "" : "s"}</span><span>Refreshes every minute</span></footer>
      </section>
    </>}
  </AppShell>;
}
