import { requireManager } from "../../../auth/server";
import { DroCollectorError, requestDroCollection } from "../../../../services/integrations/dro-collector";

export async function POST(request: Request) {
  const auth = await requireManager(request);
  if (auth instanceof Response) return auth;

  try {
    return Response.json(await requestDroCollection());
  } catch (error) {
    if (error instanceof DroCollectorError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.status });
    }
    const errorId = crypto.randomUUID();
    console.error("DRO live collection request failed", { errorId });
    return Response.json({ error: "DRO collection could not be completed.", code: "DRO_COLLECTION_FAILED", errorId }, { status: 500 });
  }
}
