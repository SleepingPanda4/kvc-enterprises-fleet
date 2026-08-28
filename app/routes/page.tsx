"use client";

import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthGate";
import { AppShell } from "../components/AppShell";
import { routeColorPalette, routeTextColor } from "./config";

type RouteRecord = {
  routeNumber: string;
  color: string;
  vehicle: { id: number; number: string; makeModel: string } | null;
};

export default function RoutesPage() {
  const { user } = useAuth();
  const canManage = user?.role === "Fleet Manager";
  const [routes, setRoutes] = useState<RouteRecord[]>([]);
  const [editTarget, setEditTarget] = useState<RouteRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/routes").then(async response => ({ response, body: await response.json() }))
      .then(({ response, body }) => {
        if (cancelled) return;
        if (response.ok) setRoutes(body.routes || []);
        else setError(body.error || "Could not load routes.");
      })
      .catch(() => { if (!cancelled) setError("Could not connect to route data."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  function colorSaved(routeNumber: string, color: string) {
    setRoutes(current => current.map(route => route.routeNumber === routeNumber ? { ...route, color } : route));
    setEditTarget(null);
  }

  return <AppShell active="routes">
    <header className="topbar"><div><p className="eyebrow">ROUTE OPERATIONS</p><h1>Routes</h1><p className="page-intro">View current vehicle assignments and choose a consistent color for each route.</p></div></header>
    {error && <div className="error-banner" role="alert">{error}<button onClick={() => setError("")} aria-label="Dismiss error">×</button></div>}
    <section className="fleet-card route-list-card">
      <div className="fleet-head"><div><h2>Route list</h2><p>{canManage ? "Use Edit to choose from 30 common route colors." : "Route colors and current vehicle assignments."}</p></div></div>
      <div className="route-list" role="table" aria-label="KVC routes">
        <div className="route-list-head" role="row"><span role="columnheader">ROUTE</span><span role="columnheader">ASSIGNED VEHICLE</span><span role="columnheader">COLOR</span>{canManage && <span role="columnheader"><span className="sr-only">Actions</span></span>}</div>
        {loading ? <div className="empty">Loading routes…</div> : routes.map(route => <div className="route-list-row" role="row" key={route.routeNumber}>
          <span role="cell"><strong className="route-number-badge" style={{ backgroundColor: route.color, color: routeTextColor(route.color) }}>{route.routeNumber}</strong></span>
          <span role="cell">{route.vehicle ? <a className="route-vehicle-link" href={`/vehicles/${route.vehicle.id}`}><strong>Vehicle #{route.vehicle.number}</strong><small>{route.vehicle.makeModel}</small></a> : <span className="route-unassigned">Unassigned</span>}</span>
          <span role="cell" className="route-color-label"><i style={{ backgroundColor: route.color }} /><code>{route.color}</code></span>
          {canManage && <span role="cell"><button type="button" className="edit-row-btn" onClick={() => setEditTarget(route)} aria-label={`Edit color for route ${route.routeNumber}`}>✎</button></span>}
        </div>)}
      </div>
      <footer className="table-foot"><span>{routes.length} routes</span><span>{canManage ? "Colors save immediately" : "Read-only access"}</span></footer>
    </section>
    {canManage && editTarget && <RouteColorModal route={editTarget} onClose={() => setEditTarget(null)} onSaved={colorSaved} />}
  </AppShell>;
}

function RouteColorModal({ route, onClose, onSaved }: { route: RouteRecord; onClose: () => void; onSaved: (routeNumber: string, color: string) => void }) {
  const [selectedColor, setSelectedColor] = useState(route.color);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/routes", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ routeNumber: route.routeNumber, color: selectedColor }) });
      const body = await response.json();
      if (response.ok) onSaved(route.routeNumber, selectedColor);
      else setError(`${body.error || "Route color could not be saved."}${body.code ? ` (${body.code})` : ""}`);
    } catch {
      setError("Could not connect to route data.");
    } finally {
      setSaving(false);
    }
  }

  return <div className="modal-backdrop">
    <button type="button" className="modal-backdrop-dismiss" onClick={onClose} aria-label="Close dialog" />
    <section className="modal route-color-modal" role="dialog" aria-modal="true" aria-labelledby="route-color-title">
      <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
      <p className="eyebrow">ROUTE {route.routeNumber}</p>
      <h2 id="route-color-title">Choose a route color</h2>
      <p>Select one of 30 common colors. This color will be used anywhere the route is shown.</p>
      <div className="selected-route-color" style={{ backgroundColor: selectedColor, color: routeTextColor(selectedColor) }}><span>Route</span><strong>{route.routeNumber}</strong></div>
      <div className="route-color-picker" role="group" aria-label={`Color for route ${route.routeNumber}`}>
        {routeColorPalette.map(color => <button type="button" key={color} className={selectedColor === color ? "selected" : ""} style={{ backgroundColor: color }} onClick={() => setSelectedColor(color)} aria-label={`Select ${color}`} aria-pressed={selectedColor === color}>{selectedColor === color && <span>✓</span>}</button>)}
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button type="button" className="primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save color"}</button></div>
    </section>
  </div>;
}
