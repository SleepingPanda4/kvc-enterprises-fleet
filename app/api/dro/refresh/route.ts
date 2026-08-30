import { requireManager } from "../../../auth/server";
import { DroCollectorError } from "../../../../services/integrations/dro-collector";
import { DroRefreshWindowError, requestManualDroCollection } from "../../../../services/integrations/dro-refresh-window";

export async function POST(request: Request) {
  const auth = await requireManager(request);
  if (auth instanceof Response) return auth;

  try {
    return Response.json(await requestManualDroCollection());
  } catch (error) {
    if (error instanceof DroRefreshWindowError) {
      return Response.json({ error: "DRO_REFRESH_OUTSIDE_WINDOW", message: error.message }, { status: 403 });
    }
    if (error instanceof DroCollectorError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.status });
    }
    const errorId = crypto.randomUUID();
    console.error("DRO live collection request failed", { errorId });
    return Response.json({ error: "DRO collection could not be completed.", code: "DRO_COLLECTION_FAILED", errorId }, { status: 500 });
  }
}
