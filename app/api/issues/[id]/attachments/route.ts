import { eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { issues } from "../../../../../db/schema";
import { listIssueAttachments, publicIssueAttachment, saveIssueAttachments } from "../../../../../services/issue-attachments";
import { requireManager, requireUser } from "../../../../auth/server";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;
  const { id } = await params;
  const issueId = Number(id);
  if (!Number.isInteger(issueId)) return Response.json({ error: "Issue not found" }, { status: 404 });
  return Response.json({ attachments: (await listIssueAttachments(issueId)).map(publicIssueAttachment) });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireManager(request);
  if (auth instanceof Response) return auth;
  const { id } = await params;
  const issueId = Number(id);
  const [issue] = await getDb().select().from(issues).where(eq(issues.id, issueId)).limit(1);
  if (!issue) return Response.json({ error: "Issue not found" }, { status: 404 });
  try {
    const formData = await request.formData();
    const context = formData.get("context");
    if (context !== "report" && context !== "resolution" && context !== "update") return Response.json({ error: "Invalid attachment context" }, { status: 400 });
    const files = formData.getAll("attachments").filter((value): value is File => typeof value !== "string");
    const attachments = await saveIssueAttachments(issue.id, files, context);
    return Response.json({ attachments: attachments.map(publicIssueAttachment) }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Attachments could not be saved." }, { status: 400 });
  }
}
