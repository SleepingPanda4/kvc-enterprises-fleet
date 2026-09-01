import { asc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { teamMembers, users } from "../../../db/schema";
import { requireManager, requireUser } from "../../auth/server";

const routeNumbers = new Set([
  "613", "614", "617", "618", "621", "622", "625", "626", "629",
  "630", "633", "634", "637", "638", "641", "642", "645", "1127",
]);
const dayOrder = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const validDays = new Set(dayOrder);

function parseAvailability(value: string) {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return dayOrder.filter(day => parsed.includes(day));
  } catch {
    return [];
  }
}

function formatPhone(value: string) {
  const digits = value.replace(/\D/g, "").slice(-10);
  return digits.length === 10 ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}` : value.trim();
}

export async function GET(request: Request) {
  const auth = await requireUser(request); if (auth instanceof Response) return auth;
  try {
    const rows = await getDb().select({ member: teamMembers, profileImageId: users.profileImageId, fedexId: users.fedexId }).from(teamMembers).leftJoin(users, eq(users.teamMemberId, teamMembers.id)).orderBy(asc(teamMembers.name));
    const members = rows.map(({ member, profileImageId, fedexId }) => ({
      ...member,
      profileImageId,
      fedexId,
      availabilityDays: parseAvailability(member.availabilityDays),
    }));
    return Response.json({ members });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not load team members." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireManager(request); if (auth instanceof Response) return auth;
  try {
    const payload = await request.json() as Record<string, unknown>;
    const name = typeof payload.name === "string" ? payload.name.trim() : "";
    const phoneNumber = typeof payload.phoneNumber === "string" ? formatPhone(payload.phoneNumber) : "";
    const nickname = typeof payload.nickname === "string" ? payload.nickname.trim() || null : null;
    const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() || null : null;
    const regularRoute = typeof payload.regularRoute === "string" ? payload.regularRoute.trim() || null : null;
    const saturdayRoute = typeof payload.saturdayRoute === "string" ? payload.saturdayRoute.trim() || null : null;
    const sundayRoute = typeof payload.sundayRoute === "string" ? payload.sundayRoute.trim() || null : null;
    const dswDriverName = typeof payload.dswDriverName === "string" ? payload.dswDriverName.trim() || null : null;
    const role = payload.isManager === true || payload.isManager === "on" ? "Fleet Manager" : "Team Member";
    const requestedDays = Array.isArray(payload.availabilityDays) ? payload.availabilityDays : [];
    const availabilityDays = dayOrder.filter(day => requestedDays.includes(day));

    if (!name || !phoneNumber) {
      return Response.json({ error: "Name and phone number are required." }, { status: 400 });
    }

    if (regularRoute && !routeNumbers.has(regularRoute)) {
      return Response.json({ error: "Choose a valid regular route." }, { status: 400 });
    }

    if ([saturdayRoute, sundayRoute].some(route => route && !routeNumbers.has(route))) {
      return Response.json({ error: "Choose valid weekend routes." }, { status: 400 });
    }

    if (requestedDays.some(day => typeof day !== "string" || !validDays.has(day))) {
      return Response.json({ error: "Choose valid availability days." }, { status: 400 });
    }

    const [member] = await getDb().insert(teamMembers).values({
      name,
      nickname,
      phoneNumber,
      email,
      availabilityDays: JSON.stringify(availabilityDays),
      regularRoute,
      saturdayRoute: availabilityDays.includes("Sat") ? saturdayRoute : null,
      sundayRoute: availabilityDays.includes("Sun") ? sundayRoute : null,
      dswDriverName,
      role,
    }).returning();

    return Response.json({
      member: { ...member, availabilityDays: parseAvailability(member.availabilityDays) },
    }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes("team_members_dsw_driver_name_unique")) {
      return Response.json({ error: "That DSW Driver Name is already linked to another team member." }, { status: 409 });
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not add team member." },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  const auth = await requireManager(request); if (auth instanceof Response) return auth;
  try {
    const payload = await request.json() as Record<string, unknown>;
    const id = typeof payload.id === "number" ? payload.id : Number(payload.id);
    const name = typeof payload.name === "string" ? payload.name.trim() : "";
    const phoneNumber = typeof payload.phoneNumber === "string" ? formatPhone(payload.phoneNumber) : "";
    const nickname = typeof payload.nickname === "string" ? payload.nickname.trim() || null : null;
    const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() || null : null;
    const regularRoute = typeof payload.regularRoute === "string" ? payload.regularRoute.trim() || null : null;
    const saturdayRoute = typeof payload.saturdayRoute === "string" ? payload.saturdayRoute.trim() || null : null;
    const sundayRoute = typeof payload.sundayRoute === "string" ? payload.sundayRoute.trim() || null : null;
    const dswDriverName = typeof payload.dswDriverName === "string" ? payload.dswDriverName.trim() || null : null;
    const role = payload.isManager === true || payload.isManager === "on" ? "Fleet Manager" : "Team Member";
    const requestedDays = Array.isArray(payload.availabilityDays) ? payload.availabilityDays : [];
    const availabilityDays = dayOrder.filter(day => requestedDays.includes(day));

    if (!Number.isInteger(id) || id <= 0) {
      return Response.json({ error: "Choose a valid team member." }, { status: 400 });
    }

    if (!name || !phoneNumber) {
      return Response.json({ error: "Name and phone number are required." }, { status: 400 });
    }

    if (regularRoute && !routeNumbers.has(regularRoute)) {
      return Response.json({ error: "Choose a valid regular route." }, { status: 400 });
    }

    if ([saturdayRoute, sundayRoute].some(route => route && !routeNumbers.has(route))) {
      return Response.json({ error: "Choose valid weekend routes." }, { status: 400 });
    }

    if (requestedDays.some(day => typeof day !== "string" || !validDays.has(day))) {
      return Response.json({ error: "Choose valid availability days." }, { status: 400 });
    }

    const [member] = await getDb().update(teamMembers).set({
      name,
      nickname,
      phoneNumber,
      email,
      availabilityDays: JSON.stringify(availabilityDays),
      regularRoute,
      saturdayRoute: availabilityDays.includes("Sat") ? saturdayRoute : null,
      sundayRoute: availabilityDays.includes("Sun") ? sundayRoute : null,
      dswDriverName,
      role,
      updatedAt: new Date().toISOString(),
    }).where(eq(teamMembers.id, id)).returning();

    if (!member) {
      return Response.json({ error: "Team member not found." }, { status: 404 });
    }

    await getDb().update(users).set({ name, email: email || undefined, phoneNumber, role, updatedAt: new Date().toISOString() }).where(eq(users.teamMemberId, id));

    return Response.json({
      member: { ...member, availabilityDays: parseAvailability(member.availabilityDays) },
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("team_members_dsw_driver_name_unique")) {
      return Response.json({ error: "That DSW Driver Name is already linked to another team member." }, { status: 409 });
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not update team member." },
      { status: 500 },
    );
  }
}
