import { restoreMemberToHomebase, validOperationalDate } from "../../../../../services/integrations/daily-assignments";
import { requireManager } from "../../../../auth/server";

export async function POST(request: Request) {
  const auth = await requireManager(request);
  if (auth instanceof Response) return auth;
  try {
    const payload = await request.json() as Record<string, unknown>;
    const operationalDate = typeof payload.operationalDate === "string" ? payload.operationalDate.trim() : "";
    const teamMemberId = Number(payload.teamMemberId);
    if (!validOperationalDate(operationalDate) || !Number.isInteger(teamMemberId) || teamMemberId <= 0) {
      return Response.json({ error: "Choose a valid date and team member.", code: "ASSIGNMENT_RESTORE_INVALID" }, { status: 400 });
    }
    return Response.json({ board: await restoreMemberToHomebase(operationalDate, teamMemberId) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (["That team member is no longer on the roster.", "That team member has no Homebase assignment for this date."].includes(message)) {
      return Response.json({ error: message, code: "ASSIGNMENT_RESTORE_UNAVAILABLE" }, { status: 409 });
    }
    const errorId = crypto.randomUUID();
    console.error("Homebase assignment restore failed", { errorId });
    return Response.json({ error: "That Homebase assignment could not be restored.", code: "ASSIGNMENT_RESTORE_FAILED", errorId }, { status: 500 });
  }
}
