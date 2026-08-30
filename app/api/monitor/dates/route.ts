import { requireUser } from "../../../auth/server";
import { listMgbaDswOperationalDates } from "../../../../services/integrations/mgba-dsw";
export async function GET(request: Request) { const auth = await requireUser(request); if (auth instanceof Response) return auth; try { const dates = await listMgbaDswOperationalDates(); return Response.json({ dates, latestDate: dates[0]?.operationalDate || null }); } catch { return Response.json({ error: "Monitor dates could not be loaded.", code: "MONITOR_DATES_READ_FAILED" }, { status: 500 }); } }
