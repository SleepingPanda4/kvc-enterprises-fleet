import { swapDailyAssignment, validOperationalDate, type AssignmentDestination } from "../../../../../services/integrations/daily-assignments";
import { requireManager } from "../../../../auth/server";

function destination(value: unknown): AssignmentDestination | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.type === "route" && typeof record.routeNumber === "string" && record.routeNumber.trim()) {
    return { type: "route", routeNumber: record.routeNumber.trim() };
  }
  if (record.type === "special" && typeof record.specialAssignment === "string" && record.specialAssignment.trim()) {
    return { type: "special", specialAssignment: record.specialAssignment.trim() };
  }
  if (record.type === "unassigned") return { type: "unassigned" };
  return null;
}

export async function POST(request: Request) {
  const auth = await requireManager(request);
  if (auth instanceof Response) return auth;
  try {
    const payload = await request.json() as Record<string, unknown>;
    const operationalDate = typeof payload.operationalDate === "string" ? payload.operationalDate.trim() : "";
    const replacementTeamMemberId = Number(payload.replacementTeamMemberId);
    const replacedTeamMemberId = payload.replacedTeamMemberId === undefined || payload.replacedTeamMemberId === null
      ? null
      : Number(payload.replacedTeamMemberId);
    const target = destination(payload.destination);
    if (!validOperationalDate(operationalDate) || !target
      || !Number.isInteger(replacementTeamMemberId) || replacementTeamMemberId <= 0
      || (replacedTeamMemberId !== null && (!Number.isInteger(replacedTeamMemberId) || replacedTeamMemberId <= 0))) {
      return Response.json({ error: "Choose a valid date, assignment, and team member.", code: "ASSIGNMENT_SWAP_INVALID" }, { status: 400 });
    }
    const board = await swapDailyAssignment({ operationalDate, destination: target, replacementTeamMemberId, replacedTeamMemberId });
    return Response.json({ board });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (["That team member is no longer on the roster.", "That assignment changed. Reload and try again.", "Choose a valid route assignment."].includes(message)) {
      return Response.json({ error: message, code: "ASSIGNMENT_SWAP_CONFLICT" }, { status: 409 });
    }
    const errorId = crypto.randomUUID();
    console.error("Daily assignment swap failed", { errorId });
    return Response.json({ error: "That assignment could not be changed.", code: "ASSIGNMENT_SWAP_FAILED", errorId }, { status: 500 });
  }
}
