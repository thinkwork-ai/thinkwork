import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";
import { writeWorkspaceAuditMirror } from "../lib/workspace-events/s3-mirror.js";

const s3Mock = mockClient(S3Client);

beforeEach(() => {
  s3Mock.reset();
});

describe("workspace event S3 audit mirror", () => {
  it("marks mirror writes as suppressed so EventBridge does not recurse", async () => {
    s3Mock.on(PutObjectCommand).resolves({});

    await writeWorkspaceAuditMirror(new S3Client({}), {
      bucket: "bucket",
      key: "tenants/acme/agents/marco/workspace/events/audit/2026-04-26/1.json",
      body: { eventId: 1 },
    });

    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(1);
    expect(s3Mock.commandCalls(PutObjectCommand)[0].args[0].input).toEqual(
      expect.objectContaining({
        Metadata: { "thinkwork-suppress-event": "true" },
      }),
    );
  });
});
