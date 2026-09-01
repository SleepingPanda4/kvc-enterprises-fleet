export const MAX_ISSUE_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_ISSUE_ATTACHMENTS_PER_OPERATION = 8;
export const MAX_ISSUE_ATTACHMENTS_PER_ISSUE = 32;
export const ISSUE_ATTACHMENT_MIME_TYPES = new Set([
  "image/jpeg", "image/png", "image/webp", "image/gif",
  "video/mp4", "video/quicktime", "video/webm",
]);

export function validateIssueAttachmentFiles(files: File[]) {
  if (files.length > MAX_ISSUE_ATTACHMENTS_PER_OPERATION) return `You can add up to ${MAX_ISSUE_ATTACHMENTS_PER_OPERATION} files at a time.`;
  for (const file of files) {
    if (!ISSUE_ATTACHMENT_MIME_TYPES.has(file.type)) return `${file.name || "This file"} is not a supported image or video.`;
    if (file.size <= 0) return `${file.name || "This file"} is empty.`;
    if (file.size > MAX_ISSUE_ATTACHMENT_BYTES) return `${file.name || "This file"} exceeds the 25 MB size limit.`;
  }
  return null;
}
