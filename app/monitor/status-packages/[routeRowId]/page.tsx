"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AppShell } from "../../../components/AppShell";
import { monitorBackHref } from "../navigation";

type Detail = {
  routeRow: {
    routeNumber: string | null; rawRoute: string | null; driverName: string; capturedAt: string;
    allStatusCodePkgs: number | null; statusPackagesState: "captured" | "incomplete" | "failed" | "not_applicable";
  };
  packages: Array<{
    id: number; packageNumber: number; additionalInfo: string | null; visionLabel: string | null; trackingId: string | null;
    destinationAddress: string | null; vehicleNumber: string | null; vsaStatusCode: string | null; starStatusCode: string | null;
    starScanTime: string | null; isGreyedOut: boolean;
  }>;
};

const empty = (value: string | null) => value || "—";

export default function StatusPackagesPage() {
  const { routeRowId } = useParams<{ routeRowId: string }>();
  const search = useSearchParams();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void fetch(`/api/monitor/status-packages?routeRowId=${encodeURIComponent(routeRowId)}`, { cache: "no-store" })
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Package details could not be loaded.");
        setDetail(body);
      })
      .catch(cause => setError(cause instanceof Error ? cause.message : "Package details could not be loaded."));
  }, [routeRowId]);

  const back = monitorBackHref(search);
  const showCaptureNotice = detail?.routeRow.statusPackagesState === "failed" || detail?.routeRow.statusPackagesState === "incomplete";

  return <AppShell active="monitor">
    <header className="page-head monitor-package-page-head">
      <div className="monitor-package-page-back"><a className="secondary" href={back}>← Back to Monitor</a></div>
      <p className="eyebrow">HISTORICAL MONITOR SNAPSHOT</p>
      <h1>All Status Code Packages</h1>
      {detail && <p className="page-intro">Route {detail.routeRow.routeNumber || detail.routeRow.rawRoute || "—"} · {detail.routeRow.driverName}<br />
        {new Date(detail.routeRow.capturedAt).toLocaleString(undefined, { timeZone: "America/Chicago", dateStyle: "full", timeStyle: "short" })} · Source count: {empty(detail.routeRow.allStatusCodePkgs === null ? null : String(detail.routeRow.allStatusCodePkgs))}
      </p>}
    </header>
    {error && <p className="form-error">{error}</p>}
    {!detail && !error && <p>Loading package details…</p>}
    {detail && <section className="fleet-card">
      {showCaptureNotice && <div className="fleet-head">
        {detail.routeRow.statusPackagesState === "failed" && <p>FedEx reported status-code packages for this route, but package details could not be captured for this snapshot.</p>}
        {detail.routeRow.statusPackagesState === "incomplete" && <p>FedEx reported {detail.routeRow.allStatusCodePkgs ?? "—"} packages; {detail.packages.length} records were captured.</p>}
      </div>}
      {detail.packages.length > 0 && <div className="table-wrap monitor-package-table-wrap"><table className="monitor-package-table">
        <thead><tr>{["Pkg #", "Add'l Info", "Vision Label", "Tracking ID", "Destination Address", "Vehicle #", "VSA Status Code", "STAR Status Code", "STAR Scan Time"].map(label => <th key={label}>{label}</th>)}</tr></thead>
        <tbody>{detail.packages.map(item => <tr key={item.id} className={item.isGreyedOut ? "monitor-package-greyed" : ""}>
          <td>{item.packageNumber}</td><td>{empty(item.additionalInfo)}</td><td>{empty(item.visionLabel)}</td><td className="monitor-copyable">{empty(item.trackingId)}</td><td className="monitor-address">{empty(item.destinationAddress)}</td><td>{empty(item.vehicleNumber)}</td><td>{empty(item.vsaStatusCode)}</td><td>{empty(item.starStatusCode)}</td><td>{empty(item.starScanTime)}</td>
        </tr>)}</tbody>
      </table></div>}
      {detail.packages.length === 0 && detail.routeRow.statusPackagesState !== "failed" && <p className="monitor-package-notice">Package-level details were not captured for this historical snapshot.</p>}
    </section>}
  </AppShell>;
}
