import { describe, expect, it } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  writeWorkspaceWakeRequest,
  workspaceInboxObjectKey,
} from "../lib/workspace-events/write-api.js";

const s3Mock = mockClient(S3Client);

describe("workspace orchestration write API helpers", () => {
  it("builds nested inbox object keys", () => {
    expect(
      workspaceInboxObjectKey({
        bucket: "bucket",
        tenantSlug: "acme",
        agentSlug: "marco",
        targetPath: "expenses",
        requestMd: "Do work",
        requestId: "r1",
      }),
    ).toBe("tenants/acme/agents/marco/workspace/expenses/work/inbox/r1.md");
  });

  it("writes blocked event before inbox when waiting for result", async () => {
    s3Mock.reset();
    s3Mock.on(PutObjectCommand).resolves({});
    const s3 = new S3Client({});

    const result = await writeWorkspaceWakeRequest(s3, {
      bucket: "bucket",
      tenantSlug: "acme",
      agentSlug: "marco",
      targetPath: "expenses",
      requestMd: "Do work",
      requestId: "r1",
      parentRunId: "run_parent",
      waitForResult: true,
    });

    expect(result.blockedObjectKey).toContain("/work/runs/run_parent/events/blocked.json");
    expect(result.sourceObjectKey).toContain("/expenses/work/inbox/r1.md");
    const calls = s3Mock.commandCalls(PutObjectCommand);
    expect(calls[0].args[0].input.Key).toBe(result.blockedObjectKey);
    expect(calls[1].args[0].input.Key).toBe(result.sourceObjectKey);
  });
});

