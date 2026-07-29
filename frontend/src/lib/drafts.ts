/**
 * Unsent text, held across a sign-in interruption.
 *
 * When a session ends mid-question the reader is moved to the login screen, and
 * without this their typing would be gone by the time they came back. The store
 * is module-level memory for the same reason the access token is: a draft can
 * contain the substance of a confidential question, so it must not outlive the
 * tab or become readable by another one. It is not persisted anywhere.
 */

const drafts = new Map<string, string>();

/** Named so several forms can keep independent drafts. */
export type DraftKey = "question";

export function saveDraft(key: DraftKey, value: string): void {
  if (value.trim()) drafts.set(key, value);
  else drafts.delete(key);
}

export function readDraft(key: DraftKey): string {
  return drafts.get(key) ?? "";
}

export function clearDraft(key: DraftKey): void {
  drafts.delete(key);
}

/**
 * Drop every draft.
 *
 * Called on explicit sign-out — a deliberate exit should not leave one user's
 * unsent question on screen for whoever signs in next. An *expired* session
 * deliberately does not clear drafts: that reader is coming back.
 */
export function clearAllDrafts(): void {
  drafts.clear();
}
