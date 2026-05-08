import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validManifest } from "./dashboard-artifacts-manifest.test.js";
import {
  assertDashboardManifestKey,
  dashboardManifestKey,
  readDashboardManifestFromS3,
  writeDashboardManifestToS3,
} from "../lib/dashboard-artifacts/storage.js";

const s3Mock = mockClient(S3Client);

describe("dashboard artifact manifest storage", () => {
  beforeEach(() => {
    s3Mock.reset();
    process.env.WORKSPACE_BUCKET = "workspace-bucket";
  });

  afterEach(() => {
    delete process.env.WORKSPACE_BUCKET;
  });

  it("rejects S3 keys outside the expected tenant artifact prefix", () => {
    expect(() =>
      assertDashboardManifestKey(
        "tenant-A",
        "tenants/tenant-B/dashboard-artifacts/artifact-1/manifest.json",
      ),
    ).toThrow(/outside the tenant artifact prefix/);
    expect(() =>
      assertDashboardManifestKey(
        "tenant-A",
        "tenants/tenant-A/dashboard-artifacts/../manifest.json",
      ),
    ).toThrow(/outside the tenant artifact prefix/);
  });

  it("round-trips a manifest and preserves schema version", async () => {
    const manifest = validManifest();
    const key = dashboardManifestKey({
      tenantId: "tenant-A",
      artifactId: "artifact-1",
    });

    s3Mock.on(PutObjectCommand).resolves({});
    await writeDashboardManifestToS3({
      tenantId: "tenant-A",
      key,
      manifest,
    });

    const put = s3Mock.commandCalls(PutObjectCommand)[0].args[0].input;
    expect(put).toMatchObject({
      Bucket: "workspace-bucket",
      Key: key,
      ContentType: "application/json",
    });

    s3Mock.on(GetObjectCommand).resolves({
      Body: {
        transformToString: async () => String(put.Body),
      } as any,
    });
    const roundTrip = await readDashboardManifestFromS3({
      tenantId: "tenant-A",
      key,
    });

    expect(roundTrip.schemaVersion).toBe(1);
    expect(roundTrip.dashboardKind).toBe("pipeline_risk");
  });
});
