import { requireUser } from "../../../auth/server";
import { listDroOperationalDates } from "../../../../services/integrations/dro";

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  try {
    const dates = await listDroOperationalDates();
    return Response.json({ dates, latestDate: dates[0]?.operationalDate || null });
  } catch (error) {
    const errorId = crypto.randomUUID();
    console.error("DRO operational date read failed", { errorId, error });
    return Response.json({ error: "DRO operational dates could not be loaded.", code: "DRO_DATES_READ_FAILED", errorId }, { status: 500 });
  }
}
