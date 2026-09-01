"use client";
import { FormEvent, useEffect, useState } from "react";
import { useUnsavedChangesNavigation } from "../../auth/UnsavedChanges";
import { AppShell } from "../../components/AppShell";
import { SettingsNav, UnsavedModal } from "../account/AccountSettingsApp";
type Integration = "MGBA" | "HOMEBASE";
type State = { username: string; passwordConfigured: boolean; password: string; currentPassword: string };
const blank = (): State => ({ username: "", passwordConfigured: false, password: "", currentPassword: "" });

export function IntegrationsSettingsApp() {
  const { setGuard } = useUnsavedChangesNavigation();
  const [saved, setSaved] = useState<Record<Integration, State>>({ MGBA: blank(), HOMEBASE: blank() });
  const [forms, setForms] = useState<Record<Integration, State>>({ MGBA: blank(), HOMEBASE: blank() });
  const [pending, setPending] = useState<(() => void) | null>(null);
  useEffect(() => { void fetch("/api/settings/integrations").then(async response => ({ response, body: await response.json() })).then(({ response, body }) => { if (!response.ok) return; const next = { MGBA: blank(), HOMEBASE: blank() }; for (const row of body.integrations) next[row.integration as Integration] = { username: row.username, passwordConfigured: row.passwordConfigured, password: "", currentPassword: "" }; setSaved(next); setForms(next); }); }, []);
  const dirty = (name: Integration) => forms[name].username !== saved[name].username || Boolean(forms[name].password);
  const anyDirty = dirty("MGBA") || dirty("HOMEBASE");
  useEffect(() => { setGuard(anyDirty ? proceed => setPending(() => proceed) : null); return () => setGuard(null); }, [anyDirty, setGuard]);
  useEffect(() => { if (!anyDirty) return; const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; }; window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn); }, [anyDirty]);
  const set = (name: Integration, key: keyof State, value: string) => setForms(current => ({ ...current, [name]: { ...current[name], [key]: value } }));
  return <AppShell active="settings"><header className="topbar"><div><p className="eyebrow">SETTINGS</p><h1>Integrations</h1><p className="page-intro">Fleet Owner-only configuration for stored integration credentials.</p></div></header><div className="settings-layout"><SettingsNav owner active="integrations" /><div className="settings-content">{(["MGBA", "HOMEBASE"] as Integration[]).map(name => <IntegrationCard key={name} name={name} state={forms[name]} dirty={dirty(name)} set={set} onSaved={value => { setSaved(current => ({ ...current, [name]: value })); setForms(current => ({ ...current, [name]: value })); }} />)}</div></div>{pending && <UnsavedModal onKeep={() => setPending(null)} onDiscard={() => { const proceed = pending; setPending(null); setGuard(null); proceed(); }} />}</AppShell>;
}

function IntegrationCard({ name, state, dirty, set, onSaved }: { name: Integration; state: State; dirty: boolean; set: (name: Integration, key: keyof State, value: string) => void; onSaved: (value: State) => void }) {
  const [saving, setSaving] = useState(false); const [message, setMessage] = useState(""); const [error, setError] = useState("");
  const valid = Boolean(state.username.trim() && state.currentPassword);
  async function submit(event: FormEvent) { event.preventDefault(); if (!dirty || !valid) return; setSaving(true); setError(""); setMessage(""); try { const response = await fetch("/api/settings/integrations", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ integration: name, username: state.username, password: state.password, currentPassword: state.currentPassword }) }); const body = await response.json(); if (!response.ok) setError(body.error || "Credentials could not be saved."); else { onSaved({ username: body.integration.username, passwordConfigured: body.integration.passwordConfigured, password: "", currentPassword: "" }); setMessage(`${name} credentials saved.`); } } catch { setError("Credentials could not be saved."); } finally { setSaving(false); } }
  return <section className="fleet-card settings-card integration-card"><div><h2>{name}</h2><p>{state.passwordConfigured ? "Password configured" : "Password not configured"}</p></div>{message && <div className="success-banner" role="status">{message}</div>}{error && <div className="error-banner" role="alert">{error}</div>}<form className="form-grid settings-form" onSubmit={submit}><label className="wide">Login / Username<input value={state.username} onChange={event => set(name, "username", event.target.value)} className={dirty ? "field-dirty" : ""} autoComplete="username" />{dirty && <small className="unsaved-field">Unsaved</small>}</label><label className="wide">New Password <span className="field-hint">Leave blank to keep the existing password.</span><input type="password" value={state.password} onChange={event => set(name, "password", event.target.value)} autoComplete="new-password" placeholder={state.passwordConfigured ? "Password configured" : "Enter a password"} />{state.password && <small className="unsaved-field">A new password will replace the configured password.</small>}</label><label className="wide">Your Current Fleet Manager Password<input type="password" value={state.currentPassword} onChange={event => set(name, "currentPassword", event.target.value)} autoComplete="current-password" required /></label><div className="form-actions wide"><button className="primary" disabled={!dirty || !valid || saving}>{saving ? "Saving…" : `Save ${name} credentials`}</button></div></form></section>;
}
