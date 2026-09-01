"use client";
/* eslint-disable @next/next/no-img-element -- media is served through the authenticated application endpoint */

export type IssueAttachment = { publicId: string; originalFilename: string; mimeType: string; sizeBytes: number; context: "report" | "resolution" | "update" };

export function IssueAttachmentGallery({ attachments, error }: { attachments: IssueAttachment[]; error: string }) {
  return <div className="issue-attachment-gallery"><strong>Photos / Videos</strong>{error && <p className="form-error">{error}</p>}{attachments.length === 0 && !error ? <p>No attachments recorded.</p> : <div>{attachments.map(attachment => <figure key={attachment.publicId} className="issue-attachment-item"><a href={`/api/issues/attachments/${attachment.publicId}`} target="_blank" rel="noreferrer">{attachment.mimeType.startsWith("image/") ? <img src={`/api/issues/attachments/${attachment.publicId}`} alt={attachment.originalFilename} /> : <video controls preload="metadata"><source src={`/api/issues/attachments/${attachment.publicId}`} type={attachment.mimeType} /><track kind="captions" /></video>}</a><figcaption>{attachment.context === "resolution" ? "Resolution" : attachment.context === "update" ? "Added later" : "Reported"} · {attachment.originalFilename}</figcaption></figure>)}</div>}</div>;
}
