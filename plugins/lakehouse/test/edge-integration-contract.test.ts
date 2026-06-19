import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  requiredRawLandingMetadataFields,
  validateBundleManifest,
  withComputedBundleDigest,
  type LakeHouseBundleManifest,
  type LakeHouseExtractContract,
} from "../src";
import {
  appendExtractEvidence,
  buildMeltanoRunCommand,
  createPendingRunEvidence,
  fetchAndVerifyBundle,
  materializeBundle,
} from "../runner/src";
import { projectSummary, runJob } from "../mcp/src";
import { buildParityReport } from "../parity/src";

const meltanoYml = `
version: 1
default_environment: dev
jobs:
  sales-hourly:
    tasks:
      - tap-oracle target-s3
`;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function salesExtract(overrides: Partial<LakeHouseExtractContract> = {}) {
  return {
    streamName: "jde_sales_orders",
    sourceSystem: "jde",
    sourceObject: "JDE_SALES_ORDERS_V",
    businessKeys: ["company", "order_number", "line_number"],
    cursorField: "updated_at",
    sourceTimestampField: "jde_updated_at",
    extractTimestampField: "extract_loaded_at",
    reconciliation: {
      mode: "rolling_window",
      lookbackHours: 48,
      reason: "JDE sales orders can receive late corrections.",
    },
    deleteReversalStrategy: "reversal_transaction",
    rawLanding: {
      bucketRef: "customer-raw-lakehouse",
      prefixTemplate:
        "lakehouse/{stream}/bundle={bundleVersion}/run={runId}/date={date}/data.jsonl",
      format: "jsonl",
      requiredMetadataFields: requiredRawLandingMetadataFields(),
    },
    ...overrides,
  } satisfies LakeHouseExtractContract;
}

function bundleManifest(
  overrides: Partial<LakeHouseBundleManifest> = {},
): LakeHouseBundleManifest {
  return withComputedBundleDigest({
    schemaVersion: 1,
    pluginKey: "lakehouse",
    integrationKey: "mcpherson-sales",
    bundleVersion: "2026.06.19.1",
    sourceCommit: "abc1234",
    approvedBy: "user-1",
    approvedAt: "2026-06-19T13:00:00.000Z",
    meltanoProject: {
      meltanoVersion: "3.8.0",
      files: [{ path: "meltano.yml", sha256: sha256(meltanoYml) }],
      jobs: [{ name: "sales-hourly", tasks: ["tap-oracle target-s3"] }],
      environments: ["dev"],
      plugins: [
        {
          name: "tap-oracle",
          variant: "meltanolabs",
          version: "1.0.0",
        },
      ],
      requiredRuntimeVariables: [
        {
          name: "ORACLE_DSN",
          secretRef: "env:LAKEHOUSE_ORACLE_DSN",
        },
      ],
    },
    extracts: [salesExtract()],
    policy: {
      mode: "approved_writes",
      allowedJobs: ["sales-hourly"],
      allowedBundleDigests: [],
      allowStateRecovery: false,
      requireApprovalForRuns: true,
    },
    signature: {
      algorithm: "sha256",
      digest: "",
      signatureRef: "s3://bundle-signatures/mcpherson-sales.sig",
      signedBy: "kms:key/lakehouse-bundle-signing",
      signedAt: "2026-06-19T13:00:00.000Z",
    },
    ...overrides,
  });
}

describe("LakeHouse edge integration contracts", () => {
  it("validates a signed McPherson sales-slice bundle", () => {
    const manifest = bundleManifest();

    const validation = validateBundleManifest(manifest);

    expect(validation.ok).toBe(true);
    expect(validation.digest).toBe(manifest.signature.digest);
  });

  it("rejects late-correction extracts without a reconciliation window", () => {
    const manifest = bundleManifest({
      extracts: [
        salesExtract({
          reconciliation: {
            mode: "rolling_window",
            lookbackHours: 0,
            reason: "late corrections",
          },
        }),
      ],
    });

    const validation = validateBundleManifest(manifest);

    expect(validation.ok).toBe(false);
    expect(validation.issues).toContainEqual(
      expect.objectContaining({
        path: "extracts.0.reconciliation.lookbackHours",
      }),
    );
  });

  it("rejects secret-looking values in bundle source", () => {
    const manifest = bundleManifest({
      meltanoProject: {
        ...bundleManifest().meltanoProject,
        requiredRuntimeVariables: [
          { name: "ORACLE_PASSWORD", secretRef: "password=super-secret" },
        ],
      },
    });

    const validation = validateBundleManifest(manifest);

    expect(validation.ok).toBe(false);
    expect(validation.issues.map((issue) => issue.path)).toContain("bundle");
  });
});

describe("LakeHouse runner helpers", () => {
  it("fetches, verifies, and cleanly materializes the approved bundle", async () => {
    const manifest = bundleManifest();
    const rootDir = await mkdtemp(join(tmpdir(), "lakehouse-runner-"));
    const stalePath = join(
      rootDir,
      "run-1",
      manifest.bundleVersion,
      "stale.txt",
    );

    await mkdir(join(rootDir, "run-1", manifest.bundleVersion), {
      recursive: true,
    });
    await writeFile(stalePath, "old", { flag: "w" });
    const bundle = await fetchAndVerifyBundle({
      expectedDigest: manifest.signature.digest,
      fetchObject: async () => ({
        manifest,
        files: { "meltano.yml": meltanoYml },
      }),
    });

    const materialized = await materializeBundle({
      rootDir,
      runId: "run-1",
      bundle,
    });

    await expect(
      readFile(join(materialized.projectDir, "meltano.yml"), "utf8"),
    ).resolves.toContain("sales-hourly");
    await expect(
      readFile(join(materialized.projectDir, "stale.txt"), "utf8"),
    ).rejects.toThrow();
    await rm(rootDir, { recursive: true, force: true });
  });

  it("rejects bundles with tampered manifest signature digests", async () => {
    const manifest = bundleManifest();
    const tampered = {
      ...manifest,
      signature: { ...manifest.signature, digest: "0".repeat(64) },
    };

    await expect(
      fetchAndVerifyBundle({
        expectedDigest: manifest.signature.digest,
        fetchObject: async () => ({
          manifest: tampered,
          files: { "meltano.yml": meltanoYml },
        }),
      }),
    ).rejects.toThrow(/signature\.digest|signature digest/i);
  });

  it("denies non-allowlisted Meltano job execution before process spawn", () => {
    const manifest = bundleManifest();

    expect(() =>
      buildMeltanoRunCommand({
        jobName: "unknown-job",
        bundleDigest: manifest.signature.digest,
        approved: true,
        policy: {
          ...manifest.policy,
          allowedBundleDigests: [manifest.signature.digest],
        },
      }),
    ).toThrow(/allowlisted/);
  });

  it("builds payload-light run evidence and rejects source-row fields", () => {
    const manifest = bundleManifest();
    const evidence = createPendingRunEvidence({
      runId: "run-1",
      integrationKey: manifest.integrationKey,
      bundleVersion: manifest.bundleVersion,
      bundleDigest: manifest.signature.digest,
      startedAt: "2026-06-19T13:01:00.000Z",
      runtimeVersions: { meltano: "3.8.0", "tap-oracle": "1.0.0" },
    });

    expect(() =>
      appendExtractEvidence(evidence, {
        extract: manifest.extracts[0],
        rowCount: 42,
        nominalStart: "2026-06-19T12:00:00.000Z",
        nominalEnd: "2026-06-19T13:00:00.000Z",
        extractedAt: "2026-06-19T13:01:00.000Z",
        schemaSnapshot: { rows: [{ order_number: "leak" }] },
        rawLandingKey: "raw/key.jsonl",
      }),
    ).toThrow(/Source payload fields/);

    const updated = appendExtractEvidence(evidence, {
      extract: manifest.extracts[0],
      rowCount: 42,
      nominalStart: "2026-06-19T12:00:00.000Z",
      nominalEnd: "2026-06-19T13:00:00.000Z",
      extractedAt: "2026-06-19T13:01:00.000Z",
      schemaSnapshot: { columns: ["order_number"] },
      rawLandingKey: "raw/key.jsonl",
    });

    expect(updated.extracts[0]).toMatchObject({
      streamName: "jde_sales_orders",
      rowCount: 42,
      cursorField: "updated_at",
    });
  });
});

describe("LakeHouse MCP and parity helpers", () => {
  it("returns redacted read-only project summaries", () => {
    const manifest = bundleManifest();
    const summary = projectSummary({ manifest });

    expect(summary.ok).toBe(true);
    expect(summary.data).toMatchObject({
      integrationKey: "mcpherson-sales",
      jobs: ["sales-hourly"],
      streams: ["jde_sales_orders"],
    });
  });

  it("audits policy-gated run requests without arbitrary shell args", () => {
    const manifest = bundleManifest();
    const { response, audit } = runJob({
      actor: "agent-1",
      jobName: "sales-hourly",
      approved: false,
      policy: {
        ...manifest.policy,
        allowedBundleDigests: [manifest.signature.digest],
      },
      manifest,
      now: "2026-06-19T13:02:00.000Z",
    });

    expect(response.ok).toBe(false);
    expect(response.error?.code).toBe("POLICY_DENIED");
    expect(audit).toMatchObject({
      tool: "run_job",
      result: "denied",
      bundleVersion: manifest.bundleVersion,
    });
  });

  it("marks parity reports incomplete when Fivetran evidence is missing", () => {
    const manifest = bundleManifest();
    const evidence = createPendingRunEvidence({
      runId: "run-1",
      integrationKey: manifest.integrationKey,
      bundleVersion: manifest.bundleVersion,
      bundleDigest: manifest.signature.digest,
      startedAt: "2026-06-19T13:01:00.000Z",
      runtimeVersions: { meltano: "3.8.0" },
    });
    const withExtract = appendExtractEvidence(evidence, {
      extract: manifest.extracts[0],
      rowCount: 42,
      nominalStart: "2026-06-19T12:00:00.000Z",
      nominalEnd: "2026-06-19T13:00:00.000Z",
      extractedAt: "2026-06-19T13:01:00.000Z",
      schemaSnapshot: { columns: ["order_number"] },
      rawLandingKey: "raw/key.jsonl",
    });

    const report = buildParityReport({
      evidence: withExtract,
      comparisons: [{ streamName: "jde_sales_orders", meltanoRowCount: 42 }],
    });

    expect(report.status).toBe("incomplete");
    expect(report.decision).toBe("not_ready");
    expect(report.findings).toContain(
      "jde_sales_orders: missing row-count comparison",
    );
  });

  it("marks parity reports incomplete when no comparison data is supplied", () => {
    const manifest = bundleManifest();
    const evidence = createPendingRunEvidence({
      runId: "run-1",
      integrationKey: manifest.integrationKey,
      bundleVersion: manifest.bundleVersion,
      bundleDigest: manifest.signature.digest,
      startedAt: "2026-06-19T13:01:00.000Z",
      runtimeVersions: { meltano: "3.8.0" },
    });

    const report = buildParityReport({ evidence, comparisons: [] });

    expect(report.status).toBe("incomplete");
    expect(report.findings).toContain("No Fivetran comparison data supplied");
  });
});
