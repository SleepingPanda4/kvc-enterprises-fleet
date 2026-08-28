import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { scheduleEntries, teamMembers } from "../../../db/schema";
import { requireManager, requireUser } from "../../auth/server";

const validDays = new Set(["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"]);
function parseDays(value: string) { try { const days = JSON.parse(value); return Array.isArray(days) ? days.filter(day => validDays.has(day)) : []; } catch { return []; } }
function validWeek(value: string | null) { return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null; }

export async function GET(request: Request) {
  const auth = await requireUser(request); if (auth instanceof Response) return auth;
  const weekStart = validWeek(new URL(request.url).searchParams.get("weekStart"));
  if (!weekStart) return Response.json({ error: "Choose a valid week." }, { status: 400 });
  const db = getDb();
  const members = await db.select().from(teamMembers).orderBy(teamMembers.name);
  const saved = await db.select().from(scheduleEntries).where(eq(scheduleEntries.weekStart, weekStart));
  const entries = saved.length ? saved : members.flatMap(member => parseDays(member.availabilityDays).map((day, index) => ({
    id: -(member.id * 10 + index + 1), teamMemberId: member.id, weekStart, day,
    routeNumber: day === "Sat" ? member.saturdayRoute || member.regularRoute : day === "Sun" ? member.sundayRoute || member.regularRoute : member.regularRoute,
    startTime: "08:00", endTime: "17:00", notes: null, publishedAt: null, createdAt: "", updatedAt: "",
  })));
  return Response.json({ members, entries, published: saved.some(entry => Boolean(entry.publishedAt)) });
}

export async function PUT(request: Request) {
  const auth = await requireManager(request); if (auth instanceof Response) return auth;
  try {
    const payload = await request.json() as { weekStart?: string; entries?: Array<Record<string, unknown>> };
    const weekStart = validWeek(payload.weekStart || null);
    if (!weekStart || !Array.isArray(payload.entries)) return Response.json({ error: "A valid week and schedule are required." }, { status: 400 });
    const values = payload.entries.map(entry => ({
      teamMemberId: Number(entry.teamMemberId), weekStart, day: String(entry.day),
      routeNumber: typeof entry.routeNumber === "string" ? entry.routeNumber || null : null,
      startTime: String(entry.startTime || ""), endTime: String(entry.endTime || ""),
      notes: typeof entry.notes === "string" ? entry.notes.trim().slice(0, 1000) || null : null,
      publishedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }));
    const validTime = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
    if (values.some(value => !Number.isInteger(value.teamMemberId) || !validDays.has(value.day) || !validTime(value.startTime) || !validTime(value.endTime) || value.startTime >= value.endTime)) return Response.json({ error: "The schedule contains an invalid assignment or time range." }, { status: 400 });
    const db = getDb();
    await db.transaction(async tx => {
      await tx.delete(scheduleEntries).where(eq(scheduleEntries.weekStart, weekStart));
      if (values.length) await tx.insert(scheduleEntries).values(values);
    });
    return Response.json({ published: true, totalShifts: values.length });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not publish the schedule." }, { status: 500 });
  }
}
