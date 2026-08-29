import { getDailyAssignmentBoard, validOperationalDate } from "../../../../services/integrations/daily-assignments";
import { requireUser } from "../../../auth/server";

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;
  try {
    const operationalDate = new URL(request.url).searchParams.get("date")?.trim() || "";
    if (!validOperationalDate(operationalDate)) {
      return Response.json({ error: "Use an operational date in YYYY-MM-DD format.", code: "ASSIGNMENT_DATE_INVALID" }, { status: 400 });
    }
    return Response.json({ board: await getDailyAssignmentBoard(operationalDate) });
  } catch {
    const errorId = crypto.randomUUID();
    console.error("Daily assignment board read failed", { errorId });
    return Response.json({ error: "Assignments for that date could not be loaded.", code: "ASSIGNMENT_READ_FAILED", errorId }, { status: 500 });
  }
}
