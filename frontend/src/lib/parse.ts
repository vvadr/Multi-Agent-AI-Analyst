/**
 * Small defensive readers shared by the response parsers.
 *
 * Every backend payload is treated as unknown input: the parsers read named
 * fields with an explicit type check rather than casting a whole object into a
 * TypeScript interface, so a contract drift shows up as a handled parse failure
 * instead of an `undefined` blowing up mid-render.
 */

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

/** First key that holds a non-empty string, trimmed. */
export function readString(
  source: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

/** First key that holds a finite number. Rejects NaN and Infinity. */
export function readNumber(
  source: Record<string, unknown>,
  ...keys: string[]
): number | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}
