import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { teamMembers, users } from "../../../db/schema";
import { displayName, formatPhone, getCurrentUser, hashPassword, normalizeFedexId, normalizePhone, verifyPassword } from "../../auth/server";

function accountResponse(user: { id: number; teamMemberId: number | null; name: string; nickname: string | null; fedexId: string | null; profileImageId: string | null; email: string; phoneNumber: string; role: string }) {
  return { account: { id: user.id, teamMemberId: user.teamMemberId, name: user.name, nickname: user.nickname, fedexId: user.fedexId, profileImageId: user.profileImageId, email: user.email, phoneNumber: user.phoneNumber, role: user.role, displayName: displayName(user) } };
}

function invalid(message: string) { return Response.json({ error: message, code: "ACCOUNT_PROFILE_INVALID" }, { status: 400 }); }

export async function GET(request: Request) {
  const user = await getCurrentUser(request);
  return user ? Response.json(accountResponse(user)) : Response.json({ error: "Authentication required.", code: "AUTH_REQUIRED" }, { status: 401 });
}

export async function PATCH(request: Request) {
  const current = await getCurrentUser(request);
  if (!current) return Response.json({ error: "Authentication required.", code: "AUTH_REQUIRED" }, { status: 401 });
  try {
    const payload = await request.json() as Record<string, unknown>;
    const name = String(payload.name || "").trim();
    const nickname = String(payload.nickname || "").trim() || null;
    const email = String(payload.email || "").trim().toLowerCase();
    const phoneNumber = formatPhone(String(payload.phoneNumber || ""));
    const rawFedexId = String(payload.fedexId || "").trim();
    const fedexId = rawFedexId ? normalizeFedexId(rawFedexId) : null;
    if (!name) return invalid("Full name is required.");
    if (!/^\S+@\S+\.\S+$/.test(email)) return invalid("Enter a valid email address.");
    if (normalizePhone(phoneNumber).length !== 10) return invalid("Enter a valid 10-digit phone number.");
    if (rawFedexId && !fedexId) return invalid("FedEx ID must contain digits only.");
    const now = new Date().toISOString(); const db = getDb();
    const [updated] = await db.update(users).set({ name, nickname, fedexId, email, phoneNumber, updatedAt: now }).where(eq(users.id, current.id)).returning();
    if (updated.teamMemberId) await db.update(teamMembers).set({ name, nickname, email, phoneNumber, updatedAt: now }).where(eq(teamMembers.id, updated.teamMemberId));
    return Response.json(accountResponse(updated));
  } catch (error) {
    if (error instanceof SyntaxError) return invalid("The account request was not valid.");
    if (error instanceof Error && error.message.includes("fedex_id")) return Response.json({ error: "That FedEx ID is already assigned to another account.", code: "ACCOUNT_FEDEX_ID_EXISTS" }, { status: 409 });
    if (error instanceof Error && error.message.includes("UNIQUE constraint")) return Response.json({ error: "That email or phone number is already registered.", code: "ACCOUNT_IDENTIFIER_EXISTS" }, { status: 409 });
    return Response.json({ error: "Account details could not be saved.", code: "ACCOUNT_UPDATE_FAILED" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const current = await getCurrentUser(request);
  if (!current) return Response.json({ error: "Authentication required.", code: "AUTH_REQUIRED" }, { status: 401 });
  try {
    const payload = await request.json() as Record<string, unknown>;
    const currentPassword = String(payload.currentPassword || "");
    const newPassword = String(payload.newPassword || "");
    if (newPassword.length < 8) return Response.json({ error: "New password must be at least 8 characters.", code: "ACCOUNT_PASSWORD_WEAK" }, { status: 400 });
    const db = getDb(); const [stored] = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, current.id)).limit(1);
    if (!stored || !verifyPassword(currentPassword, stored.passwordHash)) return Response.json({ error: "Current password is incorrect.", code: "ACCOUNT_CURRENT_PASSWORD_INVALID" }, { status: 400 });
    await db.update(users).set({ passwordHash: hashPassword(newPassword), updatedAt: new Date().toISOString() }).where(eq(users.id, current.id));
    return Response.json({ passwordChanged: true });
  } catch (error) {
    if (error instanceof SyntaxError) return invalid("The password request was not valid.");
    return Response.json({ error: "Password could not be changed.", code: "ACCOUNT_PASSWORD_CHANGE_FAILED" }, { status: 500 });
  }
}
