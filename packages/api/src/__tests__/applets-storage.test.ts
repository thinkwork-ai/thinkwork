import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appletBundleCacheKey,
  appletMetadataKey,
  appletSourceKey,
  assertAppletS3Key,
  readAppletMetadataFromS3,
  readAppletSourceFromS3,
  writeAppletMetadataToS3,
  writeAppletSourceToS3,
} from "../lib/applets/storage.js";
import type { AppletMetadataV1 } from "../lib/applets/metadata.js";

const s3Mock = mockClient(S3Client);

describe("applet S3 storage", () => {
  beforeEach(() => {
    s3Mock.reset();
    process.env.WORKSPACE_BUCKET = "workspace-bucket";
  });

  afterEach(() => {
    delete process.env.WORKSPACE_BUCKET;
  });

  it("generates tenant-scoped source, metadata, and bundle keys", () => {
    expect(
      appletSourceKey({ tenantId: "tenant-A", appId: "pipeline-risk" }),
    ).toBe("tenants/tenant-A/applets/pipeline-risk/source.tsx");
    expect(
      appletMetadataKey({ tenantId: "tenant-A", appId: "pipeline-risk" }),
    ).toBe("tenants/tenant-A/applets/pipeline-risk/metadata.json");
    expect(
      appletBundleCacheKey({
        tenantId: "tenant-A",
        appId: "pipeline-risk",
        cacheKey: "sha256-abcd",
      }),
    ).toBe("tenants/tenant-A/applets/pipeline-risk/bundle-cache/sha256-abcd.js");
  });

  it("rejects keys outside the tenant applet prefix", () => {
    expect(() =>
      assertAppletS3Key(
        "tenant-A",
        "tenants/tenant-B/applets/pipeline-risk/source.tsx",
      ),
    ).toThrow(/outside the tenant applet prefix/);
    expect(() =>
      assertAppletS3Key(
        "tenant-A",
        "tenants/tenant-A/applets/../source.tsx",
      ),
    ).toThrow(/outside the tenant applet prefix/);
  });

  it("round-trips source and metadata through S3", async () => {
    const sourceKey = appletSourceKey({
      tenantId: "tenant-A",
      appId: "pipeline-risk",
    });
    const metadataKey = appletMetadataKey({
      tenantId: "tenant-A",
      appId: "pipeline-risk",
    });
    const source = "export default function Applet() { return null; }";
    const metadata = validAppletMetadata();

    s3Mock.on(PutObjectCommand).resolves({});
    await writeAppletSourceToS3({
      tenantId: "tenant-A",
      key: sourceKey,
      source,
    });
    await writeAppletMetadataToS3({
      tenantId: "tenant-A",
      key: metadataKey,
      metadata,
    });

    const puts = s3Mock.commandCalls(PutObjectCommand);
    expect(puts[0].args[0].input).toMatchObject({
      Bucket: "workspace-bucket",
      Key: sourceKey,
      ContentType: "text/plain; charset=utf-8",
    });
    expect(puts[1].args[0].input).toMatchObject({
      Bucket: "workspace-bucket",
      Key: metadataKey,
      ContentType: "application/json",
    });

    s3Mock
      .on(GetObjectCommand, { Key: sourceKey })
      .resolves({ Body: { transformToString: async () => source } as any });
    s3Mock.on(GetObjectCommand, { Key: metadataKey }).resolves({
      Body: {
        transformToString: async () => JSON.stringify(metadata),
      } as any,
    });

    await expect(
      readAppletSourceFromS3({ tenantId: "tenant-A", key: sourceKey }),
    ).resolves.toBe(source);
    await expect(
      readAppletMetadataFromS3({ tenantId: "tenant-A", key: metadataKey }),
    ).resolves.toMatchObject({ appId: "pipeline-risk" });
  });
});

function validAppletMetadata(): AppletMetadataV1 {
  return {
    schemaVersion: 1,
    kind: "computer_applet",
    appId: "pipeline-risk",
    name: "Pipeline Risk",
    version: 1,
    tenantId: "tenant-A",
    threadId: "thread-1",
    generatedAt: "2026-05-09T12:00:00.000Z",
    stdlibVersionAtGeneration: "0.0.0",
  };
}
