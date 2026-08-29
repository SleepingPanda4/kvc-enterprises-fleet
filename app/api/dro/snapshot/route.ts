import { requireUser } from "../../../auth/server";
import { getDroSnapshotById } from "../../../../services/integrations/dro";

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  try {
    const snapshotId = Number(new URL(request.url).searchParams.get("id"));
    if (!Number.isSafeInteger(snapshotId) || snapshotId <= 0) {
      return Response.json({ error: "Choose a valid DRO snapshot.", code: "DRO_SNAPSHOT_ID_INVALID" }, { status: 400 });
    }
    const result = await getDroSnapshotById(snapshotId);
    return result
      ? Response.json(result)
      : Response.json({ error: "That DRO snapshot was not found.", code: "DRO_SNAPSHOT_NOT_FOUND" }, { status: 404 });
  } catch (error) {
    const errorId = crypto.randomUUID();
    console.error("DRO snapshot read failed", { errorId, error });
    return Response.json({ error: "The DRO snapshot could not be loaded.", code: "DRO_SNAPSHOT_READ_FAILED", errorId }, { status: 500 });
  }
}
