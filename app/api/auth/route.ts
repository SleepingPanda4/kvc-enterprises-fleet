import { and, eq, or } from "drizzle-orm";
import { getDb } from "../../../db";
import { authSessions, authTokens, teamMembers, users } from "../../../db/schema";
import { clearSessionCookie, displayName, formatPhone, getCurrentUser, hashPassword, hashToken, newToken, normalizeFedexId, normalizePhone, readSessionToken, sessionCookie, verifyPassword } from "../../auth/server";

function authError(code: string, message: string, status: number, errorId?: string) {
  return Response.json({ error: message, code, ...(errorId ? { errorId } : {}) }, { status });
}

async function sendAccountEmail(to: string, subject: string, path: string) {
  const key = process.env.RESEND_API_KEY; const baseUrl = process.env.APP_BASE_URL; if (!key || !baseUrl) return false;
  const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: "KVC Enterprises <noreply@sleepingpandaind.com>", to: [to], subject, html: `<p>${subject}</p><p><a href="${baseUrl}${path}">Continue to KVC Fleet</a></p><p>If you did not request this, you can ignore this email.</p>` }) });
  return response.ok;
}

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser(request);
    return user ? Response.json({ user }) : authError("AUTH_REQUIRED", "Sign in to continue.", 401);
  } catch (error) {
    const errorId = crypto.randomUUID();
    console.error("Authentication session lookup failed", { errorId, error });
    return authError("AUTH_SERVICE_UNAVAILABLE", "Sign-in is temporarily unavailable. Please try again.", 503, errorId);
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json() as Record<string, unknown>; const action = String(payload.action || ""); const db = getDb();
    if (action === "login") {
      const rawIdentifier = String(payload.identifier || "").trim(); const identifier = rawIdentifier.toLowerCase(); const phone = normalizePhone(rawIdentifier); const fedexId = normalizeFedexId(rawIdentifier);
      const [user] = await db.select().from(users).where(or(eq(users.email, identifier), eq(users.phoneNumber, formatPhone(phone)), ...(fedexId ? [eq(users.fedexId, fedexId)] : []))).limit(1);
      if (!user || !verifyPassword(String(payload.password || ""), user.passwordHash)) return authError("AUTH_INVALID_CREDENTIALS", "FedEx ID, email, phone number, or password is incorrect.", 401);
      if (!user.verifiedAt) return authError("AUTH_EMAIL_UNVERIFIED", "Verify your email before signing in.", 403);
      const token = newToken(); await db.insert(authSessions).values({ tokenHash: hashToken(token), userId: user.id });
      return Response.json({ user: { id: user.id, teamMemberId: user.teamMemberId, name: user.name, nickname: user.nickname, fedexId: user.fedexId, profileImageId: user.profileImageId, displayName: displayName(user), email: user.email, phoneNumber: user.phoneNumber, role: user.role } }, { headers: { "Set-Cookie": sessionCookie(token, request) } });
    }
    if (action === "signup") {
      const name = String(payload.name || "").trim(); const email = String(payload.email || "").trim().toLowerCase(); const phoneNumber = formatPhone(String(payload.phoneNumber || "")); const password = String(payload.password || ""); const rawFedexId = String(payload.fedexId || "").trim(); const fedexId = rawFedexId ? normalizeFedexId(rawFedexId) : null;
      if (!name || !/^\S+@\S+\.\S+$/.test(email) || normalizePhone(phoneNumber).length !== 10 || password.length < 8) return authError("AUTH_SIGNUP_INVALID", "Enter a name, valid email and phone, and a password of at least 8 characters.", 400);
      if (rawFedexId && !fedexId) return authError("AUTH_FEDEX_ID_INVALID", "FedEx ID must contain digits only.", 400);
      const verificationToken = newToken();
      const user = await db.transaction(async tx => { const [member] = await tx.insert(teamMembers).values({ name, email, phoneNumber, availabilityDays: "[]", role: "Team Member" }).returning(); const [created] = await tx.insert(users).values({ teamMemberId: member.id, name, email, phoneNumber, fedexId, passwordHash: hashPassword(password), role: "Team Member" }).returning(); await tx.insert(authTokens).values({ tokenHash: hashToken(verificationToken), userId: created.id, type: "verify", expiresAt: new Date(Date.now()+86400000).toISOString() }); return created; });
      const emailSent = await sendAccountEmail(user.email, "Verify your KVC Fleet account", `/verify?token=${encodeURIComponent(verificationToken)}`);
      return Response.json({ created: true, emailSent, message: emailSent ? "Check your email to verify the account." : "Account created. Email delivery must be configured before verification mail can send." }, { status: 201 });
    }
    if (action === "verify") {
      const tokenHash = hashToken(String(payload.token || "")); const [record] = await db.select().from(authTokens).where(and(eq(authTokens.tokenHash, tokenHash), eq(authTokens.type, "verify"))).limit(1);
      if (!record || new Date(record.expiresAt) < new Date()) return authError("AUTH_VERIFICATION_INVALID", "This verification link is invalid or expired.", 400);
      await db.update(users).set({ verifiedAt: new Date().toISOString() }).where(eq(users.id, record.userId)); await db.delete(authTokens).where(eq(authTokens.tokenHash, tokenHash)); return Response.json({ verified: true });
    }
    if (action === "forgot") {
      const email = String(payload.email || "").trim().toLowerCase(); const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
      if (user) { const token = newToken(); await db.insert(authTokens).values({ tokenHash: hashToken(token), userId: user.id, type: "reset", expiresAt: new Date(Date.now()+3600000).toISOString() }); await sendAccountEmail(user.email, "Reset your KVC Fleet password", `/reset-password?token=${encodeURIComponent(token)}`); }
      return Response.json({ message: "If that email exists, a reset link has been sent." });
    }
    if (action === "reset") {
      const password = String(payload.password || ""); const tokenHash = hashToken(String(payload.token || "")); if (password.length < 8) return authError("AUTH_PASSWORD_WEAK", "Password must be at least 8 characters.", 400);
      const [record] = await db.select().from(authTokens).where(and(eq(authTokens.tokenHash, tokenHash), eq(authTokens.type, "reset"))).limit(1);
      if (!record || new Date(record.expiresAt) < new Date()) return authError("AUTH_RESET_INVALID", "This reset link is invalid or expired.", 400);
      await db.update(users).set({ passwordHash: hashPassword(password), updatedAt: new Date().toISOString() }).where(eq(users.id, record.userId)); await db.delete(authSessions).where(eq(authSessions.userId, record.userId)); await db.delete(authTokens).where(eq(authTokens.tokenHash, tokenHash)); return Response.json({ reset: true });
    }
    if (action === "logout") { const token = readSessionToken(request); if (token) await db.delete(authSessions).where(eq(authSessions.tokenHash, hashToken(token))); return Response.json({ loggedOut: true }, { headers: { "Set-Cookie": clearSessionCookie() } }); }
    return authError("AUTH_ACTION_INVALID", "Unknown account action.", 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("fedex_id")) return authError("AUTH_FEDEX_ID_EXISTS", "That FedEx ID is already assigned to another account.", 409);
    if (message.includes("UNIQUE constraint")) return authError("AUTH_ACCOUNT_EXISTS", "That email or phone number is already registered.", 409);
    if (error instanceof SyntaxError) return authError("AUTH_REQUEST_INVALID", "The account request was not valid.", 400);
    const errorId = crypto.randomUUID();
    console.error("Authentication request failed", { errorId, error });
    return authError("AUTH_SERVICE_UNAVAILABLE", "Sign-in is temporarily unavailable. Please try again.", 503, errorId);
  }
}
