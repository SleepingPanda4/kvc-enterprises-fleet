"use client";
/* eslint-disable @next/next/no-img-element -- local previews are object URLs, not remote content */

import { useMemo } from "react";

export function attachmentSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function IssueAttachmentPicker({ files, onChange }: { files: File[]; onChange: (files: File[]) => void }) {
  const previews = useMemo(() => files.map(file => file.type.startsWith("image/") ? URL.createObjectURL(file) : ""), [files]);
  return <div className="issue-attachment-picker wide"><label>Photos / Videos<input type="file" accept="image/*,video/*" multiple onChange={event => { onChange([...files, ...Array.from(event.target.files || [])]); event.currentTarget.value = ""; }} /></label><small className="field-hint">JPEG, PNG, WebP, GIF, MP4, MOV, or WebM. Up to 25 MB each.</small>{files.length > 0 && <div className="issue-attachment-preview">{files.map((file, index) => <div key={`${file.name}-${index}`}><>{previews[index] ? <img src={previews[index]} alt="Selected attachment preview" /> : <span className="attachment-video-icon">▶</span>}</><p><strong>{file.name}</strong><small>{attachmentSize(file.size)}</small></p><button type="button" className="delete-row-btn" onClick={() => onChange(files.filter((_, current) => current !== index))} aria-label={`Remove ${file.name}`}>×</button></div>)}</div>}</div>;
}
