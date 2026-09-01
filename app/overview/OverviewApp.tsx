"use client";
/* eslint-disable @next/next/no-html-link-for-pages -- full reloads avoid unreliable client navigation in the LXC Vinext runtime */

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "../components/AppShell";
import { routeTextColor } from "../routes/config";
import { useRouteColors } from "../routes/useRouteColors";
import { DRO_OVERVIEW_LINKS } from "./dro-links";

type OpenIssue = { id: number; vehicleId: number; vehicleNumber: string; routeNumber: string | null; type: string; notes: string; serviceScheduled: boolean; createdAt: string };
type DroSummary = { snapshotId: number; operationalDate: string; capturedAt: string; routeCount: number; totalPackages: number; totalStops: number; capacityWarnings: number };
type OverviewData = { vehicleCount: number; teamCount: number; openIssues: OpenIssue[]; droSummary: DroSummary | null };

function formatMetric(value: number | undefined, loading: boolean) {
  if (loading) return "…";
  return value === undefined ? "—" : value.toLocaleString();
}

export function OverviewApp() {
  const { colorFor } = useRouteColors();
  const [data, setData] = useState<OverviewData>({ vehicleCount: 0, teamCount: 0, openIssues: [], droSummary: null });
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/overview").then(async response => ({ response, body: await response.json() }))
      .then(({ response, body }) => {
        if (cancelled) return;
        if (response.ok) setData(body);
        else setError(body.error || "Could not load the overview.");
      }).catch(() => { if (!cancelled) setError("Could not connect to fleet data."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const visibleIssues = useMemo(() => {
    const query = search.trim().toLowerCase();
    return data.openIssues.filter(issue => `${issue.vehicleNumber} ${issue.routeNumber || ""} ${issue.type} ${issue.notes}`.toLowerCase().includes(query));
  }, [data.openIssues, search]);

  const droDescription = data.droSummary ? "Latest successful snapshot" : "No DRO snapshot available";

  return <AppShell active="overview">
    <header className="topbar"><div><p className="eyebrow">KVC OPERATIONS</p><h1>Overview</h1><p className="page-intro">A quick look at the fleet, routes, team, and issues needing attention.</p></div></header>
    {error && <div className="error-banner" role="alert">{error}</div>}
    <div className="overview-section-heading"><p className="eyebrow">ROUTE OPERATIONS</p><span>Latest available successful DRO snapshot</span></div>
    <section className="stats overview-dro-stats" aria-label="Latest DRO operations summary">
      <a className="stat-link dro-stat-link" href={DRO_OVERVIEW_LINKS.routes}><article><span className="stat-icon green">↗</span><div><small>ROUTES</small><strong>{formatMetric(data.droSummary?.routeCount, loading)}</strong><p>{droDescription}</p></div><b className="stat-navigation-arrow">→</b></article></a>
      <a className="stat-link dro-stat-link" href={DRO_OVERVIEW_LINKS.packages}><article><span className="stat-icon blue">▦</span><div><small>PACKAGES</small><strong>{formatMetric(data.droSummary?.totalPackages, loading)}</strong><p>{droDescription}</p></div><b className="stat-navigation-arrow">→</b></article></a>
      <a className="stat-link dro-stat-link" href={DRO_OVERVIEW_LINKS.stops}><article><span className="stat-icon green">◎</span><div><small>STOPS</small><strong>{formatMetric(data.droSummary?.totalStops, loading)}</strong><p>{droDescription}</p></div><b className="stat-navigation-arrow">→</b></article></a>
      <a className="stat-link dro-stat-link" href={DRO_OVERVIEW_LINKS.capacityWarnings}><article><span className="stat-icon amber">!</span><div><small>CAPACITY WARNINGS</small><strong>{formatMetric(data.droSummary?.capacityWarnings, loading)}</strong><p>{droDescription}</p></div><b className="stat-navigation-arrow">→</b></article></a>
    </section>
    <div className="overview-section-heading"><p className="eyebrow">FLEET</p></div>
    <section className="stats overview-fleet-stats" aria-label="Fleet summary">
      <a className="stat-link" href="/vehicles/issues"><article><span className="stat-icon amber">!</span><div><small>OPEN VEHICLE ISSUES</small><strong>{data.openIssues.length}</strong><p>Items needing attention</p></div></article></a>
      <a className="stat-link" href="/"><article><span className="stat-icon green">▣</span><div><small>VEHICLES</small><strong>{data.vehicleCount}</strong><p>Trucks in the fleet</p></div></article></a>
      <a className="stat-link" href="/team"><article><span className="stat-icon blue">◎</span><div><small>TEAM MEMBERS</small><strong>{data.teamCount}</strong><p>People on the roster</p></div></article></a>
    </section>
    <section className="fleet-card" id="open-issues">
      <div className="fleet-head"><div><h2>Open issue tickets</h2><p>Search and jump directly to the vehicle that needs attention.</p></div><label className="search">⌕ <input value={search} onChange={event => setSearch(event.target.value)} aria-label="Search open issues" placeholder="Search truck, route, or issue" /></label></div>
      <div className="overview-issues">
        {loading ? <div className="empty">Loading issues…</div> : visibleIssues.length === 0 ? <div className="empty">{data.openIssues.length ? "No issues match your search." : "There are no open issues."}</div> : visibleIssues.map(issue => <a className="overview-issue" href={`/vehicles/${encodeURIComponent(issue.vehicleNumber)}`} key={issue.id}>
          <span className="issue-type">{issue.type.charAt(0)}</span><div><div><strong>Vehicle #{issue.vehicleNumber}</strong>{issue.routeNumber && <span className="overview-route-badge" style={{ backgroundColor: colorFor(issue.routeNumber), color: routeTextColor(colorFor(issue.routeNumber)) }}>Route {issue.routeNumber}</span>}{issue.serviceScheduled && <span className="scheduled-badge">Service scheduled</span>}</div><p>{issue.notes}</p><small>{issue.type} · {new Date(issue.createdAt).toLocaleDateString()}</small></div><b>→</b>
        </a>)}
      </div>
      <footer className="table-foot"><span>{visibleIssues.length} open issue{visibleIssues.length === 1 ? "" : "s"}</span><span>Newest first</span></footer>
    </section>
  </AppShell>;
}
