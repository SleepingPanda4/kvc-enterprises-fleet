import { requireManager } from "../../../auth/server";
import { HomebaseCollectorError, requestHomebaseCollection } from "../../../../services/integrations/homebase-collector";

export async function POST(request: Request) {
  const auth = await requireManager(request);
  if (auth instanceof Response) return auth;

  try {
    return Response.json(await requestHomebaseCollection());
  } catch (error) {
    if (error instanceof HomebaseCollectorError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.status });
    }
    const errorId = crypto.randomUUID();
    console.error("Homebase live collection request failed", { errorId });
    return Response.json({ error: "Homebase assignments could not be refreshed.", code: "HOMEBASE_COLLECTION_FAILED", errorId }, { status: 500 });
  }
}
