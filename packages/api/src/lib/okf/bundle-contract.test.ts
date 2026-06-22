import { describe, expect, it } from "vitest";
import {
  OKF_BUNDLE_SCHEMA_VERSION,
  OKF_CURRENT_MANIFEST_SCHEMA_VERSION,
  summarizeOkfManifestForOperator,
  validateOkfBundleManifest,
  validateOkfCurrentManifest,
  type OkfBundleManifest,
  type OkfCurrentManifest,
} from "./bundle-contract.js";

const SHA = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function bundleManifest(): OkfBundleManifest {
  return {
    schemaVersion: OKF_BUNDLE_SCHEMA_VERSION,
    tenantId: "tenant-1",
    tenantSlug: "acme",
    bundleId: "okf-bundle:2026-06-22T15:00:00Z",
    generatedAt: "2026-06-22T15:00:00.000Z",
    ontologyVersion: "ontology:2026-06-20",
    checksumSha256: SHA,
    objectCount: 4,
    byteCount: 2048,
    sourceCounts: {
      wikiPages: 2,
      brainPages: 1,
      sources: 4,
      relationships: 3,
    },
    freshness: {
      staleAfter: "2026-06-22T16:00:00.000Z",
      sourceWatermarks: [
        {
          sourceKind: "wiki",
          maxUpdatedAt: "2026-06-22T14:55:00.000Z",
          count: 2,
        },
        {
          sourceKind: "brain",
          maxUpdatedAt: "2026-06-22T14:58:00.000Z",
          count: 1,
        },
      ],
    },
    traversal: {
      rootIndexPath: "index.md",
      logPath: "log.md",
      pageCount: 2,
      directories: [
        { path: ".", indexPath: "index.md", pageCount: 2 },
        {
          path: "entities/customer",
          indexPath: "entities/customer/index.md",
          pageCount: 1,
        },
      ],
    },
    objects: [
      {
        path: "index.md",
        kind: "index",
        pageKind: "index",
        checksumSha256: SHA,
        byteLength: 128,
      },
      {
        path: "entities/customer/acme-corp.md",
        kind: "page",
        pageKind: "entity",
        checksumSha256: SHA,
        byteLength: 1536,
      },
      {
        path: "log.md",
        kind: "log",
        pageKind: "log",
        checksumSha256: SHA,
        byteLength: 384,
      },
      {
        path: ".thinkwork/manifest.json",
        kind: "manifest",
        checksumSha256: SHA,
        byteLength: 256,
      },
    ],
    redaction: {
      posture: "tenant_visible",
      rawSourceIdsRedacted: true,
    },
  };
}

function currentManifest(): OkfCurrentManifest {
  const bundle = bundleManifest();
  return {
    schemaVersion: OKF_CURRENT_MANIFEST_SCHEMA_VERSION,
    tenantId: bundle.tenantId,
    tenantSlug: bundle.tenantSlug,
    currentBundleId: bundle.bundleId,
    publishedAt: "2026-06-22T15:02:00.000Z",
    bundle: {
      bundleId: bundle.bundleId,
      checksumSha256: bundle.checksumSha256,
      objectCount: bundle.objectCount,
      byteCount: bundle.byteCount,
      generatedAt: bundle.generatedAt,
      ontologyVersion: bundle.ontologyVersion,
      sourceCounts: bundle.sourceCounts,
      freshness: bundle.freshness,
      redactionPosture: bundle.redaction.posture,
    },
  };
}

describe("OKF bundle contract validation", () => {
  it("accepts a valid versioned bundle manifest", () => {
    const manifest = bundleManifest();

    expect(validateOkfBundleManifest(manifest)).toEqual({
      ok: true,
      value: manifest,
      errors: [],
    });
  });

  it("rejects object count drift, unsafe paths, and unredacted sources", () => {
    const manifest = bundleManifest();
    manifest.objectCount = 2;
    manifest.objects[1]!.path = "../customer.md";
    manifest.objects[3]!.path = "manifest.json";
    manifest.traversal.directories[1]!.path = "../entities";
    manifest.freshness.sourceWatermarks[0]!.maxUpdatedAt = "yesterday";
    (manifest.redaction as any).rawSourceIdsRedacted = false;

    const result = validateOkfBundleManifest(manifest);

    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain(
      "objectCount must equal objects.length",
    );
    expect(result.errors.join("\n")).toContain(
      "objects[1].path contains an unsafe path segment",
    );
    expect(result.errors).toContain(
      "objects[3].path must be .thinkwork/manifest.json",
    );
    expect(result.errors).toContain(
      "traversal.directories[1].path contains an unsafe path segment",
    );
    expect(result.errors).toContain(
      "freshness.sourceWatermarks[0].maxUpdatedAt must be an ISO timestamp",
    );
    expect(result.errors).toContain(
      "redaction.rawSourceIdsRedacted must be true",
    );
  });

  it("accepts a current manifest that points at exactly one bundle", () => {
    const manifest = currentManifest();

    expect(validateOkfCurrentManifest(manifest)).toEqual({
      ok: true,
      value: manifest,
      errors: [],
    });
  });

  it("rejects a current manifest whose pointer does not match the bundle", () => {
    const manifest = currentManifest();
    manifest.currentBundleId = "okf-bundle:other";

    const result = validateOkfCurrentManifest(manifest);

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "currentBundleId must match bundle.bundleId",
    );
  });

  it("summarizes manifests without storage URIs or backend ids", () => {
    const bundle = bundleManifest();
    const current = currentManifest();

    expect(
      JSON.stringify(summarizeOkfManifestForOperator(bundle)),
    ).not.toContain("s3://");
    expect(summarizeOkfManifestForOperator(current)).toEqual({
      bundleId: bundle.bundleId,
      generatedAt: bundle.generatedAt,
      ontologyVersion: bundle.ontologyVersion,
      checksumSha256: bundle.checksumSha256,
      objectCount: bundle.objectCount,
      byteCount: bundle.byteCount,
      sourceCounts: bundle.sourceCounts,
      freshness: bundle.freshness,
      redactionPosture: bundle.redaction.posture,
    });
  });
});
