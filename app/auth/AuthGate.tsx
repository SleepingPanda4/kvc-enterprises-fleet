"use client";

import { FormEvent, createContext, useContext, useEffect, useState } from "react";

type User = { id: number; teamMemberId: number | null; name: string; email: string; phoneNumber: string; role: "Team Member" | "Fleet Manager" };
type AuthMode = "login" | "signup" | "forgot";
type SignupResult = { email: string };

const AuthContext = createContext<{ user: User | null; logout: () => Promise<void> }>({ user: null, logout: async () => undefined });
export function useAuth() { return useContext(AuthContext); }

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void fetch("/api/auth").then(response => response.json()).then(body => setUser(body.user || null)).finally(() => setLoading(false));
  }, []);

  async function logout() {
    await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "logout" }) });
    setUser(null);
  }

  if (loading) return <main className="auth-loading">Loading KVC Fleet…</main>;
  if (!user) return <AuthScreen onLogin={setUser} />;
  return <AuthContext.Provider value={{ user, logout }}>{children}</AuthContext.Provider>;
}

function AuthScreen({ onLogin }: { onLogin: (user: User) => void }) {
  const path = typeof window === "undefined" ? "" : window.location.pathname;
  const token = typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("token") || "";
  const [mode, setMode] = useState<AuthMode>("login");
  const [loginIdentifier, setLoginIdentifier] = useState("");
  const [signupResult, setSignupResult] = useState<SignupResult | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const action = path === "/verify" ? "verify" : path === "/reset-password" ? "reset" : mode;
    const submittedEmail = String(form.get("email") || "").trim().toLowerCase();

    try {
      const response = await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...Object.fromEntries(form), token }) });
      const body = await response.json();
      if (!response.ok) {
        setError(`${body.error || "Account request failed."}${body.code ? ` (${body.code})` : ""}${body.errorId ? ` · Reference ${body.errorId}` : ""}`);
      } else if (body.user) {
        onLogin(body.user);
      } else if (action === "signup") {
        setSignupResult({ email: submittedEmail });
        setMessage("");
      } else {
        setMessage(body.message || (action === "verify" ? "Account verified. You can now sign in." : action === "reset" ? "Password updated. You can now sign in." : "Request completed."));
        if (["verify", "reset"].includes(action)) {
          setMode("login");
          window.history.replaceState({}, "", "/");
        }
      }
    } catch {
      setError("Could not connect to the sign-in service. (AUTH_NETWORK_ERROR)");
    } finally {
      setSaving(false);
    }
  }

  function continueToSignIn() {
    if (!signupResult) return;
    setLoginIdentifier(signupResult.email);
    setSignupResult(null);
    setMode("login");
    setMessage("");
    setError("");
  }

  const special = path === "/verify" || path === "/reset-password";

  return <main className="auth-page"><section className="auth-card">
    <div className="auth-brand"><span className="brand-mark">K</span><div><strong>KVC Enterprises</strong><small>Fleet Operations</small></div></div>
    {signupResult ? <div className="signup-confirmation">
      <span className="email-check" aria-hidden="true">✓</span>
      <p className="eyebrow">ACCOUNT CREATED</p>
      <h1>Check your email</h1>
      <p>We sent a verification link to <strong>{signupResult.email}</strong>. Open that link to verify your account before signing in.</p>
      <button type="button" className="primary" onClick={continueToSignIn}>Continue</button>
    </div> : <>
      <p className="eyebrow">SECURE ACCESS</p>
      <h1>{path === "/verify" ? "Verify account" : path === "/reset-password" ? "Reset password" : mode === "signup" ? "Create account" : mode === "forgot" ? "Forgot password" : "Welcome back"}</h1>
      <p>{special ? "Complete this account request to continue." : mode === "login" ? "Sign in with your email or phone number." : mode === "signup" ? "Join the KVC team roster and verify your email." : "We’ll email you a password reset link."}</p>
      {message && <div className="success-banner">{message}</div>}
      {error && <div className="error-banner" role="alert">{error}</div>}
      <form className="auth-form" onSubmit={submit}>
        {path === "/verify" ? <p>Click below to verify this account.</p> : path === "/reset-password" ? <label>New password<input name="password" type="password" minLength={8} required autoComplete="new-password" /></label> : mode === "login" ? <><label>Email or phone<input name="identifier" required autoComplete="username" value={loginIdentifier} onChange={event => setLoginIdentifier(event.target.value)} /></label><label>Password<input name="password" type="password" required autoComplete="current-password" /></label></> : mode === "signup" ? <><label>Name<input name="name" required autoComplete="name" /></label><label>Email<input name="email" type="email" required autoComplete="email" /></label><label>Phone number<input name="phoneNumber" type="tel" required autoComplete="tel" /></label><label>Password<input name="password" type="password" minLength={8} required autoComplete="new-password" /></label></> : <label>Email<input name="email" type="email" required autoComplete="email" /></label>}
        <button className="primary" disabled={saving}>{saving ? "Please wait…" : path === "/verify" ? "Verify account" : path === "/reset-password" ? "Set new password" : mode === "login" ? "Sign in" : mode === "signup" ? "Create account" : "Send reset link"}</button>
      </form>
      {!special && <div className="auth-links">{mode !== "login" && <button type="button" onClick={() => { setMode("login"); setMessage(""); setError(""); }}>Back to sign in</button>}{mode === "login" && <><button type="button" onClick={() => setMode("forgot")}>Forgot password?</button><button type="button" onClick={() => setMode("signup")}>Create an account</button></>}</div>}
    </>}
  </section></main>;
}
