import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { decideFreshEnrollmentProfile } from "./participant-session-store.js";

describe("decideFreshEnrollmentProfile", () => {
  const base = {
    enrollmentAgentId: "agent-1",
    enrollmentQualifier: "ThinkworkProof",
    enrollmentVersion: "6",
    requestedAgentId: "agent-1",
    requestedQualifier: "ThinkworkProof",
    requestedVersion: "6",
  };

  it("keeps an enrollment already on the requested version", () => {
    expect(decideFreshEnrollmentProfile(base)).toBe("current");
  });

  it("advances a fresh-session enrollment when only the live version changed", () => {
    expect(
      decideFreshEnrollmentProfile({ ...base, requestedVersion: "13" }),
    ).toBe("advance_version");
  });

  it("fails closed when the logical agent changes", () => {
    expect(() =>
      decideFreshEnrollmentProfile({ ...base, requestedAgentId: "agent-2" }),
    ).toThrow("harness_enrollment_profile_drift");
  });

  it("fails closed when the endpoint qualifier changes", () => {
    expect(() =>
      decideFreshEnrollmentProfile({
        ...base,
        requestedQualifier: "DifferentEndpoint",
      }),
    ).toThrow("harness_enrollment_profile_drift");
  });
});

describe("fresh-session rollout publication fence", () => {
  it("does not reject an in-flight session only because a newer turn advanced the enrollment version", () => {
    const source = readFileSync(
      new URL("./participant-session-store.ts", import.meta.url),
      "utf8",
    );
    const finalizeSource = readFileSync(
      new URL("../chat-finalize/process-finalize.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toContain(
      "he.resolved_version = ${harnessParticipantSessions.resolved_version}",
    );
    expect(finalizeSource).not.toContain(
      "he.resolved_version = hs.resolved_version",
    );
    expect(source).toContain(
      "he.qualifier = ${harnessParticipantSessions.qualifier}",
    );
  });
});
