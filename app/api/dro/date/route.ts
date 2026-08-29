import { requireUser } from "../../../auth/server";
import { getDroDateNavigation, getDroSnapshotsForDate } from "../../../../services/integrations/dro";

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  try {
    const operationalDate = new URL(request.url).searchParams.get("date")?.trim() || "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(operationalDate)) {
      return Response.json({ error: "Use an operational date in YYYY-MM-DD format.", code: "DRO_DATE_INVALID" }, { status: 400 });
    }
    const [snapshots, navigation] = await Promise.all([
      getDroSnapshotsForDate(operationalDate),
      getDroDateNavigation(operationalDate),
    ]);
    return Response.json({ operationalDate, snapshots, ...navigation });
  } catch (error) {
    const errorId = crypto.randomUUID();
    console.error("DRO date snapshot read failed", { errorId, error });
    return Response.json({ error: "DRO snapshots for that date could not be loaded.", code: "DRO_DATE_READ_FAILED", errorId }, { status: 500 });
  }
}
