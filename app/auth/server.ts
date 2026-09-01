import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "../../db";
import { authSessions, users } from "../../db/schema";
import { canManageFleet, isFleetOwner } from "./roles";

export const SESSION_COOKIE = "kvc_session";
export function hashToken(token: string) { return createHash("sha256").update(token).digest("hex"); }
export function newToken() { return randomBytes(32).toString("base64url"); }
export function hashPassword(password: string) { const salt = randomBytes(16).toString("hex"); return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`; }
export function verifyPassword(password: string, stored: string) { const [salt, hash] = stored.split(":"); if (!salt || !hash) return false; const expected = Buffer.from(hash, "hex"); const actual = scryptSync(password, salt, 64); return expected.length === actual.length && timingSafeEqual(expected, actual); }
export function normalizePhone(value: string) { return value.replace(/\D/g, "").slice(-10); }
export function normalizeFedexId(value: string) { const trimmed = value.trim(); return trimmed && /^\d+$/.test(trimmed) ? trimmed : null; }
export function formatPhone(value: string) { const digits = normalizePhone(value); return digits.length === 10 ? `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}` : value.trim(); }
export function displayName(user: { nickname?: string | null; name?: string | null; email?: string | null; phoneNumber?: string | null }) { return user.nickname?.trim() || user.name?.trim() || user.email?.trim() || user.phoneNumber?.trim() || "KVC Operations"; }
export function readSessionToken(request: Request) { const cookie = request.headers.get("cookie") || ""; return cookie.split(";").map(part => part.trim()).find(part => part.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1) || null; }
export function sessionCookie(token: string, request: Request) { const secure = new URL(request.url).protocol === "https:" || request.headers.get("x-forwarded-proto") === "https"; return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=315360000${secure ? "; Secure" : ""}`; }
export function clearSessionCookie() { return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`; }

export async function getCurrentUser(request: Request) {
  const token = readSessionToken(request); if (!token) return null;
  const db = getDb();
  const [row] = await db.select({ id: users.id, teamMemberId: users.teamMemberId, name: users.name, nickname: users.nickname, fedexId: users.fedexId, profileImageId: users.profileImageId, email: users.email, phoneNumber: users.phoneNumber, role: users.role, verifiedAt: users.verifiedAt })
    .from(authSessions).innerJoin(users, eq(authSessions.userId, users.id)).where(eq(authSessions.tokenHash, hashToken(token))).limit(1);
  if (row) await db.update(authSessions).set({ lastUsedAt: new Date().toISOString() }).where(eq(authSessions.tokenHash, hashToken(token)));
  return row ? { ...row, displayName: displayName(row) } : null;
}

export async function requireUser(request: Request) { const user = await getCurrentUser(request); return user || Response.json({ error: "Authentication required.", code: "AUTH_REQUIRED" }, { status: 401 }); }
export async function requireManager(request: Request) { const user = await getCurrentUser(request); if (!user) return Response.json({ error: "Authentication required.", code: "AUTH_REQUIRED" }, { status: 401 }); return canManageFleet(user.role) ? user : Response.json({ error: "Fleet Manager access is required.", code: "AUTH_MANAGER_REQUIRED" }, { status: 403 }); }
export async function requireFleetOwner(request: Request) { const user = await getCurrentUser(request); if (!user) return Response.json({ error: "Authentication required.", code: "AUTH_REQUIRED" }, { status: 401 }); return isFleetOwner(user.role) ? user : Response.json({ error: "Fleet Owner access is required.", code: "AUTH_OWNER_REQUIRED" }, { status: 403 }); }
