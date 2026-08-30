import { requireUser } from "../../auth/server";
import { getOverviewData } from "../../../services/overview";

export async function GET(request: Request) {
  const auth = await requireUser(request); if (auth instanceof Response) return auth;
  try {
    return Response.json(await getOverviewData());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not load overview." }, { status: 500 });
  }
}
