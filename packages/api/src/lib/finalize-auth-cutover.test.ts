import { describe, expect, it } from "vitest";

import { parseAuthCutoverCompletionEvidence } from "../../scripts/finalize-auth-cutover.js";

const valid = {
  inventoryFingerprint: "a".repeat(64),
  terminalDispositions: {
    allTerminal: true,
    unresolved: 0,
    signoutFailures: 0,
    compatibilityFallbackReads: 0,
  },
  clientShutdownEvidence: {
    workosStartsEnabled: false,
    legacyClientsEnabled: 0,
    legacyAudiencesAccepted: 0,
  },
  drainEvidence: {
    drainCompleted: true,
    legacyRouteTraffic: 0,
    workosTableReads: 0,
    workosTableWrites: 0,
    activeLegacySubscriptions: 0,
  },
};

describe("auth cutover finalization evidence", () => {
  it("accepts only a fully drained cutover", () => {
    expect(parseAuthCutoverCompletionEvidence(valid)).toEqual(valid);
  });

  it.each([
    [
      "unresolved identities",
      {
        terminalDispositions: { ...valid.terminalDispositions, unresolved: 1 },
      },
    ],
    [
      "legacy audiences",
      {
        clientShutdownEvidence: {
          ...valid.clientShutdownEvidence,
          legacyAudiencesAccepted: 1,
        },
      },
    ],
    [
      "table writes",
      { drainEvidence: { ...valid.drainEvidence, workosTableWrites: 1 } },
    ],
  ])("rejects %s", (_label, override) => {
    expect(() =>
      parseAuthCutoverCompletionEvidence({ ...valid, ...override }),
    ).toThrow(/must equal/);
  });

  it("rejects unknown fields so evidence cannot hide ambiguous data", () => {
    expect(() =>
      parseAuthCutoverCompletionEvidence({ ...valid, ignored: true }),
    ).toThrow(/must contain exactly/);
  });
});
