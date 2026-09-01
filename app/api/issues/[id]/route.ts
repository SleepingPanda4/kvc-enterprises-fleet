import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { issues } from "../../../../db/schema";
import { publicIssueAttachment, saveIssueAttachments } from "../../../../services/issue-attachments";
import { normalizeResolutionNotes } from "../../../../services/issue-resolution";
import { requireManager } from "../../../auth/server";

type IssueUpdate = { status?: "open" | "resolved"; serviceScheduled?: boolean; resolutionNotes?: unknown; notes?: unknown; type?: unknown };

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireManager(request);
  if (auth instanceof Response) return auth;
  const { id } = await params;
  const issueId = Number(id);
  if (!Number.isInteger(issueId) || issueId <= 0) return Response.json({ error: "Issue not found" }, { status: 404 });

  const isMultipart = request.headers.get("content-type")?.includes("multipart/form-data");
  let payload: IssueUpdate;
  let files: File[] = [];
  try {
    if (isMultipart) {
      const formData = await request.formData();
      payload = Object.fromEntries([...formData.entries()].filter(([, value]) => typeof value === "string")) as IssueUpdate;
      files = formData.getAll("attachments").filter((value): value is File => typeof value !== "string");
    } else payload = await request.json() as IssueUpdate;
  } catch { return Response.json({ error: "Invalid issue update" }, { status: 400 }); }
  const hasResolutionNotes = Object.hasOwn(payload, "resolutionNotes");
  const hasNotes = Object.hasOwn(payload, "notes");
  const hasType = Object.hasOwn(payload, "type");
  if (payload.status === undefined && typeof payload.serviceScheduled !== "boolean" && !hasResolutionNotes && !hasNotes && !hasType && files.length === 0) return Response.json({ error: "Invalid issue update" }, { status: 400 });
  if (payload.status !== undefined && !["open", "resolved"].includes(payload.status)) return Response.json({ error: "Invalid status" }, { status: 400 });

  const db = getDb();
  const [existing] = await db.select().from(issues).where(eq(issues.id, issueId)).limit(1);
  if (!existing) return Response.json({ error: "Issue not found" }, { status: 404 });
  const normalizedResolutionNotes = hasResolutionNotes ? normalizeResolutionNotes(payload.resolutionNotes) : null;
  const notes = hasNotes && typeof payload.notes === "string" ? payload.notes.trim() : null;
  const type = hasType && typeof payload.type === "string" ? payload.type.trim() : null;
  if (hasResolutionNotes && !normalizedResolutionNotes) return Response.json({ error: "Resolution information is required and must be 10,000 characters or fewer." }, { status: 400 });
  if (hasNotes && !notes) return Response.json({ error: "Issue description cannot be empty." }, { status: 400 });
  if (hasType && !type) return Response.json({ error: "Issue type cannot be empty." }, { status: 400 });
  const isNewResolution = existing.status === "open" && payload.status === "resolved";
  if (isNewResolution && !normalizedResolutionNotes) return Response.json({ error: "Resolution information is required before resolving an issue." }, { status: 400 });
  if (hasResolutionNotes && existing.status !== "resolved" && !isNewResolution) return Response.json({ error: "Resolution information can only be recorded for a resolved issue." }, { status: 400 });

  // Save media first. If that fails, no status/notes change is reported as complete.
  let attachments: Awaited<ReturnType<typeof saveIssueAttachments>> = [];
  try { attachments = await saveIssueAttachments(issueId, files, isNewResolution ? "resolution" : "update", db); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Attachments could not be saved." }, { status: 400 }); }
  const updates: Partial<typeof issues.$inferInsert> = {};
  if (payload.status !== undefined && payload.status !== existing.status) { updates.status = payload.status; updates.resolvedAt = payload.status === "resolved" ? new Date().toISOString() : null; }
  if (hasResolutionNotes && normalizedResolutionNotes) updates.resolutionNotes = normalizedResolutionNotes;
  if (hasNotes && notes) updates.notes = notes;
  if (hasType && type) updates.type = type;
  if (typeof payload.serviceScheduled === "boolean") updates.serviceScheduled = payload.serviceScheduled;
  const row = Object.keys(updates).length === 0 ? existing : (await db.update(issues).set(updates).where(eq(issues.id, issueId)).returning())[0];
  return Response.json({ issue: row, attachments: attachments.map(publicIssueAttachment) });
}
