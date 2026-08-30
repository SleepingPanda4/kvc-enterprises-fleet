import { requireUser } from "../../../auth/server";
import { getMgbaDswStatusPackagesForRouteRow } from "../../../../services/integrations/mgba-dsw";

export async function GET(request: Request) {
  const auth = await requireUser(request); if (auth instanceof Response) return auth;
  const routeRowId = Number(new URL(request.url).searchParams.get("routeRowId"));
  if (!Number.isSafeInteger(routeRowId) || routeRowId <= 0) return Response.json({ error: "Choose a valid Monitor route row.", code: "MONITOR_STATUS_PACKAGES_ROW_INVALID" }, { status: 400 });
  try { const result = await getMgbaDswStatusPackagesForRouteRow(routeRowId); return result ? Response.json(result) : Response.json({ error: "That Monitor route row was not found.", code: "MONITOR_STATUS_PACKAGES_NOT_FOUND" }, { status: 404 }); }
  catch { return Response.json({ error: "Status package details could not be loaded.", code: "MONITOR_STATUS_PACKAGES_READ_FAILED" }, { status: 500 }); }
}
