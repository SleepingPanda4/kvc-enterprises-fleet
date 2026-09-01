"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { AppShell } from "../components/AppShell";
import { useAuth } from "../auth/AuthGate";
import { canManageFleet } from "../auth/roles";
import { routeTextColor } from "../routes/config";
import { useRouteColors } from "../routes/useRouteColors";
import { UserAvatar } from "../components/UserAvatar";

type TeamMember = {
  id: number;
  name: string;
  nickname: string | null;
  phoneNumber: string;
  email: string | null;
  availabilityDays: string[];
  regularRoute: string | null;
  saturdayRoute: string | null;
  sundayRoute: string | null;
  dswDriverName: string | null;
  role: "Team Member" | "Fleet Manager";
  profileImageId: string | null;
  fedexId: string | null;
};

const routes = [
  "613", "614", "617", "618", "621", "622", "625", "626", "629",
  "630", "633", "634", "637", "638", "641", "642", "645", "1127",
];
const availabilityOrder = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const individualDayOrder = ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"];
const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const weekends = ["Sat", "Sun"];

function displayDay(day: string) {
  return day === "Tue" ? "Tues" : day;
}

function availabilityLabel(days: string[]) {
  if (days.length === 0) return "Not set";
  if (days.length === 7) return "Every day";
  if (days.length === 5 && weekdays.every(day => days.includes(day))) return "Mon–Fri";
  if (days.length === 2 && weekends.every(day => days.includes(day))) return "Weekends only";
  const selected = availabilityOrder.filter(day => days.includes(day));
  const positions = selected.map(day => availabilityOrder.indexOf(day));
  if (positions.length >= 3 && positions.every((position, index) => index === 0 || position === positions[index - 1] + 1)) {
    return `${displayDay(selected[0])}–${displayDay(selected.at(-1) || selected[0])}`;
  }
  return selected.map(displayDay).join(", ");
}

function formatPhoneInput(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 10);
  if (digits.length < 4) return digits;
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function memberRoutes(member: TeamMember) {
  return [...new Set([member.regularRoute, member.saturdayRoute, member.sundayRoute].filter(Boolean))] as string[];
}

export function TeamApp() {
  const { user } = useAuth();
  const canManage = canManageFleet(user?.role);
  const { colorFor } = useRouteColors();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showAddMember, setShowAddMember] = useState(false);
  const [editTarget, setEditTarget] = useState<TeamMember | null>(null);
  const [removeTarget, setRemoveTarget] = useState<TeamMember | null>(null);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/team");
      const data = await response.json();
      if (response.ok) setMembers(data.members);
      else setError(data.error || "Could not load the team roster.");
    } catch {
      setError("Could not connect to the team roster.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    fetch("/api/team")
      .then(async response => ({ response, data: await response.json() }))
      .then(({ response, data }) => {
        if (cancelled) return;
        if (response.ok) setMembers(data.members);
        else setError(data.error || "Could not load the team roster.");
      })
      .catch(() => { if (!cancelled) setError("Could not connect to the team roster."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const visibleMembers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return members.filter(member => [
      member.name,
      member.nickname || "",
      member.phoneNumber,
      member.email || "",
      member.availabilityDays.join(" "),
      member.availabilityDays.map(displayDay).join(" "),
      availabilityLabel(member.availabilityDays),
      memberRoutes(member).join(" ") || "flexible",
    ].join(" ").toLowerCase().includes(query));
  }, [members, search]);

  const assignedMembers = members.filter(member => member.regularRoute).length;
  const routesCovered = new Set(members.map(member => member.regularRoute).filter(Boolean)).size;

  return <AppShell active="team">
      <header className="topbar">
        <div>
          <p className="eyebrow">PEOPLE OPERATIONS</p>
          <h1>Team</h1>
          <p className="page-intro">Keep contact information and regular route assignments together.</p>
        </div>
        {canManage && <div className="header-actions">
          <button className="primary" onClick={() => setShowAddMember(true)}>＋ Add team member</button>
        </div>}
      </header>

      {error && <div className="error-banner" role="alert">{error}<button onClick={() => setError("")} aria-label="Dismiss error">×</button></div>}

      <section className="stats" aria-label="Team summary">
        <article><span className="stat-icon green">◎</span><div><small>TEAM MEMBERS</small><strong>{members.length}</strong><p>People on the roster</p></div></article>
        <article><span className="stat-icon blue">↗</span><div><small>REGULAR ROUTES</small><strong>{routesCovered}</strong><p><b>{assignedMembers}</b> regularly assigned</p></div></article>
        <article><span className="stat-icon amber">◇</span><div><small>FLEXIBLE TEAM</small><strong>{members.length - assignedMembers}</strong><p>No regular route listed</p></div></article>
      </section>

      <section className="fleet-card team-card">
        <div className="fleet-head">
          <div><h2>Team roster</h2><p>Names, contact details, and regular route coverage.</p></div>
          <div className="fleet-tools">
            <label className="search">⌕ <input value={search} onChange={event => setSearch(event.target.value)} aria-label="Search team members" placeholder="Search name, days, phone, or route" /></label>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>TEAM MEMBER</th><th>NICKNAME</th><th>PHONE / EMAIL</th><th>AVAILABLE DAYS</th><th>REGULAR ROUTES</th>{canManage && <th><span className="sr-only">Actions</span></th>}</tr></thead>
            <tbody>
              {loading
                ? <tr><td colSpan={canManage ? 6 : 5} className="empty">Loading team…</td></tr>
                : visibleMembers.length === 0
                  ? <tr><td colSpan={canManage ? 6 : 5} className="empty team-empty"><strong>{members.length ? "No team members match your search." : "Your team roster is ready."}</strong><span>{members.length ? "Try a different name, available day, phone number, or route." : canManage ? "Use Add team member to add the first person." : "No team members have been added yet."}</span></td></tr>
                  : visibleMembers.map(member => <tr key={member.id}>
                    <td><div className="member-identity"><UserAvatar name={member.name} imageId={member.profileImageId} /><div><strong>{member.name}{member.fedexId && <span className="member-fedex-id"> · FedEx ID: {member.fedexId}</span>}</strong><small>{member.role}</small></div></div></td>
                    <td><span className="nickname">{member.nickname || "—"}</span></td>
                    <td><div className="contact-stack"><a className="phone-link" href={`tel:${member.phoneNumber.replace(/[^\d+]/g, "")}`}>{member.phoneNumber}</a>{member.email && <a href={`mailto:${member.email}`}>{member.email}</a>}</div></td>
                    <td><span className={member.availabilityDays.length ? "availability-pill" : "availability-pill unset"}>{availabilityLabel(member.availabilityDays)}</span></td>
                    <td><div className="route-chip-list">{memberRoutes(member).length ? memberRoutes(member).map(route => <span className="route-chip colored" style={{ backgroundColor: colorFor(route), color: routeTextColor(colorFor(route)) }} key={route}>{route}</span>) : <span className="route-chip flexible">No regular route</span>}</div></td>
                    {canManage && <td><button className="edit-row-btn" type="button" onClick={() => setEditTarget(member)} aria-label={`Edit ${member.name}`}>✎</button></td>}
                  </tr>) }
            </tbody>
          </table>
        </div>
        <footer className="table-foot"><span>{visibleMembers.length} team member{visibleMembers.length === 1 ? "" : "s"}</span><span>{canManage ? "Sorted alphabetically" : "Read-only access"}</span></footer>
      </section>
    {canManage && showAddMember && <TeamMemberModal onClose={() => setShowAddMember(false)} onSaved={() => { setShowAddMember(false); void load(); }} />}
    {canManage && editTarget && <TeamMemberModal member={editTarget} onClose={() => setEditTarget(null)} onSaved={() => { setEditTarget(null); void load(); }} onRemove={editTarget.id === user?.teamMemberId ? undefined : () => { setRemoveTarget(editTarget); setEditTarget(null); }} />}
    {canManage && removeTarget && removeTarget.id !== user?.teamMemberId && <ConfirmRemoveDriverModal member={removeTarget} onClose={() => setRemoveTarget(null)} onRemoved={() => { setRemoveTarget(null); void load(); }} />}
  </AppShell>;
}

function TeamMemberModal({ member, onClose, onSaved, onRemove }: { member?: TeamMember; onClose: () => void; onSaved: () => void; onRemove?: () => void }) {
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [availabilityDays, setAvailabilityDays] = useState<string[]>(member?.availabilityDays ?? []);
  const [phoneNumber, setPhoneNumber] = useState(member?.phoneNumber ?? "");
  const editing = Boolean(member);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setFormError("");
    try {
      const form = new FormData(event.currentTarget);
      const payload = { ...Object.fromEntries(form), availabilityDays, id: member?.id };
      const response = await fetch("/api/team", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (response.ok) onSaved();
      else setFormError(data.error || `Team member could not be ${editing ? "updated" : "added"}.`);
    } catch {
      setFormError("Could not connect to the team roster.");
    } finally {
      setSaving(false);
    }
  }

  return <div className="modal-backdrop">
    <button type="button" className="modal-backdrop-dismiss" onClick={onClose} aria-label="Close dialog" />
    <section className="modal" role="dialog" aria-modal="true" aria-labelledby="team-modal-title">
      <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
      <p className="eyebrow">KVC TEAM</p>
      <h2 id="team-modal-title">{editing ? `Edit ${member?.name}` : "Add a team member"}</h2>
      <p>{editing ? "Update contact information, availability, or the regular route." : "Add contact information and an optional regular route."}</p>
      <form onSubmit={submit} className="form-grid" autoComplete={editing ? "on" : "off"}>
        <label className="wide">Full name<input name="name" required autoComplete={editing ? "name" : "off"} defaultValue={member?.name} placeholder="e.g. Jordan Smith" /></label>
        <label>Nickname<input name="nickname" autoComplete="off" defaultValue={member?.nickname ?? ""} placeholder="Optional" /></label>
        <label>Phone number<input name="phoneNumber" required type="tel" inputMode="tel" autoComplete={editing ? "tel" : "off"} value={phoneNumber} onChange={event => setPhoneNumber(formatPhoneInput(event.target.value))} placeholder="(555) 555-0123" /></label>
        <label>Email<input name="email" type="email" autoComplete={editing ? "email" : "off"} defaultValue={member?.email ?? ""} placeholder="Optional" /></label>
        <label className="wide">DSW Driver Name<input name="dswDriverName" autoComplete="off" defaultValue={member?.dswDriverName ?? ""} placeholder="Exact Monitor driver name, e.g. GALLAGHER,WILLIAM RONAN" /><small className="field-hint">Optional. Used only to safely connect this person to their Monitor call button.</small></label>
        <AvailabilityPicker selected={availabilityDays} onChange={setAvailabilityDays} />
        <label className="wide">Regular route<select name="regularRoute" defaultValue={member?.regularRoute ?? ""}><option value="">No regular route</option>{routes.map(route => <option key={route} value={route}>{route}</option>)}</select><small className="field-hint">Leave unassigned if they regularly cover different routes.</small></label>
        {availabilityDays.includes("Sat") && <label>Saturday route<select name="saturdayRoute" defaultValue={member?.saturdayRoute ?? ""}><option value="">Use regular route</option>{routes.map(route => <option key={route} value={route}>{route}</option>)}</select></label>}
        {availabilityDays.includes("Sun") && <label>Sunday route<select name="sundayRoute" defaultValue={member?.sundayRoute ?? ""}><option value="">Use regular route</option>{routes.map(route => <option key={route} value={route}>{route}</option>)}</select></label>}
        <label className="wide manager-check"><input name="isManager" type="checkbox" defaultChecked={member?.role === "Fleet Manager"} />Fleet Manager access <small>Allows this person to manage fleet operations.</small></label>
        {formError && <p className="form-error wide" role="alert">{formError}</p>}
        <div className="form-actions wide">{editing && onRemove && <button type="button" className="danger remove-driver-btn" onClick={onRemove}>Remove driver</button>}<button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={saving}>{saving ? (editing ? "Saving…" : "Adding…") : (editing ? "Save changes" : "Add team member")}</button></div>
      </form>
    </section>
  </div>;
}

function ConfirmRemoveDriverModal({ member, onClose, onRemoved }: { member: TeamMember; onClose: () => void; onRemoved: () => void }) {
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState("");

  async function removeDriver() {
    setRemoving(true);
    setRemoveError("");
    try {
      const response = await fetch(`/api/team/${member.id}`, { method: "DELETE" });
      const body = await response.json();
      if (response.ok) onRemoved();
      else setRemoveError(`${body.error || "Driver could not be removed."}${body.code ? ` (${body.code})` : ""}`);
    } catch {
      setRemoveError("Could not connect to the team roster.");
    } finally {
      setRemoving(false);
    }
  }

  return <div className="modal-backdrop">
    <button type="button" className="modal-backdrop-dismiss" onClick={onClose} aria-label="Close confirmation" />
    <section className="modal" role="alertdialog" aria-modal="true" aria-labelledby="remove-driver-title" aria-describedby="remove-driver-description">
      <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
      <p className="eyebrow">REMOVE DRIVER</p>
      <h2 id="remove-driver-title">Are you sure?</h2>
      <p id="remove-driver-description">Remove {member.name} from the Team roster? Their schedule assignments will be removed. If they have a login account, access and active sessions will also be revoked.</p>
      <div className="delete-summary"><UserAvatar name={member.name} imageId={member.profileImageId}/><div><strong>{member.name}</strong><span>{member.role}{member.regularRoute ? ` · Route ${member.regularRoute}` : ""}</span></div></div>
      {removeError && <p className="form-error" role="alert">{removeError}</p>}
      <div className="form-actions"><button type="button" className="secondary" onClick={onClose}>Keep driver</button><button type="button" className="danger" disabled={removing} onClick={() => void removeDriver()}>{removing ? "Removing…" : "Yes, remove driver"}</button></div>
    </section>
  </div>;
}

function AvailabilityPicker({ selected, onChange }: { selected: string[]; onChange: (days: string[]) => void }) {
  function toggleGroup(group: string[]) {
    const removeGroup = group.every(day => selected.includes(day));
    const nextDays = removeGroup
      ? selected.filter(day => !group.includes(day))
      : [...selected, ...group];
    onChange(availabilityOrder.filter(day => nextDays.includes(day)));
  }

  function toggleDay(day: string) {
    const nextDays = selected.includes(day)
      ? selected.filter(selectedDay => selectedDay !== day)
      : [...selected, day];
    onChange(availabilityOrder.filter(availableDay => nextDays.includes(availableDay)));
  }

  return <div className="availability-field wide">
    <span>Available days</span>
    <details className="availability-picker">
      <summary><span>{availabilityLabel(selected)}</span><small>{selected.length ? `${selected.length} selected` : "Choose one or more"}</small></summary>
      <div className="availability-menu">
        <p>QUICK CHOICES</p>
        <label aria-label="Select Monday through Friday"><input type="checkbox" checked={weekdays.every(day => selected.includes(day))} onChange={() => toggleGroup(weekdays)} /><span><strong>Mon–Fri</strong><small>Monday through Friday</small></span></label>
        <label aria-label="Select weekends only"><input type="checkbox" checked={weekends.every(day => selected.includes(day))} onChange={() => toggleGroup(weekends)} /><span><strong>Weekends only</strong><small>Saturday and Sunday</small></span></label>
        <p>INDIVIDUAL DAYS</p>
        <div className="day-check-grid">{individualDayOrder.map(day => <label key={day}><input type="checkbox" checked={selected.includes(day)} onChange={() => toggleDay(day)} /><span>{displayDay(day)}</span></label>)}</div>
      </div>
    </details>
    <small className="field-hint">Use a quick choice, individual days, or combine both.</small>
  </div>;
}
