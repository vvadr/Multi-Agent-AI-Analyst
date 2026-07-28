import { describe, expect, it } from "vitest";

import {
  componentState,
  parseReadinessReport,
  READINESS_COMPONENTS,
} from "./readiness";

const validBody = {
  status: "ready",
  components: {
    database: { configured: true, reachable: true },
    model: { configured: true, reachable: true },
    qdrant: { configured: true, reachable: true },
    object_storage: { configured: true, reachable: true },
  },
};

describe("componentState", () => {
  it("distinguishes not-configured from unreachable", () => {
    expect(componentState({ configured: false, reachable: false })).toBe(
      "not_configured",
    );
    expect(componentState({ configured: true, reachable: false })).toBe(
      "unreachable",
    );
    expect(componentState({ configured: true, reachable: true })).toBe("ready");
  });

  it("treats an unconfigured component as not-configured regardless of reachable", () => {
    expect(componentState({ configured: false, reachable: true })).toBe(
      "not_configured",
    );
  });
});

describe("parseReadinessReport", () => {
  it("accepts a well-formed report", () => {
    const report = parseReadinessReport(validBody);
    expect(report).not.toBeNull();
    expect(report?.status).toBe("ready");
    for (const name of READINESS_COMPONENTS) {
      expect(report?.components[name]).toEqual({ configured: true, reachable: true });
    }
  });

  it("accepts not_ready with mixed component states", () => {
    const report = parseReadinessReport({
      status: "not_ready",
      components: {
        ...validBody.components,
        qdrant: { configured: false, reachable: false },
      },
    });
    expect(report?.status).toBe("not_ready");
    expect(report?.components.qdrant).toEqual({
      configured: false,
      reachable: false,
    });
  });

  it.each([
    ["null", null],
    ["a string", "ready"],
    ["a missing status", { components: validBody.components }],
    ["an unknown status", { status: "degraded", components: validBody.components }],
    ["missing components", { status: "ready" }],
    [
      "a missing component key",
      {
        status: "ready",
        components: { database: { configured: true, reachable: true } },
      },
    ],
    [
      "the legacy boolean component shape",
      {
        status: "ready",
        components: { database: true, model: true, qdrant: true, object_storage: true },
      },
    ],
    [
      "a non-boolean field",
      {
        status: "ready",
        components: { ...validBody.components, model: { configured: "yes", reachable: true } },
      },
    ],
  ])("rejects %s", (_label, value) => {
    expect(parseReadinessReport(value)).toBeNull();
  });
});
