"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthGate";
import { AppShell } from "../components/AppShell";
import { routeNumbers, routeTextColor } from "../routes/config";
import { useRouteColors } from "../routes/useRouteColors";

type Member = { id: number; name: string; nickname: string | null };
type Entry = { id: number; teamMemberId: number; day: string; routeNumber: string | null; startTime: string; endTime: string; notes: string | null };
type ShiftTarget = { member: Member; day: string; date: Date; entry?: Entry };
const days = ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"];

function saturdayFor(date = new Date()) { const copy = new Date(date); copy.setHours(12, 0, 0, 0); copy.setDate(copy.getDate() - ((copy.getDay() + 1) % 7)); return copy; }
function iso(date: Date) { return date.toISOString().slice(0, 10); }
function addDays(date: Date, amount: number) { const copy = new Date(date); copy.setDate(copy.getDate() + amount); return copy; }
function initials(name: string) { return name.split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase(); }
function dayLabel(day: string) { return day === "Tue" ? "Tues" : day; }
function formatTime(time: string) { const [hourText, minute] = time.split(":"); const hour = Number(hourText); const displayHour = hour % 12 || 12; return `${displayHour}${minute === "00" ? "" : `:${minute}`}${hour >= 12 ? "pm" : "am"}`; }
function shiftHours(entry: Entry) { const [startHour, startMinute] = entry.startTime.split(":").map(Number); const [endHour, endMinute] = entry.endTime.split(":").map(Number); return Math.max(0, endHour + endMinute / 60 - startHour - startMinute / 60); }

export function ScheduleApp() {
  const { user } = useAuth();
  const canManage = user?.role === "Fleet Manager";
  const { colorFor } = useRouteColors();
  const [weekStart, setWeekStart] = useState(saturdayFor);
  const [members, setMembers] = useState<Member[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [published, setPublished] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [shiftTarget, setShiftTarget] = useState<ShiftTarget | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const weekKey = iso(weekStart);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/schedule?weekStart=${weekKey}`).then(async response => ({ response, body: await response.json() })).then(({ response, body }) => {
      if (cancelled) return;
      if (response.ok) { setMembers(body.members); setEntries(body.entries); setPublished(body.published); setShiftTarget(null); }
      else setError(body.error || "Could not load schedule.");
    }).catch(() => { if (!cancelled) setError("Could not connect to the schedule."); });
    return () => { cancelled = true; };
  }, [weekKey]);

  const routeCount = useMemo(() => new Set(entries.map(entry => entry.routeNumber).filter(Boolean)).size, [entries]);
  const totalHours = useMemo(() => entries.reduce((total, entry) => total + shiftHours(entry), 0), [entries]);

  function markDraft() { setPublished(false); }

  function moveEntry(entryId: number, targetDay: string) {
    if (!canManage) return;
    setEntries(current => {
      const moving = current.find(entry => entry.id === entryId);
      if (!moving || moving.day === targetDay) return current;
      const target = current.find(entry => entry.teamMemberId === moving.teamMemberId && entry.day === targetDay);
      return current.map(entry => entry.id === entryId ? { ...entry, day: targetDay } : target && entry.id === target.id ? { ...entry, day: moving.day } : entry);
    });
    markDraft();
  }

  function saveShift(entry: Entry) {
    setEntries(current => current.some(item => item.id === entry.id) ? current.map(item => item.id === entry.id ? entry : item) : [...current, entry]);
    setShiftTarget(null);
    markDraft();
  }

  function removeShift(entryId: number) {
    setEntries(current => current.filter(entry => entry.id !== entryId));
    setShiftTarget(null);
    markDraft();
  }

  async function publish() {
    setSaving(true); setError("");
    const response = await fetch("/api/schedule", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ weekStart: weekKey, entries }) });
    const body = await response.json(); setSaving(false);
    if (response.ok) { setPublished(true); setPublishOpen(false); }
    else setError(body.error || "Could not publish schedule.");
  }

  return <AppShell active="schedule">
    <header className="topbar"><div><p className="eyebrow">TEAM OPERATIONS</p><h1>Schedule</h1><p className="page-intro">{canManage ? "Hover over an empty day to add a shift, or click an existing shift to edit it." : "View the current team schedule."}</p></div>{canManage && <button className="primary" onClick={() => setPublishOpen(true)}>↑ {published ? "Republish" : "Publish"} schedule</button>}</header>
    {error && <div className="error-banner" role="alert">{error}</div>}
    <div className="schedule-toolbar"><button className="secondary" onClick={() => setWeekStart(saturdayFor())}>Today</button><strong>{weekStart.toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"})} – {addDays(weekStart,6).toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"})}</strong><button aria-label="Previous week" onClick={() => setWeekStart(date => addDays(date,-7))}>←</button><button aria-label="Next week" onClick={() => setWeekStart(date => addDays(date,7))}>→</button><span className={canManage ? (published ? "published-status" : "draft-status") : "published-status"}>{canManage ? (published ? "Published" : "Draft changes") : "Read only"}</span></div>
    <div className="schedule-scroll"><div className="schedule-grid"><div className="schedule-corner">TEAM MEMBER</div>{days.map((day,index) => <div className="schedule-day" key={day}><strong>{dayLabel(day)}</strong><span>{addDays(weekStart,index).getDate()}</span></div>)}{members.map(member => <div className="schedule-row" key={member.id}><div className="schedule-person"><span>{initials(member.name)}</span><strong>{member.name}</strong></div>{days.map((day, dayIndex) => { const entry = entries.find(item => item.teamMemberId === member.id && item.day === day); const routeColor = colorFor(entry?.routeNumber); const target = { member, day, date: addDays(weekStart, dayIndex), entry }; return <div className="schedule-cell" key={day} onDragOver={event => { if (canManage) event.preventDefault(); }} onDrop={event => { if (canManage) moveEntry(Number(event.dataTransfer.getData("text/plain")),day); }}>{entry ? <button type="button" className="shift-card" style={entry.routeNumber ? { backgroundColor: routeColor, color: routeTextColor(routeColor) } : undefined} draggable={canManage} onClick={() => { if (canManage) setShiftTarget(target); }} onDragStart={event => { if (canManage) event.dataTransfer.setData("text/plain",String(entry.id)); }} aria-label={`${canManage ? "Edit" : "View"} ${formatTime(entry.startTime)} to ${formatTime(entry.endTime)} shift for ${member.name} on ${dayLabel(day)}`}><strong>{formatTime(entry.startTime)}–{formatTime(entry.endTime)}</strong><span>{entry.routeNumber ? `Route ${entry.routeNumber}` : "Flexible"}</span>{entry.notes && <small title={entry.notes}>◆ Note</small>}</button> : canManage && <button type="button" className="add-shift-cell" onClick={() => setShiftTarget(target)} aria-label={`Add shift for ${member.name} on ${dayLabel(day)}`}>＋</button>}</div>; })}</div>)}</div></div>
    {canManage && shiftTarget && <ShiftModal target={shiftTarget} colorFor={colorFor} onClose={() => setShiftTarget(null)} onSave={saveShift} onRemove={removeShift} />}
    {canManage && publishOpen && <div className="modal-backdrop"><button className="modal-backdrop-dismiss" onClick={() => setPublishOpen(false)} aria-label="Close publish dialog"/><section className="modal publish-modal" role="dialog" aria-modal="true" aria-labelledby="publish-title"><button className="modal-close" onClick={() => setPublishOpen(false)} aria-label="Close">×</button><h2 id="publish-title">Publish schedule</h2><div className="publish-summary"><h3>Summary</h3><p>{weekStart.toLocaleDateString()} – {addDays(weekStart,6).toLocaleDateString()}</p><dl><div><dt>Total shifts</dt><dd>{entries.length}</dd></div><div><dt>Total hours</dt><dd>{totalHours.toFixed(1)}</dd></div><div><dt>Routes covered</dt><dd>{routeCount}</dd></div></dl></div><div className="publish-notifications"><h3>Notifications</h3><label><input type="radio" name="notifications" defaultChecked/> Notify everyone on the team</label><label><input type="radio" name="notifications"/> Only notify team members with changes</label><label><input type="radio" name="notifications"/> Don’t notify anyone</label></div><button className="primary publish-confirm" disabled={saving} onClick={publish}>{saving ? "Publishing…" : "↑ Publish schedule"}</button></section></div>}
  </AppShell>;
}

function ShiftModal({ target, colorFor, onClose, onSave, onRemove }: { target: ShiftTarget; colorFor: (routeNumber: string | null | undefined) => string; onClose: () => void; onSave: (entry: Entry) => void; onRemove: (entryId: number) => void }) {
  const editing = Boolean(target.entry);
  const [routeNumber, setRouteNumber] = useState(target.entry?.routeNumber || "");
  const [formError, setFormError] = useState("");
  const routeColor = colorFor(routeNumber);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const startTime = String(form.get("startTime") || "");
    const endTime = String(form.get("endTime") || "");
    if (!startTime || !endTime || startTime >= endTime) { setFormError("The end time must be later than the start time."); return; }
    onSave({
      id: target.entry?.id ?? -Date.now(),
      teamMemberId: target.member.id,
      day: target.day,
      routeNumber: routeNumber || null,
      startTime,
      endTime,
      notes: String(form.get("notes") || "").trim() || null,
    });
  }

  return <div className="modal-backdrop">
    <button type="button" className="modal-backdrop-dismiss" onClick={onClose} aria-label="Close shift dialog" />
    <section className="modal shift-modal" role="dialog" aria-modal="true" aria-labelledby="shift-modal-title">
      <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
      <div className="shift-modal-person"><span className="member-avatar">{initials(target.member.name)}</span><div><p className="eyebrow">{editing ? "EDIT SHIFT" : "ADD SHIFT"}</p><h2 id="shift-modal-title">{target.member.name}</h2></div></div>
      <p className="shift-date">{target.date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</p>
      <form className="form-grid shift-form" onSubmit={submit} autoComplete="off">
        <div className="time-range wide"><label>Start time<input type="time" name="startTime" required defaultValue={target.entry?.startTime || "08:00"} /></label><span>–</span><label>End time<input type="time" name="endTime" required defaultValue={target.entry?.endTime || "17:00"} /></label></div>
        <label className="wide">Route<select name="routeNumber" value={routeNumber} onChange={event => setRouteNumber(event.target.value)}><option value="">Flexible / no route</option>{routeNumbers.map(route => <option value={route} key={route}>Route {route}</option>)}</select></label>
        {routeNumber && <div className="shift-route-preview wide" style={{ backgroundColor: routeColor, color: routeTextColor(routeColor) }}><span>Assigned route</span><strong>{routeNumber}</strong></div>}
        <label className="wide">Shift notes<textarea name="notes" rows={4} maxLength={1000} defaultValue={target.entry?.notes || ""} placeholder="Add an optional note for this shift." /></label>
        {formError && <p className="form-error wide" role="alert">{formError}</p>}
        <div className="form-actions wide">{editing && <button type="button" className="danger remove-shift-btn" onClick={() => onRemove(target.entry!.id)}>Remove shift</button>}<button type="button" className="secondary" onClick={onClose}>Cancel</button><button type="submit" className="primary">{editing ? "Save changes" : "Add shift"}</button></div>
      </form>
    </section>
  </div>;
}
