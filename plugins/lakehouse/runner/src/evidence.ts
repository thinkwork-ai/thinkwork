import type {
  LakeHouseRunEvidence,
  LakeHouseExtractContract,
} from "../../src/edge-integration";
import {
  rejectPayloadLikeEvidence,
  summarizeExtractEvidence,
} from "../../src/edge-integration";

export function createPendingRunEvidence(input: {
  runId: string;
  integrationKey: string;
  bundleVersion: string;
  bundleDigest: string;
  startedAt: string;
  runtimeVersions: Record<string, string>;
}): LakeHouseRunEvidence {
  return {
    ...input,
    status: "pending",
    extracts: [],
    rawLandingPointers: [],
  };
}

export function appendExtractEvidence(
  evidence: LakeHouseRunEvidence,
  input: {
    extract: LakeHouseExtractContract;
    rowCount: number;
    nominalStart: string;
    nominalEnd: string;
    extractedAt: string;
    schemaSnapshot: Record<string, unknown>;
    rawLandingKey: string;
    rawLandingDigest?: string;
  },
): LakeHouseRunEvidence {
  const blockedPaths = rejectPayloadLikeEvidence(
    input.schemaSnapshot,
    "schema",
  );
  if (blockedPaths.length > 0) {
    throw new Error(
      `Source payload fields are not allowed: ${blockedPaths.join(", ")}`,
    );
  }
  const extractEvidence = summarizeExtractEvidence({
    ...input,
    runId: evidence.runId,
    bundleVersion: evidence.bundleVersion,
  });
  return {
    ...evidence,
    extracts: [...evidence.extracts, extractEvidence],
    rawLandingPointers: [
      ...evidence.rawLandingPointers,
      extractEvidence.rawLandingPointer,
    ],
  };
}
