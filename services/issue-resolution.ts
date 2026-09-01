export const MAX_RESOLUTION_NOTES_LENGTH = 10_000;

export function normalizeResolutionNotes(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const notes = value.trim();
  return notes.length > 0 && notes.length <= MAX_RESOLUTION_NOTES_LENGTH ? notes : null;
}
