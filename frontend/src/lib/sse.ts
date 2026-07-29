/**
 * Server-Sent Events framing.
 *
 * Split out from the network layer so the byte-level rules — frame boundaries,
 * CRLF handling, comment lines, multi-line `data:` — are testable without a
 * stream. `parseSseBuffer` is incremental: it returns the frames it could
 * complete plus the unconsumed remainder, which the reader carries into the
 * next chunk.
 */

export interface SseFrame {
  /** The `event:` name, when the frame carried one. */
  event?: string;
  /** Concatenated `data:` lines, joined with newlines. */
  data: string;
}

export interface SseParseResult {
  frames: SseFrame[];
  rest: string;
}

/**
 * Consume every complete frame in `buffer`.
 *
 * A network chunk can split a CRLF pair down the middle, so a trailing lone
 * `\r` is held back rather than normalized — otherwise it would look like a
 * completed line and could fabricate a frame boundary that the server never
 * sent.
 */
export function parseSseBuffer(buffer: string): SseParseResult {
  const pendingCr = buffer.endsWith("\r");
  const body = pendingCr ? buffer.slice(0, -1) : buffer;
  const normalized = body.replace(/\r\n|\r/g, "\n");

  const frames: SseFrame[] = [];
  let remainder = normalized;

  let boundary = remainder.indexOf("\n\n");
  while (boundary !== -1) {
    const frame = parseFrame(remainder.slice(0, boundary));
    if (frame) frames.push(frame);
    remainder = remainder.slice(boundary + 2);
    boundary = remainder.indexOf("\n\n");
  }

  return { frames, rest: pendingCr ? `${remainder}\r` : remainder };
}

function parseFrame(raw: string): SseFrame | null {
  let event: string | undefined;
  const data: string[] = [];

  for (const line of raw.split("\n")) {
    // A leading colon marks a comment; servers use it for keep-alive pings.
    if (!line || line.startsWith(":")) continue;

    const separator = line.indexOf(":");
    const field = separator === -1 ? line : line.slice(0, separator);
    let value = separator === -1 ? "" : line.slice(separator + 1);
    // Exactly one optional space after the colon belongs to the framing.
    if (value.startsWith(" ")) value = value.slice(1);

    if (field === "event") event = value.trim();
    else if (field === "data") data.push(value);
  }

  if (event === undefined && data.length === 0) return null;
  return { event, data: data.join("\n") };
}
