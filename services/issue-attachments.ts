import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { asc, eq } from "drizzle-orm";
import { getDb, type Database } from "../db";
import { issueAttachments } from "../db/schema";
import { MAX_ISSUE_ATTACHMENTS_PER_ISSUE, validateIssueAttachmentFiles } from "./issue-attachment-validation";
export { MAX_ISSUE_ATTACHMENT_BYTES, MAX_ISSUE_ATTACHMENTS_PER_OPERATION, MAX_ISSUE_ATTACHMENTS_PER_ISSUE, ISSUE_ATTACHMENT_MIME_TYPES, validateIssueAttachmentFiles } from "./issue-attachment-validation";
export type AttachmentContext = "report" | "resolution" | "update";
export type PublicIssueAttachment = { publicId: string; originalFilename: string; mimeType: string; sizeBytes: number; context: AttachmentContext; createdAt: string };

export function publicIssueAttachment(attachment: typeof issueAttachments.$inferSelect): PublicIssueAttachment {
  return { publicId: attachment.publicId, originalFilename: attachment.originalFilename, mimeType: attachment.mimeType, sizeBytes: attachment.sizeBytes, context: attachment.context, createdAt: attachment.createdAt };
}

export function issueUploadRoot() {
  return process.env.ISSUE_UPLOAD_ROOT || "/var/lib/kvc-fleet/uploads/issues";
}

function safeExtension(mimeType: string) {
  return ({ "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif", "video/mp4": ".mp4", "video/quicktime": ".mov", "video/webm": ".webm" } as Record<string, string>)[mimeType] || "";
}

export async function listIssueAttachments(issueId: number, database: Database = getDb()) {
  return database.select().from(issueAttachments).where(eq(issueAttachments.issueId, issueId)).orderBy(asc(issueAttachments.id));
}

export async function saveIssueAttachments(issueId: number, files: File[], context: AttachmentContext, database: Database = getDb()) {
  const validationError = validateIssueAttachmentFiles(files);
  if (validationError) throw new Error(validationError);
  if (files.length === 0) return [];
  const existing = await listIssueAttachments(issueId, database);
  if (existing.length + files.length > MAX_ISSUE_ATTACHMENTS_PER_ISSUE) throw new Error(`An issue can have up to ${MAX_ISSUE_ATTACHMENTS_PER_ISSUE} attachments.`);
  const directory = path.join(issueUploadRoot(), String(issueId));
  await mkdir(directory, { recursive: true, mode: 0o750 });
  const saved: Array<{ storedFilename: string; fullPath: string }> = [];
  try {
    const values = [];
    for (const file of files) {
      const storedFilename = `${randomUUID()}${safeExtension(file.type)}`;
      const fullPath = path.join(directory, storedFilename);
      await writeFile(fullPath, Buffer.from(await file.arrayBuffer()), { mode: 0o640 });
      saved.push({ storedFilename, fullPath });
      values.push({ publicId: randomUUID(), issueId, originalFilename: path.basename(file.name || "attachment"), storedFilename, mimeType: file.type, sizeBytes: file.size, context });
    }
    return await database.insert(issueAttachments).values(values).returning();
  } catch (error) {
    await Promise.all(saved.map(file => rm(file.fullPath, { force: true }).catch(() => undefined)));
    throw error;
  }
}

export async function readIssueAttachment(publicId: string, database: Database = getDb()) {
  if (!publicId || /^\d+$/.test(publicId)) return null;
  const [attachment] = await database.select().from(issueAttachments).where(eq(issueAttachments.publicId, publicId)).limit(1);
  if (!attachment) return null;
  const root = path.resolve(issueUploadRoot());
  const filePath = path.resolve(root, String(attachment.issueId), attachment.storedFilename);
  if (!filePath.startsWith(`${root}${path.sep}`)) return null;
  try { return { attachment, content: await readFile(filePath) }; } catch { return null; }
}

export async function removeIssueAttachmentFiles(issueId: number) {
  await rm(path.join(issueUploadRoot(), String(issueId)), { recursive: true, force: true });
}
