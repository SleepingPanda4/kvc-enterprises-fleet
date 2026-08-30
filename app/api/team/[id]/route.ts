import { eq, sql } from "drizzle-orm";
import { getDb } from "../../../../db";
import { teamMembers, users } from "../../../../db/schema";
import { requireManager } from "../../../auth/server";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireManager(request);
  if (auth instanceof Response) return auth;

  try {
    const { id } = await params;
    const memberId = Number(id);
    if (!Number.isInteger(memberId) || memberId <= 0) {
      return Response.json({ error: "Choose a valid driver.", code: "TEAM_DRIVER_INVALID" }, { status: 400 });
    }

    const db = getDb();
    const [member] = await db.select().from(teamMembers).where(eq(teamMembers.id, memberId)).limit(1);
    if (!member) {
      return Response.json({ error: "Driver not found.", code: "TEAM_DRIVER_NOT_FOUND" }, { status: 404 });
    }

    if (auth.teamMemberId === memberId) {
      return Response.json({ error: "You cannot remove yourself.", code: "TEAM_SELF_REMOVE_FORBIDDEN" }, { status: 409 });
    }

    if (member.role === "Fleet Manager") {
      const [managerCount] = await db.select({ count: sql<number>`count(*)` }).from(teamMembers).where(eq(teamMembers.role, "Fleet Manager"));
      if (Number(managerCount?.count || 0) <= 1) {
        return Response.json({ error: "At least one Fleet Manager must remain.", code: "TEAM_LAST_MANAGER" }, { status: 409 });
      }
    }

    await db.transaction(async tx => {
      await tx.delete(users).where(eq(users.teamMemberId, memberId));
      await tx.delete(teamMembers).where(eq(teamMembers.id, memberId));
    });

    return Response.json({ removed: true, memberId });
  } catch (error) {
    const errorId = crypto.randomUUID();
    console.error("Driver removal failed", { errorId, error });
    return Response.json({ error: "Driver could not be removed.", code: "TEAM_REMOVE_FAILED", errorId }, { status: 500 });
  }
}
