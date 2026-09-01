/* eslint-disable @next/next/no-img-element */
"use client";

import { type CSSProperties, useEffect, useRef, useState } from "react";
import { useAuth } from "../auth/AuthGate";
import { roleLabel } from "../auth/roles";
import { useUnsavedChangesNavigation } from "../auth/UnsavedChanges";
import { UserAvatar } from "./UserAvatar";
import { useSiteBranding } from "../branding/SiteBranding";

type Section = "overview" | "vehicles" | "routes" | "dro" | "monitor" | "schedule" | "team" | "settings";

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
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const { user, logout } = useAuth();
  const { requestNavigation } = useUnsavedChangesNavigation();
  const { branding } = useSiteBranding();
  function navigate(href: string) { requestNavigation(() => { window.location.href = href; }); }
  function guardedLogout() { requestNavigation(() => { void logout(); }); }

  useEffect(() => {
    function closeOnOutside(event: MouseEvent) { if (!userMenuRef.current?.contains(event.target as Node)) setUserMenuOpen(false); }
    function closeOnEscape(event: KeyboardEvent) { if (event.key === "Escape") setUserMenuOpen(false); }
    document.addEventListener("mousedown", closeOnOutside); document.addEventListener("keydown", closeOnEscape);
    return () => { document.removeEventListener("mousedown", closeOnOutside); document.removeEventListener("keydown", closeOnEscape); };
  }, []);

  const companyName = branding?.companyName || "KVC Enterprises";
  const logoVisible = Boolean(branding?.logoImageId && branding.identityMode !== "name");
  const nameVisible = !logoVisible || branding?.identityMode !== "logo";
  const theme = branding ? { "--brand-primary": branding.primaryColor, "--brand-sidebar": branding.sidebarColor, "--brand-accent": branding.accentColor } as CSSProperties : undefined;

  return <main className="app-shell" style={theme}>
    <aside className={mobileOpen ? "sidebar mobile-open" : "sidebar"}>
      <div className="sidebar-heading">
        <a className="brand" href="/overview" onClick={event => { event.preventDefault(); navigate("/overview"); }}>
          {logoVisible ? <img className="brand-logo" src={`/api/images/${encodeURIComponent(branding!.logoImageId!)}`} alt="" /> : <span className="brand-mark">K</span>}
          {nameVisible && <span>{companyName}<small>{companyName === "KVC Enterprises" ? "FLEET OPERATIONS" : "FLEET MANAGEMENT"}</small></span>}
        </a>
        <button className="mobile-menu-button" type="button" onClick={() => setMobileOpen(open => !open)} aria-expanded={mobileOpen} aria-label="Toggle navigation">{mobileOpen ? "×" : "☰"}</button>
      </div>
      <nav aria-label="Main navigation">
        {navigation.map(item => <a key={item.key} className={active === item.key ? "active" : ""} href={item.href} onClick={event => { event.preventDefault(); setMobileOpen(false); navigate(item.href); }}><span>{item.icon}</span>{item.label}</a>)}
      </nav>
      <div className="sidebar-foot" ref={userMenuRef}><button type="button" className="sidebar-user-trigger" onClick={() => setUserMenuOpen(open => !open)} aria-expanded={userMenuOpen} aria-haspopup="menu"><UserAvatar name={user?.displayName || "KVC Operations"} imageId={user?.profileImageId} /><span><strong>{user?.displayName || "KVC Operations"}</strong><small>{roleLabel(user?.role)}</small></span><i aria-hidden="true">⌃</i></button>{userMenuOpen && <div className="sidebar-user-menu" role="menu"><a href="/settings/account" role="menuitem" onClick={event => { event.preventDefault(); setUserMenuOpen(false); navigate("/settings/account"); }}>Account</a><button type="button" role="menuitem" onClick={guardedLogout}>Log out</button></div>}</div>
    </aside>
    <section className="workspace">{children}</section>
  </main>;
}
