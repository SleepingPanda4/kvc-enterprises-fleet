import { requireManager } from "../../../auth/server";
import { validOperationalDate } from "../../../../services/integrations/daily-assignments";
import { HomebaseCollectorError, requestHomebaseCollection } from "../../../../services/integrations/homebase-collector";

export async function POST(request: Request) {
  const auth = await requireManager(request);
  if (auth instanceof Response) return auth;

  try {
    const body = await request.json().catch(() => null) as { operationalDate?: unknown } | null;
    const operationalDate = typeof body?.operationalDate === "string" ? body.operationalDate.trim() : "";
    if (!validOperationalDate(operationalDate)) {
      return Response.json({ error: "Choose a valid operational date.", code: "HOMEBASE_REFRESH_DATE_INVALID" }, { status: 400 });
    }
    return Response.json(await requestHomebaseCollection({ requiredOperationalDate: operationalDate }));
  } catch (error) {
    if (error instanceof HomebaseCollectorError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.status });
    }
    const errorId = crypto.randomUUID();
    console.error("Homebase live collection request failed", { errorId });
    return Response.json({ error: "Homebase assignments could not be refreshed.", code: "HOMEBASE_COLLECTION_FAILED", errorId }, { status: 500 });
  }
}
