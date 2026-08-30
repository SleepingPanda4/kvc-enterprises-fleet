import { resetDailyAssignmentsToHomebase, validOperationalDate } from "../../../../../services/integrations/daily-assignments";
import { requireManager } from "../../../../auth/server";

export async function POST(request: Request) {
  const auth = await requireManager(request);
  if (auth instanceof Response) return auth;
  try {
    const payload = await request.json() as Record<string, unknown>;
    const operationalDate = typeof payload.operationalDate === "string" ? payload.operationalDate.trim() : "";
    if (!validOperationalDate(operationalDate)) {
      return Response.json({ error: "Choose a valid operational date.", code: "ASSIGNMENT_RESET_INVALID" }, { status: 400 });
    }
    return Response.json({ board: await resetDailyAssignmentsToHomebase(operationalDate) });
  } catch {
    const errorId = crypto.randomUUID();
    console.error("Daily assignment reset failed", { errorId });
    return Response.json({ error: "Assignments could not be reset to Homebase.", code: "ASSIGNMENT_RESET_FAILED", errorId }, { status: 500 });
  }
}
