"use client";
/* eslint-disable @next/next/no-html-link-for-pages -- full reloads avoid unreliable client navigation in the LXC Vinext runtime */

import { FormEvent, useEffect, useState } from "react";
import { AppShell } from "../../components/AppShell";
import { useAuth } from "../../auth/AuthGate";
import { routeTextColor } from "../../routes/config";
import { useRouteColors } from "../../routes/useRouteColors";

type Vehicle = {
  id: number;
  number: string;
  routeNumber: string | null;
  makeModel: string;
  year: number | null;
  createdAt: string;
};

type Issue = {
  id: number;
  type: string;
  notes: string;
  status: "open" | "resolved";
  createdAt: string;
  resolvedAt: string | null;
  serviceScheduled: boolean;
};

export function VehicleDetail({ id }: { id: string }) {
  const { user } = useAuth();
  const canManage = user?.role === "Fleet Manager";
  const { colorFor } = useRouteColors();
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [tab, setTab] = useState<"open" | "resolved">("open");
  const [loading, setLoading] = useState(true);
  const [addIssue, setAddIssue] = useState(false);
  const [type, setType] = useState("Maintenance");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  async function load() {
    const response = await fetch(`/api/vehicles/${id}`);
    const data = await response.json();
    if (response.ok) {
      setVehicle(data.vehicle);
      setIssues(data.issues);
    }
    setLoading(false);
  }

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/vehicles/${id}`)
      .then(async response => ({ response, data: await response.json() }))
      .then(({ response, data }) => {
        if (cancelled || !response.ok) return;
        setVehicle(data.vehicle);
        setIssues(data.issues);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  async function change(issueId: number, status: "open" | "resolved") {
    const response = await fetch(`/api/issues/${issueId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (response.ok) {
      setIssues(current => current.map(issue => issue.id === issueId
        ? { ...issue, status, resolvedAt: status === "resolved" ? new Date().toISOString() : null }
        : issue));
    }
  }

  async function toggleService(issueId: number, serviceScheduled: boolean) {
    const response = await fetch(`/api/issues/${issueId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ serviceScheduled }) });
    if (response.ok) setIssues(current => current.map(issue => issue.id === issueId ? { ...issue, serviceScheduled } : issue));
  }

  async function submitIssue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!vehicle) return;
    setSaving(true);
    setFormError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/issues", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...Object.fromEntries(form), vehicleId: vehicle.id }),
    });
    setSaving(false);
    if (response.ok) {
      setAddIssue(false);
      setTab("open");
      void load();
    } else {
      setFormError("Issue could not be submitted.");
    }
  }

  const shown = issues.filter(issue => issue.status === tab);
  const openIssueCount = issues.filter(issue => issue.status === "open").length;
  const resolvedIssueCount = issues.filter(issue => issue.status === "resolved").length;

  if (loading) return <main className="detail-loading">Loading vehicle…</main>;
  if (!vehicle) return <main className="detail-loading">Vehicle not found. <a href="/">Return to fleet</a></main>;

  return <AppShell active="vehicles"><div className="detail-page embedded-detail">
    <a className="back-link" href="/">← Back to all vehicles</a>

    <section className="detail-hero">
      <div><p className="eyebrow">VEHICLE PROFILE</p><h1>#{vehicle.number}</h1><p>{vehicle.year ? `${vehicle.year} ` : ""}{vehicle.makeModel}</p></div>
      <span className={openIssueCount ? "status attention" : "status ready"}>● {openIssueCount ? "Needs attention" : "Ready"}</span>
    </section>

    <section className="vehicle-facts">
      <article><small>ROUTE ASSIGNMENT</small>{vehicle.routeNumber ? <strong className="route-fact-badge" style={{ backgroundColor: colorFor(vehicle.routeNumber), color: routeTextColor(colorFor(vehicle.routeNumber)) }}>{vehicle.routeNumber}</strong> : <strong>Unassigned</strong>}</article>
      <article><small>OPEN ISSUES</small><strong>{openIssueCount}</strong></article>
      <article><small>IN SERVICE</small><strong>{new Date(vehicle.createdAt).toLocaleDateString(undefined, { month: "short", year: "numeric" })}</strong></article>
    </section>

    <section className="issues-panel">
      <div className="issues-title">
        <div><h2>Issue history</h2><p>Track every note and maintenance item for this vehicle.</p></div>
        <div className="issues-actions">
          <div className="tabs">
            <button className={tab === "open" ? "selected" : ""} onClick={() => setTab("open")}>Open <b>{openIssueCount}</b></button>
            <button className={tab === "resolved" ? "selected" : ""} onClick={() => setTab("resolved")}>Resolved <b>{resolvedIssueCount}</b></button>
          </div>
          {canManage && <button className="primary add-issue-btn" onClick={() => setAddIssue(true)}>＋ Add issue</button>}
        </div>
      </div>

      <div className="issue-list">
        {shown.length === 0
          ? <div className="empty-state"><span>✓</span><h3>{tab === "open" ? "No open issues" : "No resolved issues yet"}</h3><p>{tab === "open" ? "This vehicle is ready for the road." : "Resolved items will be kept here for reference."}</p></div>
          : shown.map(issue => <article className="issue-card" key={issue.id}>
            <div className="issue-type">{issue.type.charAt(0)}</div>
            <div className="issue-copy">
              <div><span>{issue.type}</span><time>{new Date(issue.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</time></div>
              <p>{issue.notes}</p>
              {issue.resolvedAt && <small>Resolved {new Date(issue.resolvedAt).toLocaleDateString()}</small>}
            </div>
            {canManage && <div className="issue-card-actions">{tab === "open" && <button className={issue.serviceScheduled ? "service-btn scheduled" : "service-btn"} onClick={() => toggleService(issue.id, !issue.serviceScheduled)}>◷ Service scheduled</button>}<button className={tab === "open" ? "resolve-btn" : "reopen-btn"} onClick={() => change(issue.id, tab === "open" ? "resolved" : "open")}>{tab === "open" ? "✓ Mark resolved" : "↺ Reopen issue"}</button></div>}
          </article>)}
      </div>
    </section>

    {canManage && addIssue && <div className="modal-backdrop">
      <button type="button" className="modal-backdrop-dismiss" onClick={() => setAddIssue(false)} aria-label="Close dialog" />
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="vehicle-issue-title">
        <button className="modal-close" onClick={() => setAddIssue(false)} aria-label="Close">×</button>
        <p className="eyebrow">VEHICLE #{vehicle.number}</p>
        <h2 id="vehicle-issue-title">Add an issue</h2>
        <p>Log a note or maintenance item directly on this vehicle.</p>
        <form onSubmit={submitIssue} className="form-grid">
          <label className="wide">Issue type<select name="type" value={type} onChange={event => setType(event.target.value)}><option>Note</option><option>Maintenance</option><option>Other</option></select></label>
          {type === "Other" && <label className="wide">What is it?<input name="customType" required placeholder="Describe the issue type" /></label>}
          <label className="wide">Problem or notes<textarea name="notes" required rows={5} placeholder="What happened? Include any details the team should know." /></label>
          {formError && <p className="form-error wide" role="alert">{formError}</p>}
          <div className="form-actions wide"><button type="button" className="secondary" onClick={() => setAddIssue(false)}>Cancel</button><button className="primary" disabled={saving}>{saving ? "Submitting…" : "Add issue"}</button></div>
        </form>
      </section>
    </div>}
  </div></AppShell>;
}
