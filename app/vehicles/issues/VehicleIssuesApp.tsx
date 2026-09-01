"use client";
/* eslint-disable @next/next/no-html-link-for-pages -- this is an intentional ordinary browser navigation in the LXC runtime */

import { type FormEvent, useEffect, useMemo, useState } from "react";
import { IssueModal } from "../../FleetApp";
import { useAuth } from "../../auth/AuthGate";
import { canManageFleet } from "../../auth/roles";
import { AppShell } from "../../components/AppShell";
import { IssueAttachmentPicker } from "../../components/IssueAttachmentPicker";
import { IssueAttachmentGallery, type IssueAttachment } from "../../components/IssueAttachmentGallery";
import { routeTextColor } from "../../routes/config";
import { useRouteColors } from "../../routes/useRouteColors";

type IssueTicket = {
  id: number;
  vehicleId: number;
  vehicleNumber: string;
  routeNumber: string | null;
  type: string;
  notes: string;
  status: "open" | "resolved";
  serviceScheduled: boolean;
  createdAt: string;
  resolvedAt: string | null;
  resolutionNotes: string | null; reportedByName: string | null;
};

type Tab = "open" | "resolved";
type ReportVehicle = { id: number; number: string; routeNumber: string | null; makeModel: string; year: number | null; openIssues: number };

function issueDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function VehicleIssuesApp() {
  const { user } = useAuth();
  const canManage = canManageFleet(user?.role);
  const { colorFor } = useRouteColors();
  const [issues, setIssues] = useState<IssueTicket[]>([]);
  const [tab, setTab] = useState<Tab>("open");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [resolutionTarget, setResolutionTarget] = useState<IssueTicket | null>(null);
  const [resolutionMode, setResolutionMode] = useState<"resolve" | "edit">("resolve");
  const [resolutionNotes, setResolutionNotes] = useState("");
  const [resolutionError, setResolutionError] = useState("");
  const [detailTarget, setDetailTarget] = useState<IssueTicket | null>(null);
  const [attachments, setAttachments] = useState<IssueAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState("");
  const [resolutionFiles, setResolutionFiles] = useState<File[]>([]);
  const [editTarget, setEditTarget] = useState<IssueTicket | null>(null);
  const [editNotes, setEditNotes] = useState("");
  const [editType, setEditType] = useState("");
  const [editFiles, setEditFiles] = useState<File[]>([]);
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [reportIssueOpen, setReportIssueOpen] = useState(false);
  const [reportVehicles, setReportVehicles] = useState<ReportVehicle[]>([]);
  const [vehicleSearch, setVehicleSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/issues").then(async response => ({ response, data: await response.json() }))
      .then(({ response, data }) => { if (!cancelled) { if (response.ok) setIssues(data.issues); else setError(data.error || "Could not load issue tickets."); } })
      .catch(() => { if (!cancelled) setError("Could not connect to vehicle maintenance."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function update(issueId: number, changes: { status?: Tab; serviceScheduled?: boolean; resolutionNotes?: string }) {
    const response = await fetch(`/api/issues/${issueId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(changes) });
    const data = await response.json();
    if (response.ok) setIssues(current => current.map(issue => issue.id === issueId ? { ...issue, ...data.issue } : issue));
    else setError(data.error || "Issue could not be updated.");
  }

  function openResolution(issue: IssueTicket, mode: "resolve" | "edit") {
    setResolutionTarget(issue);
    setResolutionMode(mode);
    setResolutionNotes(issue.resolutionNotes || "");
    setResolutionError("");
    setResolutionFiles([]);
  }

  async function openDetails(issue: IssueTicket) {
    setDetailTarget(issue); setAttachments([]); setAttachmentError("");
    const response = await fetch(`/api/issues/${issue.id}/attachments`);
    const data = await response.json();
    if (response.ok) setAttachments(data.attachments); else setAttachmentError(data.error || "Attachments could not be loaded.");
  }

  function openEdit(issue: IssueTicket) { setEditTarget(issue); setEditNotes(issue.notes); setEditType(issue.type); setEditFiles([]); setAttachmentError(""); }

  async function saveResolution(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!resolutionTarget) return;
    const notes = resolutionNotes.trim();
    if (!notes) { setResolutionError("Resolution information is required."); return; }
    const form = new FormData(); form.set("resolutionNotes", notes); if (resolutionMode === "resolve") form.set("status", "resolved"); resolutionFiles.forEach(file => form.append("attachments", file));
    const response = await fetch(`/api/issues/${resolutionTarget.id}`, { method: "PATCH", body: form });
    const data = await response.json();
    if (!response.ok) { setResolutionError(data.error || "Resolution information could not be saved."); return; }
    setIssues(current => current.map(issue => issue.id === resolutionTarget.id ? { ...issue, ...data.issue } : issue));
    setResolutionTarget(null);
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!editTarget) return;
    const form = new FormData(); form.set("notes", editNotes); form.set("type", editType); editFiles.forEach(file => form.append("attachments", file));
    const response = await fetch(`/api/issues/${editTarget.id}`, { method: "PATCH", body: form }); const data = await response.json();
    if (!response.ok) { setAttachmentError(data.error || "Issue could not be updated."); return; }
    setIssues(current => current.map(issue => issue.id === editTarget.id ? { ...issue, ...data.issue } : issue)); setEditTarget(null);
  }

  async function exportIssues(scope: "all" | Tab, format: "csv" | "xlsx") {
    setExporting(true); setError("");
    try {
      const response = await fetch(`/api/issues/export?scope=${scope}&format=${format}`);
      if (!response.ok) { const data = await response.json(); throw new Error(data.error || "Export could not be created."); }
      const blob = await response.blob(); const href = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = href; link.download = `kvc-vehicle-issues-${scope}.${format}`; link.click(); URL.revokeObjectURL(href); setExportOpen(false);
    } catch (exportError) { setError(exportError instanceof Error ? exportError.message : "Export could not be created."); }
    finally { setExporting(false); }
  }

  async function openReportIssue() {
    setError("");
    try {
      const response = await fetch("/api/vehicles");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Vehicle choices could not be loaded.");
      setReportVehicles(data.vehicles);
      setReportIssueOpen(true);
    } catch (reportError) { setError(reportError instanceof Error ? reportError.message : "Vehicle choices could not be loaded."); }
  }

  async function refreshIssuesAfterReport() {
    setReportIssueOpen(false);
    try {
      const response = await fetch("/api/issues");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not refresh issue tickets.");
      setIssues(data.issues);
    } catch (refreshError) { setError(refreshError instanceof Error ? refreshError.message : "Could not refresh issue tickets."); }
  }

  const openCount = issues.filter(issue => issue.status === "open").length;
  const resolvedCount = issues.length - openCount;
  const shown = useMemo(() => { const query = vehicleSearch.trim().toLowerCase(); return issues.filter(issue => issue.status === tab && (!query || issue.vehicleNumber.toLowerCase().includes(query))); }, [issues, tab, vehicleSearch]);

  const actions = (issue: IssueTicket) => canManage && <div className="vehicle-issue-actions">
    {issue.status === "open" && <button className={issue.serviceScheduled ? "service-btn scheduled" : "service-btn"} onClick={() => void update(issue.id, { serviceScheduled: !issue.serviceScheduled })}>◷ Service scheduled</button>}
    <button className="secondary compact-action" onClick={() => openEdit(issue)}>Edit issue</button>{issue.status === "open" ? <button className="resolve-btn" onClick={() => openResolution(issue, "resolve")}>✓ Mark resolved</button> : <><button className="secondary compact-action" onClick={() => openResolution(issue, "edit")}>Edit resolution</button><button className="reopen-btn" onClick={() => void update(issue.id, { status: "open" })}>↺ Reopen issue</button></>}
  </div>;

  return <AppShell active="vehicles">
    <header className="topbar vehicle-issues-header"><div><p className="eyebrow">VEHICLE MAINTENANCE</p><h1>Issue Tickets</h1><p className="page-intro">Review open maintenance items and completed vehicle issue history.</p></div><a className="secondary" href="/vehicles">← Back to vehicles</a></header>
    {error && <div className="error-banner" role="alert">{error}<button onClick={() => setError("")} aria-label="Dismiss error">×</button></div>}
    <section className="fleet-card vehicle-issues-card">
      <div className="issues-title"><div><h2>Vehicle maintenance</h2><p>Issues are listed newest first.</p><label className="search issue-vehicle-search">⌕ <input value={vehicleSearch} onChange={event => setVehicleSearch(event.target.value)} inputMode="numeric" aria-label="Search vehicle number" placeholder="Search vehicle #..." /></label></div><div className="issue-page-controls"><div className="tabs"><button className={tab === "open" ? "selected" : ""} onClick={() => setTab("open")}>Open Issues <b>{openCount}</b></button><button className={tab === "resolved" ? "selected" : ""} onClick={() => setTab("resolved")}>Resolved Issues <b>{resolvedCount}</b></button></div>{canManage && <button className="primary compact-action" onClick={() => void openReportIssue()}>＋ Report issue</button>}{canManage && <div className="issue-export"><button className="secondary compact-action" disabled={exporting} onClick={() => setExportOpen(open => !open)}>{exporting ? "Preparing…" : "Export ▾"}</button>{exportOpen && <div className="issue-export-menu"><strong>Export issue history</strong>{(["all", "open", "resolved"] as const).map(scope => <div key={scope}><span>{scope === "all" ? "All issues" : scope === "open" ? "Open issues" : "Resolved issues"}</span><button onClick={() => void exportIssues(scope, "xlsx")}>Excel</button><button onClick={() => void exportIssues(scope, "csv")}>CSV</button></div>)}</div>}</div>}</div></div>
      {loading ? <div className="empty">Loading issue tickets…</div> : shown.length === 0 ? <div className="empty-state"><span>✓</span><h3>{vehicleSearch.trim() ? "No issues found" : tab === "open" ? "No open issues" : "No resolved issues yet"}</h3><p>{vehicleSearch.trim() ? `No issues found for vehicle "${vehicleSearch.trim()}".` : tab === "open" ? "Every vehicle is currently clear." : "Resolved issue history will appear here."}</p></div> : <>
        <div className="table-wrap vehicle-issues-table"><table><thead><tr><th>DATE</th><th>VEHICLE</th><th>ROUTE</th><th>ISSUE TYPE</th><th>ISSUE / DESCRIPTION</th><th>STATUS</th><th>SERVICE</th><th>DETAILS</th>{canManage && <th>ACTIONS</th>}</tr></thead><tbody>{shown.map(issue => <tr key={issue.id}><td>{issueDate(issue.createdAt)}</td><td><a className="truck-link" href={`/vehicles/${encodeURIComponent(issue.vehicleNumber)}`}>#{issue.vehicleNumber}</a></td><td>{issue.routeNumber ? <span className="route-chip colored" style={{ backgroundColor: colorFor(issue.routeNumber), color: routeTextColor(colorFor(issue.routeNumber)) }}>{issue.routeNumber}</span> : "—"}</td><td><span className="issue-type-label">{issue.type}</span></td><td className="vehicle-issue-notes">{issue.notes}</td><td><span className={issue.status === "open" ? "status attention" : "status ready"}>● {issue.status === "open" ? "Open" : "Resolved"}</span></td><td>{issue.status === "open" && issue.serviceScheduled ? <span className="scheduled-badge">Scheduled</span> : "—"}</td><td><button className="secondary compact-action" onClick={() => void openDetails(issue)}>View</button></td>{canManage && <td>{actions(issue)}</td>}</tr>)}</tbody></table></div>
        <div className="vehicle-issues-mobile">{shown.map(issue => <article className="vehicle-issue-mobile-card" key={issue.id}><div><a className="truck-link" href={`/vehicles/${encodeURIComponent(issue.vehicleNumber)}`}>Vehicle #{issue.vehicleNumber}</a>{issue.routeNumber && <span className="route-chip colored" style={{ backgroundColor: colorFor(issue.routeNumber), color: routeTextColor(colorFor(issue.routeNumber)) }}>Route {issue.routeNumber}</span>}</div><small>{issueDate(issue.createdAt)} · {issue.type}</small><p>{issue.notes}</p><div className="vehicle-issue-mobile-meta"><span className={issue.status === "open" ? "status attention" : "status ready"}>● {issue.status === "open" ? "Open" : "Resolved"}</span>{issue.status === "open" && issue.serviceScheduled && <span className="scheduled-badge">Service scheduled</span>}</div><button className="secondary compact-action issue-details-button" onClick={() => void openDetails(issue)}>View issue details</button>{actions(issue)}</article>)}</div>
      </>}
    </section>
    {detailTarget && <div className="modal-backdrop"><button type="button" className="modal-backdrop-dismiss" onClick={() => setDetailTarget(null)} aria-label="Close issue details" /><section className="modal resolution-modal" role="dialog" aria-modal="true" aria-labelledby="issue-details-title"><button className="modal-close" onClick={() => setDetailTarget(null)} aria-label="Close">×</button><p className="eyebrow">VEHICLE #{detailTarget.vehicleNumber}{detailTarget.routeNumber ? ` · ROUTE ${detailTarget.routeNumber}` : ""}</p><h2 id="issue-details-title">Issue details</h2><dl className="issue-details-list"><div><dt>Issue type</dt><dd>{detailTarget.type}</dd></div><div><dt>Reported</dt><dd>{new Date(detailTarget.createdAt).toLocaleString()}</dd></div><div><dt>Status</dt><dd>{detailTarget.status === "open" ? "Open" : "Resolved"}</dd></div><div><dt>Service</dt><dd>{detailTarget.serviceScheduled ? "Service scheduled" : "Not scheduled"}</dd></div><div><dt>Reported by</dt><dd>{detailTarget.reportedByName || "Not recorded"}</dd></div>{detailTarget.status === "resolved" && <div><dt>Resolved</dt><dd>{detailTarget.resolvedAt ? new Date(detailTarget.resolvedAt).toLocaleString() : "—"}</dd></div>}</dl><div className="resolution-original"><strong>Original issue description</strong><p>{detailTarget.notes}</p></div>{detailTarget.status === "resolved" && <div className="resolution-original"><strong>Resolution information</strong><p>{detailTarget.resolutionNotes || "No resolution information recorded."}</p></div>}<IssueAttachmentGallery attachments={attachments} error={attachmentError} /></section></div>}
    {canManage && resolutionTarget && <div className="modal-backdrop"><button type="button" className="modal-backdrop-dismiss" onClick={() => setResolutionTarget(null)} aria-label="Close resolution dialog" /><section className="modal resolution-modal" role="dialog" aria-modal="true" aria-labelledby="resolution-title"><button className="modal-close" onClick={() => setResolutionTarget(null)} aria-label="Close">×</button><p className="eyebrow">VEHICLE #{resolutionTarget.vehicleNumber}</p><h2 id="resolution-title">{resolutionMode === "resolve" ? "Resolve issue" : "Edit resolution information"}</h2><div className="resolution-original"><strong>{resolutionTarget.type}</strong><p>{resolutionTarget.notes}</p></div><form onSubmit={saveResolution} className="form-grid"><label className="wide">Resolution information<textarea value={resolutionNotes} onChange={event => setResolutionNotes(event.target.value)} required rows={5} maxLength={10000} placeholder="What was done to resolve this issue?" /></label><IssueAttachmentPicker files={resolutionFiles} onChange={setResolutionFiles} />{resolutionError && <p className="form-error wide" role="alert">{resolutionError}</p>}<div className="form-actions wide"><button type="button" className="secondary" onClick={() => setResolutionTarget(null)}>Cancel</button><button className="primary">{resolutionMode === "resolve" ? "Resolve issue" : "Save resolution"}</button></div></form></section></div>}
    {canManage && editTarget && <div className="modal-backdrop"><button type="button" className="modal-backdrop-dismiss" onClick={() => setEditTarget(null)} aria-label="Close edit issue dialog" /><section className="modal resolution-modal" role="dialog" aria-modal="true" aria-labelledby="edit-issue-title"><button className="modal-close" onClick={() => setEditTarget(null)} aria-label="Close">×</button><p className="eyebrow">VEHICLE #{editTarget.vehicleNumber}</p><h2 id="edit-issue-title">Edit issue</h2><form onSubmit={saveEdit} className="form-grid"><label className="wide">Issue type<input value={editType} onChange={event => setEditType(event.target.value)} required /></label><label className="wide">Issue description<textarea value={editNotes} onChange={event => setEditNotes(event.target.value)} required rows={5} /></label><IssueAttachmentPicker files={editFiles} onChange={setEditFiles} />{attachmentError && <p className="form-error wide" role="alert">{attachmentError}</p>}<div className="form-actions wide"><button type="button" className="secondary" onClick={() => setEditTarget(null)}>Cancel</button><button className="primary">Save issue</button></div></form></section></div>}
    {canManage && reportIssueOpen && <IssueModal vehicles={reportVehicles} onClose={() => setReportIssueOpen(false)} onSaved={() => void refreshIssuesAfterReport()} />}
  </AppShell>;
}
