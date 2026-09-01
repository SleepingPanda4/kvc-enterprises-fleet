"use client";
/* eslint-disable jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions */
import { useMemo,useState } from "react";
import { selectDroRouteRow,selectedDroRouteRowId,type DroRouteSelection } from "../dro/row-selection";
import { routeTextColor } from "../routes/config";
import { useRouteColors } from "../routes/useRouteColors";
import { filterMonitorMobileRows,monitorDriverDisplayName,monitorLoggedOutOverlayTime,monitorMobileCallHref,monitorMobilePaceColor,monitorStopProgress,monitorStopsLeft,sortMonitorMobileRows } from "./mobile";
import { compareMonitorRouteNumbers,compareNullable,DEFAULT_MONITOR_SORT,nextMonitorSort,type MonitorSort,type MonitorSortKey } from "./sorting";
import { statusPackagesHref,stopStatusPackageLinkPropagation } from "./status-packages/navigation";
export type MonitorRow={id:number;driverName:string;routeNumber:string|null;rawRoute:string|null;registeredRouteNumber:string|null;vehicleNumber:string|null;driverPhone:string|null;vscanPkgs:number|null;delStops:number|null;puStops:number|null;diff:number|null;actDelStops:number|null;actDelPkgs:number|null;actPuStops:number|null;ilsPercent:number|null;nextAvailOnDuty:string|null;allStatusCodePkgs:number|null;driverOrder?:number};
const show=(n:number|null)=>n===null?"—":String(n);
const fields={vscan:"vscanPkgs",delStops:"delStops",puStops:"puStops",diff:"diff",actDelStops:"actDelStops",actDelPkgs:"actDelPkgs",actPuStops:"actPuStops",ilsPercent:"ilsPercent",statusCodes:"allStatusCodePkgs"} as const;
const headers:Array<[string,MonitorSortKey|null]>=[["Driver","driver"],["Route","route"],["Vehicle",null],["VScan","vscan"],["Del","delStops"],["PU","puStops"],["Diff","diff"],["Act Del","actDelStops"],["Act Pkgs","actDelPkgs"],["Act PU","actPuStops"],["ILS%","ilsPercent"],["All Status Code Pkgs","statusCodes"]];
export function MonitorTable({ rows, date, snapshotId, snapshotCapturedAt }: { rows: MonitorRow[]; date: string; snapshotId: number | null; snapshotCapturedAt: string }) {
  const { colorFor } = useRouteColors();
  const [sort, setSort] = useState<MonitorSort | null>(null);
  const [selection, setSelection] = useState<DroRouteSelection | null>(null);
  const [mobileSearch, setMobileSearch] = useState("");
  const active = sort || DEFAULT_MONITOR_SORT;
  const desktop = useMemo(() => [...rows].sort((a, b) => {
    const route = (r: MonitorRow) => r.routeNumber || r.registeredRouteNumber;
    const tie = () => compareMonitorRouteNumbers(route(a), route(b), "asc") || (a.driverOrder ?? 0) - (b.driverOrder ?? 0) || a.id - b.id;
    if (active.key === "route") return compareMonitorRouteNumbers(route(a), route(b), active.direction) || (a.driverOrder ?? 0) - (b.driverOrder ?? 0) || a.id - b.id;
    if (active.key === "driver") return (active.direction === "asc" ? a.driverName.localeCompare(b.driverName) : b.driverName.localeCompare(a.driverName)) || tie();
    const key = fields[active.key];
    return compareNullable(a[key], b[key], active.direction) || tie();
  }), [rows, active]);
  const mobile = useMemo(() => sortMonitorMobileRows(desktop), [desktop]);
  const filteredMobile = useMemo(() => filterMonitorMobileRows(mobile, mobileSearch), [mobile, mobileSearch]);
  const selected = selectedDroRouteRowId(selection, date, snapshotId);
  const select = (id: number) => setSelection(selectDroRouteRow(id, date, snapshotId));
  const status = (r: MonitorRow) => (r.allStatusCodePkgs || 0) > 0
    ? <a className="monitor-status-code-button" href={statusPackagesHref(r.id, date, snapshotId)} onClick={stopStatusPackageLinkPropagation}>{r.allStatusCodePkgs}</a>
    : show(r.allStatusCodePkgs);
  const row = (r: MonitorRow) => {
    const route = r.routeNumber || r.registeredRouteNumber;
    const color = colorFor(route);
    return <tr key={r.id} className={selected === r.id ? "dro-route-selected" : ""} onClick={() => select(r.id)}><td>{r.driverName}</td><td>{route ? <span className="route-number-badge" style={{ backgroundColor: color, color: routeTextColor(color) }}>{route}</span> : "—"}</td><td>{r.vehicleNumber || "—"}</td><td>{show(r.vscanPkgs)}</td><td>{show(r.delStops)}</td><td>{show(r.puStops)}</td><td>{show(r.diff)}</td><td>{show(r.actDelStops)}</td><td>{show(r.actDelPkgs)}</td><td>{show(r.actPuStops)}</td><td>{show(r.ilsPercent)}</td><td>{status(r)}</td></tr>;
  };
  return <section className="fleet-card dro-routes-card monitor-routes-card">
    <div className="table-wrap monitor-desktop-table"><table className="dro-table monitor-table"><thead><tr>{headers.map(([label, key]) => <th key={label}>{key ? <button className="dro-sort-button" onClick={() => setSort(current => nextMonitorSort(current || DEFAULT_MONITOR_SORT, key))}>{label}</button> : label}</th>)}</tr></thead><tbody>{desktop.map(row)}</tbody></table></div>
    <div className="monitor-mobile-list">
      <label className="monitor-mobile-search">⌕<input value={mobileSearch} onChange={event => setMobileSearch(event.target.value)} aria-label="Search Monitor routes" placeholder="Search name, route, or truck..." /></label>
      {mobileSearch.trim() && filteredMobile.length === 0 && <p className="monitor-mobile-empty">No routes match your search.</p>}
      {filteredMobile.map(r => {
      const route = r.routeNumber || r.registeredRouteNumber;
      const color = colorFor(route);
      const progress = monitorStopProgress(r.delStops, r.puStops, r.actDelStops, r.actPuStops);
      const paceColor = monitorMobilePaceColor(progress, snapshotCapturedAt);
      const loggedOutTime = monitorLoggedOutOverlayTime(r.nextAvailOnDuty);
      const callHref = monitorMobileCallHref(date, r.driverPhone);
      const driverDisplayName = monitorDriverDisplayName(r.driverName);
      return <article key={r.id} className={`monitor-mobile-card ${selected === r.id ? "dro-route-selected" : ""}`} onClick={() => select(r.id)}>
        <div className="monitor-mobile-top"><strong>{driverDisplayName}</strong>{callHref && <a className="monitor-mobile-call" href={callHref} aria-label={`Call ${driverDisplayName}`} onClick={event => event.stopPropagation()}>☎</a>}<span>{route ? <span className="route-number-badge" style={{ backgroundColor: color, color: routeTextColor(color) }}>{route}</span> : "—"}</span><span className="monitor-mobile-vehicle">{r.vehicleNumber || "—"}</span></div>
        <div className="monitor-mobile-metrics"><span><small>Total Del</small>{show(r.delStops)}</span><span><small>Total PU</small>{show(r.puStops)}</span><span><small>Act Del</small>{show(r.actDelStops)}</span><span><small>Act PU</small>{show(r.actPuStops)}</span></div>
        <div className="monitor-mobile-status monitor-mobile-secondary-metrics"><span><small>Stops Left</small>{show(monitorStopsLeft(r.delStops, r.puStops, r.actDelStops, r.actPuStops))}</span><span><small>ILS%</small>{show(r.ilsPercent)}</span><span><small>Status Codes</small>{status(r)}</span></div>
        <div className="monitor-mobile-progress"><i><b style={{ width: progress === null ? "0%" : `${progress}%`, backgroundColor: paceColor || undefined }} /></i><strong>{progress === null ? "—" : `${progress}%`}</strong></div>
        {loggedOutTime && <div className="monitor-mobile-logged-out" aria-label={`Logged out at ${loggedOutTime}`}><strong>Logged Out</strong><span>{loggedOutTime}</span></div>}
      </article>;
    })}</div>
  </section>;
}
