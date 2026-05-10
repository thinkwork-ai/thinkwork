import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appletStatePayloadKey,
  artifactContentKey,
  assertArtifactPayloadS3Key,
  isArtifactPayloadS3Key,
  messageArtifactContentKey,
  readArtifactJsonPayloadFromS3,
  readArtifactPayloadFromS3,
  writeArtifactJsonPayloadToS3,
  writeArtifactPayloadToS3,
} from "../lib/artifacts/payload-storage.js";

const s3Mock = mockClient(S3Client);

describe("artifact payload S3 storage", () => {
  beforeEach(() => {
    s3Mock.reset();
    process.env.WORKSPACE_BUCKET = "workspace-bucket";
  });

  afterEach(() => {
    delete process.env.WORKSPACE_BUCKET;
    delete process.env.ARTIFACT_PAYLOADS_BUCKET;
  });

  it("generates tenant-scoped durable artifact and message artifact keys", () => {
    expect(
      artifactContentKey({
        tenantId: "tenant-A",
        artifactId: "artifact-1",
      }),
    ).toBe(
      "tenants/tenant-A/artifact-payloads/artifacts/artifact-1/content.md",
    );
    expect(
      messageArtifactContentKey({
        tenantId: "tenant-A",
        messageArtifactId: "message-artifact-1",
      }),
    ).toBe(
      "tenants/tenant-A/artifact-payloads/message-artifacts/message-artifact-1/content",
    );
  });

  it("generates applet state keys without raw user-controlled path segments", () => {
    const key = appletStatePayloadKey({
      tenantId: "tenant-A",
      appId: "applet-1",
      instanceId: "../instance",
      stateKey: "filters/date.range",
    });

    expect(key).toMatch(
      /^tenants\/tenant-A\/applets\/applet-1\/state\/[a-f0-9]{64}\/[a-f0-9]{64}\.json$/,
    );
    expect(key).not.toContain("../instance");
    expect(key).not.toContain("filters/date.range");
  });

  it("rejects keys outside the tenant payload prefixes", () => {
    expect(() =>
      assertArtifactPayloadS3Key(
        "tenant-A",
        "tenants/tenant-B/artifact-payloads/artifacts/artifact-1/content.md",
      ),
    ).toThrow(/outside the tenant prefix/);
    expect(() =>
      assertArtifactPayloadS3Key(
        "tenant-A",
        "tenants/tenant-A/artifact-payloads/artifacts/../content.md",
      ),
    ).toThrow(/outside the tenant prefix/);
    expect(() =>
      assertArtifactPayloadS3Key(
        "tenant-A",
        "tenants/tenant-A/artifact-payloads//artifacts/artifact-1/content.md",
      ),
    ).toThrow(/outside the tenant prefix/);
    expect(
      isArtifactPayloadS3Key("tenant-A", "tenants/tenant-A/applets/app/source.tsx"),
    ).toBe(false);
  });

  it("writes and reads text payloads through S3", async () => {
    const key = artifactContentKey({
      tenantId: "tenant-A",
      artifactId: "artifact-1",
    });

    s3Mock.on(PutObjectCommand).resolves({});
    await writeArtifactPayloadToS3({
      tenantId: "tenant-A",
      key,
      body: "# Report",
      contentType: "text/markdown; charset=utf-8",
    });

    expect(s3Mock.commandCalls(PutObjectCommand)[0].args[0].input).toMatchObject({
      Bucket: "workspace-bucket",
      Key: key,
      Body: "# Report",
      ContentType: "text/markdown; charset=utf-8",
    });

    s3Mock.on(GetObjectCommand, { Key: key }).resolves({
      Body: { transformToString: async () => "# Report" } as any,
    });

    await expect(
      readArtifactPayloadFromS3({ tenantId: "tenant-A", key }),
    ).resolves.toBe("# Report");
  });

  it("writes and reads JSON payloads through S3", async () => {
    const key = appletStatePayloadKey({
      tenantId: "tenant-A",
      appId: "applet-1",
      instanceId: "instance-1",
      stateKey: "filters",
    });

    s3Mock.on(PutObjectCommand).resolves({});
    await writeArtifactJsonPayloadToS3({
      tenantId: "tenant-A",
      key,
      value: { range: "quarter" },
    });

    expect(s3Mock.commandCalls(PutObjectCommand)[0].args[0].input).toMatchObject({
      ContentType: "application/json",
      Body: JSON.stringify({ range: "quarter" }),
    });

    s3Mock.on(GetObjectCommand, { Key: key }).resolves({
      Body: {
        transformToString: async () => JSON.stringify({ range: "quarter" }),
      } as any,
    });

    await expect(
      readArtifactJsonPayloadFromS3({ tenantId: "tenant-A", key }),
    ).resolves.toEqual({ range: "quarter" });
  });
});
