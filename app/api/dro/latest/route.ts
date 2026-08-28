import { requireUser } from "../../../auth/server";
import { getLatestDroSnapshot } from "../../../../services/integrations/dro";

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  try {
    const result = await getLatestDroSnapshot();
    return result
      ? Response.json(result)
      : Response.json({ snapshot: null, rows: [] });
  } catch (error) {
    const errorId = crypto.randomUUID();
    console.error("Latest DRO snapshot read failed", { errorId, error });
    return Response.json({ error: "The latest DRO snapshot could not be loaded.", code: "DRO_READ_FAILED", errorId }, { status: 500 });
  }
}
