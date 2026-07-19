import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  AUTH_CUTOVER_MIN_SAFE_SOAK_SECONDS,
  attestAuthCutoverCompletionEvidence,
  mergeObservedCutoverEvidence,
  parseAuthCutoverCompletionEvidence,
  validateStoredCutoverSoak,
  verifyAuthCutoverCompletionEvidence,
} from "../../scripts/finalize-auth-cutover.js";

const NOW = Date.parse("2026-07-18T21:00:00.000Z");
const REVISION = "b".repeat(40);
const RUN_ID = "11111111-1111-4111-8111-111111111111";
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const verifier = readFileSync(
  new URL("../../../../scripts/verify-native-auth-cutover.sh", import.meta.url),
  "utf8",
);

const valid = {
  schemaVersion: 1,
  domain: "thinkwork.auth-cutover-evidence.v1",
  source: "verify-native-auth-cutover",
  stage: "prod",
  runId: RUN_ID,
  deploymentRevision: REVISION,
  observedAt: "2026-07-18T20:55:00.000Z",
  expiresAt: "2026-07-18T21:05:00.000Z",
  inventoryFingerprint: "a".repeat(64),
  terminalDispositions: {
    allTerminal: true,
    unresolved: 0,
    signoutExpected: 7,
    signoutAttempts: 7,
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
    databaseStatsResetAt: "2026-07-17T18:00:00.000Z",
  },
} as const;

describe("auth cutover finalization evidence", () => {
  it("accepts only a fully drained cutover", () => {
    expect(parseAuthCutoverCompletionEvidence(valid)).toEqual(valid);
  });

  it("requires a revision-bound soak window to elapse before completion", () => {
    expect(
      validateStoredCutoverSoak(
        {
          guardEnabled: true,
          soakStartedAt: "2026-07-17T19:30:00.000Z",
          requiredSoakSeconds: AUTH_CUTOVER_MIN_SAFE_SOAK_SECONDS,
          deploymentRevision: REVISION,
          baselineWorkosTableReads: 10,
          baselineWorkosTableWrites: 4,
          baselineDatabaseStatsResetAt: "2026-07-17T18:00:00.000Z",
        },
        valid,
      ),
    ).toMatchObject({
      requiredSoakSeconds: AUTH_CUTOVER_MIN_SAFE_SOAK_SECONDS,
    });
    expect(() =>
      validateStoredCutoverSoak(
        {
          guardEnabled: true,
          soakStartedAt: "2026-07-18T20:30:00.000Z",
          requiredSoakSeconds: AUTH_CUTOVER_MIN_SAFE_SOAK_SECONDS,
          deploymentRevision: REVISION,
          baselineWorkosTableReads: 10,
          baselineWorkosTableWrites: 4,
          baselineDatabaseStatsResetAt: "2026-07-17T18:00:00.000Z",
        },
        valid,
      ),
    ).toThrow(/has not elapsed/);
  });

  it("rejects soak evidence from another deployment revision", () => {
    expect(() =>
      validateStoredCutoverSoak(
        {
          guardEnabled: true,
          soakStartedAt: "2026-07-18T20:00:00.000Z",
          requiredSoakSeconds: AUTH_CUTOVER_MIN_SAFE_SOAK_SECONDS,
          deploymentRevision: "c".repeat(40),
          baselineWorkosTableReads: 0,
          baselineWorkosTableWrites: 0,
          baselineDatabaseStatsResetAt: "2026-07-17T18:00:00.000Z",
        },
        valid,
      ),
    ).toThrow(/revision/);
  });

  it("rejects an operator-selected soak below the explicit safe maximum", () => {
    expect(() =>
      validateStoredCutoverSoak(
        {
          guardEnabled: true,
          soakStartedAt: "2026-07-17T19:30:00.000Z",
          requiredSoakSeconds: AUTH_CUTOVER_MIN_SAFE_SOAK_SECONDS - 1,
          deploymentRevision: REVISION,
          baselineWorkosTableReads: 0,
          baselineWorkosTableWrites: 0,
          baselineDatabaseStatsResetAt: "2026-07-17T18:00:00.000Z",
        },
        valid,
      ),
    ).toThrow(/safe minimum/);
  });

  it("rejects a PostgreSQL statistics epoch change during the soak", () => {
    expect(() =>
      validateStoredCutoverSoak(
        {
          guardEnabled: true,
          soakStartedAt: "2026-07-17T19:30:00.000Z",
          requiredSoakSeconds: AUTH_CUTOVER_MIN_SAFE_SOAK_SECONDS,
          deploymentRevision: REVISION,
          baselineWorkosTableReads: 0,
          baselineWorkosTableWrites: 0,
          baselineDatabaseStatsResetAt: "2026-07-17T17:00:00.000Z",
        },
        valid,
      ),
    ).toThrow(/statistics reset epoch/);
  });

  it("keeps the live verifier aligned with the safe duration and monotonic-statistics contract", () => {
    expect(verifier).toContain("MAX_APPSYNC_CONNECTION_LIFETIME_SECONDS=86400");
    expect(verifier).toContain(
      'REQUIRED_SOAK_SECONDS\" -lt \"$MIN_SAFE_SOAK_SECONDS',
    );
    expect(verifier).toContain("FROM pg_stat_database");
    expect(verifier).toContain("statisticsResetEpochMatches");
    expect(verifier).toContain("statisticsCountersMonotonic");
    expect(verifier).toContain("admin-user-global-sign-out");
    expect(verifier).toContain("signoutExpected");
    expect(verifier).toContain("signoutAttempts");
    expect(verifier).toContain(".signoutAttempts == .signoutExpected");
    expect(verifier).not.toContain(
      "GREATEST(current_table_reads - baseline_table_reads, 0)",
    );
    expect(verifier).not.toContain(
      "GREATEST(current_table_writes - baseline_table_writes, 0)",
    );
  });

  it.each([
    [
      "unresolved identities",
      {
        terminalDispositions: { ...valid.terminalDispositions, unresolved: 1 },
      },
    ],
    [
      "partial per-principal global sign-out",
      {
        terminalDispositions: {
          ...valid.terminalDispositions,
          signoutAttempts: 6,
        },
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

  it("accepts only a signed, stage/revision-bound, fresh evidence envelope", () => {
    const envelope = attestAuthCutoverCompletionEvidence(valid, {
      keyId: "prod-auth-cutover-v1",
      privateKey,
    });

    expect(
      verifyAuthCutoverCompletionEvidence(envelope, {
        expectedKeyId: "prod-auth-cutover-v1",
        publicKey,
        stage: "prod",
        deploymentRevision: REVISION,
        nowMs: () => NOW,
      }),
    ).toEqual(valid);
  });

  it.each([
    ["wrong stage", { stage: "staging" }],
    ["wrong revision", { deploymentRevision: "c".repeat(40) }],
    ["expired evidence", { nowMs: () => Date.parse(valid.expiresAt) + 1 }],
  ])("rejects %s", (_label, override) => {
    const envelope = attestAuthCutoverCompletionEvidence(valid, {
      keyId: "prod-auth-cutover-v1",
      privateKey,
    });
    expect(() =>
      verifyAuthCutoverCompletionEvidence(envelope, {
        expectedKeyId: "prod-auth-cutover-v1",
        publicKey,
        stage: "prod",
        deploymentRevision: REVISION,
        nowMs: () => NOW,
        ...override,
      }),
    ).toThrow();
  });

  it("rejects a tampered signed payload", () => {
    const envelope = attestAuthCutoverCompletionEvidence(valid, {
      keyId: "prod-auth-cutover-v1",
      privateKey,
    });
    const tampered = {
      ...envelope,
      payload: {
        ...envelope.payload,
        drainEvidence: {
          ...envelope.payload.drainEvidence,
          drainCompleted: false,
        },
      },
    };
    expect(() =>
      verifyAuthCutoverCompletionEvidence(tampered, {
        expectedKeyId: "prod-auth-cutover-v1",
        publicKey,
        stage: "prod",
        deploymentRevision: REVISION,
        nowMs: () => NOW,
      }),
    ).toThrow(/signature/i);
  });

  it("preserves observed inventory evidence while adding completion gates", () => {
    const observed = {
      active: 12,
      quarantined: 2,
      workosDirectoryComplete: true,
      workosMapped: 12,
      workosQuarantined: 2,
      workosUnresolved: 0,
      findings: [],
      workosFindings: [],
    };
    expect(
      mergeObservedCutoverEvidence(observed, valid.terminalDispositions),
    ).toEqual({ ...observed, ...valid.terminalDispositions, unresolved: 0 });
  });

  it.each(["findings", "workosFindings"])(
    "refuses completion when persisted %s remain",
    (field) => {
      expect(() =>
        mergeObservedCutoverEvidence(
          {
            active: 1,
            quarantined: 0,
            workosDirectoryComplete: true,
            workosMapped: 1,
            workosQuarantined: 0,
            workosUnresolved: 0,
            findings: [],
            workosFindings: [],
            [field]: [{ status: "quarantined" }],
          },
          valid.terminalDispositions,
        ),
      ).toThrow(new RegExp(`still has ${field}`));
    },
  );

  it("refuses completion when the stored inventory is incomplete", () => {
    expect(() =>
      mergeObservedCutoverEvidence(
        {
          active: 1,
          quarantined: 0,
          workosDirectoryComplete: false,
          workosMapped: 1,
          workosQuarantined: 0,
          workosUnresolved: 0,
          findings: [],
          workosFindings: [],
        },
        valid.terminalDispositions,
      ),
    ).toThrow(/not a complete WorkOS directory snapshot/);
  });
});
