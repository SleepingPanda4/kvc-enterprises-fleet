"use client";

import { useState } from "react";
import { useAuth } from "../auth/AuthGate";

type Section = "overview" | "vehicles" | "routes" | "dro" | "monitor" | "schedule" | "team";

const navigation: { key: Section; href: string; icon: string; label: string }[] = [
  { key: "overview", href: "/overview", icon: "⌂", label: "Overview" },
  { key: "vehicles", href: "/", icon: "▣", label: "Vehicles" },
  { key: "routes", href: "/routes", icon: "↗", label: "Routes" },
  { key: "dro", href: "/dro", icon: "▤", label: "DRO" },
  { key: "monitor", href: "/monitor", icon: "◉", label: "Monitor" },
  { key: "schedule", href: "/schedule", icon: "◷", label: "Schedule" },
  { key: "team", href: "/team", icon: "◎", label: "Team" },
];

export function AppShell({ active, children }: { active: Section; children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user, logout } = useAuth();

  return <main className="app-shell">
    <aside className={mobileOpen ? "sidebar mobile-open" : "sidebar"}>
      <div className="sidebar-heading">
        <a className="brand" href="/overview"><span className="brand-mark">K</span><span>KVC <small>ENTERPRISES</small></span></a>
        <button className="mobile-menu-button" type="button" onClick={() => setMobileOpen(open => !open)} aria-expanded={mobileOpen} aria-label="Toggle navigation">{mobileOpen ? "×" : "☰"}</button>
      </div>
      <nav aria-label="Main navigation">
        {navigation.map(item => <a key={item.key} className={active === item.key ? "active" : ""} href={item.href} onClick={() => setMobileOpen(false)}><span>{item.icon}</span>{item.label}</a>)}
      </nav>
      <div className="sidebar-foot"><div className="avatar">{user?.name.split(/\s+/).slice(0,2).map(part => part[0]).join("").toUpperCase() || "KV"}</div><div><strong>{user?.name || "KVC Operations"}</strong><small>{user?.role || "Fleet Manager"}</small></div><button className="logout-button" type="button" onClick={() => void logout()} aria-label="Log out">↪</button></div>
    </aside>
    <section className="workspace">{children}</section>
  </main>;
}
