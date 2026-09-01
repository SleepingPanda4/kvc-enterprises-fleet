import { readIssueAttachment } from "../../../../../services/issue-attachments";
import { requireUser } from "../../../../auth/server";

export async function GET(request: Request, { params }: { params: Promise<{ attachmentId: string }> }) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;
  const { attachmentId } = await params;
  const attachment = await readIssueAttachment(attachmentId);
  if (!attachment) return Response.json({ error: "Attachment not found" }, { status: 404 });
  return new Response(attachment.content, { headers: { "Content-Type": attachment.attachment.mimeType, "Content-Length": String(attachment.attachment.sizeBytes), "Content-Disposition": `inline; filename="${attachment.attachment.originalFilename.replaceAll('"', "")}"`, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=3600" } });
}
