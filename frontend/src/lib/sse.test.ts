import { describe, expect, it } from "vitest";

import { parseSseBuffer } from "./sse";

describe("parseSseBuffer", () => {
  it("parses a complete frame and consumes it", () => {
    const { frames, rest } = parseSseBuffer('event: routing\ndata: {"next":"web"}\n\n');

    expect(frames).toEqual([{ event: "routing", data: '{"next":"web"}' }]);
    expect(rest).toBe("");
  });

  it("returns an incomplete frame as the remainder", () => {
    const { frames, rest } = parseSseBuffer("event: routing\ndata: {");

    expect(frames).toHaveLength(0);
    expect(rest).toBe("event: routing\ndata: {");
  });

  it("parses several frames from one chunk", () => {
    const { frames } = parseSseBuffer(
      "event: run_started\ndata: {}\n\nevent: generating\ndata: {}\n\n",
    );

    expect(frames.map((frame) => frame.event)).toEqual([
      "run_started",
      "generating",
    ]);
  });

  it("handles CRLF line endings", () => {
    const { frames, rest } = parseSseBuffer("event: completed\r\ndata: {}\r\n\r\n");

    expect(frames).toEqual([{ event: "completed", data: "{}" }]);
    expect(rest).toBe("");
  });

  it("holds back a trailing CR so a split CRLF cannot fake a boundary", () => {
    // "\r" here is the first half of a "\r\n" that lands in the next chunk.
    const { frames, rest } = parseSseBuffer("event: routing\r\ndata: {}\r");

    expect(frames).toHaveLength(0);
    expect(rest.endsWith("\r")).toBe(true);

    const next = parseSseBuffer(`${rest}\n\r\n`);
    expect(next.frames).toEqual([{ event: "routing", data: "{}" }]);
  });

  it("ignores comment keep-alive lines", () => {
    const { frames } = parseSseBuffer(": ping\n\nevent: generating\ndata: {}\n\n");

    expect(frames).toEqual([{ event: "generating", data: "{}" }]);
  });

  it("joins multi-line data payloads", () => {
    const { frames } = parseSseBuffer("event: completed\ndata: one\ndata: two\n\n");

    expect(frames[0].data).toBe("one\ntwo");
  });

  it("strips only the single framing space after the colon", () => {
    const { frames } = parseSseBuffer("event: completed\ndata:  padded\n\n");

    expect(frames[0].data).toBe(" padded");
  });
});
