import { requireUser } from "../../../auth/server";
import { listHomebaseAssignments, tomorrowInTimeZone } from "../../../../services/integrations/homebase";

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  try {
    const requestedDate = new URL(request.url).searchParams.get("date")?.trim();
    const date = requestedDate || tomorrowInTimeZone();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return Response.json({ error: "Use a date in YYYY-MM-DD format.", code: "HOMEBASE_DATE_INVALID" }, { status: 400 });
    }
    return Response.json({ date, assignments: await listHomebaseAssignments(date) });
  } catch (error) {
    const errorId = crypto.randomUUID();
    console.error("Homebase assignment read failed", { errorId, error });
    return Response.json({ error: "Homebase assignments could not be loaded.", code: "HOMEBASE_READ_FAILED", errorId }, { status: 500 });
  }
}
