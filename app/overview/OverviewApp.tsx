"use client";
/* eslint-disable @next/next/no-html-link-for-pages -- full reloads avoid unreliable client navigation in the LXC Vinext runtime */

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "../components/AppShell";
import { routeTextColor } from "../routes/config";
import { useRouteColors } from "../routes/useRouteColors";

type OpenIssue = { id: number; vehicleId: number; vehicleNumber: string; routeNumber: string | null; type: string; notes: string; serviceScheduled: boolean; createdAt: string };

export function OverviewApp() {
  const { colorFor } = useRouteColors();
  const [data, setData] = useState<{ vehicleCount: number; teamCount: number; openIssues: OpenIssue[] }>({ vehicleCount: 0, teamCount: 0, openIssues: [] });
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

  return <AppShell active="overview">
    <header className="topbar"><div><p className="eyebrow">KVC OPERATIONS</p><h1>Overview</h1><p className="page-intro">A quick look at the fleet, team, and issues needing attention.</p></div></header>
    {error && <div className="error-banner" role="alert">{error}</div>}
    <section className="stats" aria-label="Operations summary">
      <a className="stat-link" href="#open-issues"><article><span className="stat-icon amber">!</span><div><small>OPEN ISSUES</small><strong>{data.openIssues.length}</strong><p>Items needing attention</p></div></article></a>
      <a className="stat-link" href="/team"><article><span className="stat-icon blue">◎</span><div><small>TEAM MEMBERS</small><strong>{data.teamCount}</strong><p>People on the roster</p></div></article></a>
      <a className="stat-link" href="/"><article><span className="stat-icon green">▣</span><div><small>VEHICLES</small><strong>{data.vehicleCount}</strong><p>Trucks in the fleet</p></div></article></a>
    </section>
    <section className="fleet-card" id="open-issues">
      <div className="fleet-head"><div><h2>Open issue tickets</h2><p>Search and jump directly to the vehicle that needs attention.</p></div><label className="search">⌕ <input value={search} onChange={event => setSearch(event.target.value)} aria-label="Search open issues" placeholder="Search truck, route, or issue" /></label></div>
      <div className="overview-issues">
        {loading ? <div className="empty">Loading issues…</div> : visibleIssues.length === 0 ? <div className="empty">{data.openIssues.length ? "No issues match your search." : "There are no open issues."}</div> : visibleIssues.map(issue => <a className="overview-issue" href={`/vehicles/${issue.vehicleId}`} key={issue.id}>
          <span className="issue-type">{issue.type.charAt(0)}</span><div><div><strong>Vehicle #{issue.vehicleNumber}</strong>{issue.routeNumber && <span className="overview-route-badge" style={{ backgroundColor: colorFor(issue.routeNumber), color: routeTextColor(colorFor(issue.routeNumber)) }}>Route {issue.routeNumber}</span>}{issue.serviceScheduled && <span className="scheduled-badge">Service scheduled</span>}</div><p>{issue.notes}</p><small>{issue.type} · {new Date(issue.createdAt).toLocaleDateString()}</small></div><b>→</b>
        </a>)}
      </div>
      <footer className="table-foot"><span>{visibleIssues.length} open issue{visibleIssues.length === 1 ? "" : "s"}</span><span>Newest first</span></footer>
    </section>
  </AppShell>;
}
