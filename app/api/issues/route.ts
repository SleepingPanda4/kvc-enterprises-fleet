import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { issues } from "../../../db/schema";
import { publicIssueAttachment, removeIssueAttachmentFiles, saveIssueAttachments } from "../../../services/issue-attachments";
import { requireManager, requireUser } from "../../auth/server";
import { getVehicleIssueTickets } from "../../../services/vehicle-issues";

function filesFromFormData(formData: FormData) {
  return formData.getAll("attachments").filter((value): value is File => typeof value !== "string");
}

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;
  try { return Response.json({ issues: await getVehicleIssueTickets() }); }
  catch { return Response.json({ error: "Could not load issue tickets." }, { status: 500 }); }
}

export async function POST(request: Request) {
  const auth = await requireManager(request);
  if (auth instanceof Response) return auth;
  try {
    const isMultipart = request.headers.get("content-type")?.includes("multipart/form-data") || false;
    const formData = isMultipart ? await request.formData() : null;
    const jsonPayload = isMultipart ? null : await request.json() as Record<string, string>;
    const value = (name: string) => formData ? formData.get(name) : jsonPayload?.[name];
    const vehicleId = Number(value("vehicleId"));
    const notesValue = value("notes");
    const typeValue = value("type");
    const customTypeValue = value("customType");
    const notes = typeof notesValue === "string" ? notesValue.trim() : "";
    const type = typeValue === "Other" ? (typeof customTypeValue === "string" ? customTypeValue.trim() : "") : typeValue;
    if (!vehicleId || !notes || typeof type !== "string" || !type.trim()) return Response.json({ error: "Vehicle, type, and notes are required" }, { status: 400 });
    const [issue] = await getDb().insert(issues).values({ vehicleId, type: type.trim(), notes, reportedByUserId: auth.id, reportedByName: auth.name }).returning();
    const files = formData ? filesFromFormData(formData) : [];
    try {
      const attachments = await saveIssueAttachments(issue.id, files, "report");
      return Response.json({ issue, attachments: attachments.map(publicIssueAttachment) }, { status: 201 });
    } catch (error) {
      await getDb().delete(issues).where(eq(issues.id, issue.id));
      await removeIssueAttachmentFiles(issue.id).catch(() => undefined);
      return Response.json({ error: error instanceof Error ? error.message : "Attachments could not be saved; the issue was not created." }, { status: 400 });
    }
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not report issue" }, { status: 500 });
  }
}
