import type { LakeHouseExtractContract } from "./extract-contract";

export interface LakeHouseRunEvidence {
  runId: string;
  integrationKey: string;
  bundleVersion: string;
  bundleDigest: string;
  status: "pending" | "running" | "succeeded" | "failed" | "rejected";
  startedAt: string;
  completedAt?: string;
  runtimeVersions: Record<string, string>;
  extracts: LakeHouseExtractEvidence[];
  stateSummary?: Record<string, unknown>;
  logPointer?: EvidencePointer;
  rawLandingPointers: EvidencePointer[];
  error?: {
    category: string;
    message: string;
    remediationHint?: string;
  };
}

export interface LakeHouseExtractEvidence {
  streamName: string;
  sourceObject: string;
  cursorField: string;
  extractWindow: {
    nominalStart: string;
    nominalEnd: string;
    reconciliationStart?: string;
  };
  rowCount: number;
  freshness: {
    maxSourceTimestamp?: string;
    extractedAt: string;
  };
  schemaSnapshot: Record<string, unknown>;
  rawLandingPointer: EvidencePointer;
}

export interface EvidencePointer {
  bucketRef: string;
  key: string;
  digest?: string;
}

const PAYLOAD_LIKE_KEYS = [
  "rows",
  "records",
  "payload",
  "oracleRows",
  "sourceRows",
  "credential",
  "password",
  "secret",
] as const;

export function summarizeExtractEvidence(input: {
  extract: LakeHouseExtractContract;
  runId: string;
  bundleVersion: string;
  rowCount: number;
  nominalStart: string;
  nominalEnd: string;
  extractedAt: string;
  schemaSnapshot: Record<string, unknown>;
  rawLandingKey: string;
  rawLandingDigest?: string;
}): LakeHouseExtractEvidence {
  return {
    streamName: input.extract.streamName,
    sourceObject: input.extract.sourceObject,
    cursorField: input.extract.cursorField,
    extractWindow: {
      nominalStart: input.nominalStart,
      nominalEnd: input.nominalEnd,
      reconciliationStart: input.extract.reconciliation.lookbackHours
        ? new Date(
            new Date(input.nominalStart).getTime() -
              input.extract.reconciliation.lookbackHours * 60 * 60 * 1000,
          ).toISOString()
        : undefined,
    },
    rowCount: input.rowCount,
    freshness: {
      extractedAt: input.extractedAt,
    },
    schemaSnapshot: input.schemaSnapshot,
    rawLandingPointer: {
      bucketRef: input.extract.rawLanding.bucketRef,
      key: input.rawLandingKey,
      digest: input.rawLandingDigest,
    },
  };
}

export function rejectPayloadLikeEvidence(
  value: unknown,
  path = "evidence",
): string[] {
  const issues: string[] = [];
  if (!value || typeof value !== "object") return issues;

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const lowerKey = key.toLowerCase();
    if (PAYLOAD_LIKE_KEYS.some((blocked) => lowerKey.includes(blocked))) {
      issues.push(`${path}.${key}`);
      continue;
    }
    if (child && typeof child === "object") {
      issues.push(...rejectPayloadLikeEvidence(child, `${path}.${key}`));
    }
  }
  return issues;
}
