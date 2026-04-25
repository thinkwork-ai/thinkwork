import { describe, expect, it, vi, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  handler,
  WORKSPACE_EVENT_PREFIX_PATTERNS,
} from "../handlers/workspace-event-dispatcher.js";

const s3Mock = mockClient(S3Client);

function sqsEvent(key: string, messageId = "msg-1", detailType = "Object Created") {
  return {
    Records: [
      {
        messageId,
        body: JSON.stringify({
          "detail-type": detailType,
          detail: {
            bucket: { name: "bucket" },
            object: { key, sequencer: "001" },
          },
        }),
      },
    ],
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  s3Mock.reset();
});

describe("workspace event dispatcher candidate handling", () => {
  it("declares wildcard patterns for root and nested eventful prefixes", () => {
    expect(WORKSPACE_EVENT_PREFIX_PATTERNS).toContain(
      "tenants/*/agents/*/workspace/work/inbox/*.md",
    );
    expect(WORKSPACE_EVENT_PREFIX_PATTERNS).toContain(
      "tenants/*/agents/*/workspace/*/work/inbox/*.md",
    );
    expect(WORKSPACE_EVENT_PREFIX_PATTERNS).toContain(
      "tenants/*/agents/*/workspace/review/*",
    );
  });

  it("processes valid candidates without batch failures", async () => {
    s3Mock.on(HeadObjectCommand).resolves({ Metadata: {} });
    const result = await handler(
      sqsEvent("tenants/acme/agents/marco/workspace/work/inbox/request.md"),
    );
    expect(result.batchItemFailures).toEqual([]);
  });

  it("suppresses objects marked with thinkwork-suppress-event", async () => {
    s3Mock
      .on(HeadObjectCommand)
      .resolves({ Metadata: { "thinkwork-suppress-event": "true" } });
    const result = await handler(
      sqsEvent("tenants/acme/agents/marco/workspace/memory/lessons.md"),
    );
    expect(result.batchItemFailures).toEqual([]);
  });

  it("reports one failed SQS item without failing the whole batch", async () => {
    s3Mock.on(HeadObjectCommand).rejects(new Error("S3 unavailable"));
    const result = await handler(
      sqsEvent("tenants/acme/agents/marco/workspace/work/inbox/request.md"),
    );
    expect(result.batchItemFailures).toEqual([{ itemIdentifier: "msg-1" }]);
  });

  it("does not HeadObject deleted review files", async () => {
    const result = await handler(
      sqsEvent(
        "tenants/acme/agents/marco/workspace/review/run_123.needs-human.md",
        "msg-1",
        "Object Deleted",
      ),
    );
    expect(result.batchItemFailures).toEqual([]);
    expect(s3Mock.commandCalls(HeadObjectCommand)).toHaveLength(0);
  });
});
