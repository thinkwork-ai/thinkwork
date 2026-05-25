import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";

import {
  formatThreadProgressPromptBlock,
  prependThreadProgressPromptBlock,
  readThreadProgressMarkdown,
  threadProgressKey,
  truncateThreadProgressMarkdown,
  writeThreadProgressMarkdown,
} from "./storage.js";

const s3Mock = mockClient(S3Client);

function s3Body(content: string) {
  return {
    Body: {
      transformToString: async () => content,
    },
  } as any;
}

describe("thread progress storage", () => {
  beforeEach(() => {
    s3Mock.reset();
    process.env.WORKSPACE_BUCKET = "workspace-bucket";
  });

  it("builds tenant/thread scoped PROGRESS.md keys", () => {
    expect(
      threadProgressKey({ tenantSlug: "acme", threadId: "thread-123" }),
    ).toBe("tenants/acme/threads/thread-123/PROGRESS.md");
  });

  it("rejects unsafe path segments", () => {
    expect(() =>
      threadProgressKey({ tenantSlug: "../acme", threadId: "thread-123" }),
    ).toThrow("tenantSlug must be a safe S3 path segment");
    expect(() =>
      threadProgressKey({ tenantSlug: "acme", threadId: "thread/123" }),
    ).toThrow("threadId must be a safe S3 path segment");
  });

  it("reads missing progress markdown as null", async () => {
    s3Mock
      .on(GetObjectCommand)
      .rejects(Object.assign(new Error("missing"), { name: "NoSuchKey" }));

    await expect(
      readThreadProgressMarkdown({
        tenantSlug: "acme",
        threadId: "thread-123",
      }),
    ).resolves.toBeNull();
  });

  it("reads existing progress markdown", async () => {
    s3Mock.on(GetObjectCommand).resolves(s3Body("# PROGRESS"));

    await expect(
      readThreadProgressMarkdown({
        tenantSlug: "acme",
        threadId: "thread-123",
      }),
    ).resolves.toBe("# PROGRESS");

    expect(
      s3Mock.commandCalls(GetObjectCommand)[0].args[0].input,
    ).toMatchObject({
      Bucket: "workspace-bucket",
      Key: "tenants/acme/threads/thread-123/PROGRESS.md",
    });
  });

  it("writes markdown with text/markdown metadata", async () => {
    s3Mock.on(PutObjectCommand).resolves({});

    const result = await writeThreadProgressMarkdown({
      tenantSlug: "acme",
      threadId: "thread-123",
      content: "# PROGRESS",
    });

    expect(result).toEqual({
      key: "tenants/acme/threads/thread-123/PROGRESS.md",
      bytes: 10,
    });
    expect(
      s3Mock.commandCalls(PutObjectCommand)[0].args[0].input,
    ).toMatchObject({
      Bucket: "workspace-bucket",
      Key: "tenants/acme/threads/thread-123/PROGRESS.md",
      Body: "# PROGRESS",
      ContentType: "text/markdown; charset=utf-8",
      CacheControl: "no-cache",
    });
  });

  it("bounds injected prompt content", () => {
    const oversized = "x".repeat(25_000);

    expect(truncateThreadProgressMarkdown(oversized)).toContain(
      "PROGRESS.md truncated for prompt budget",
    );
    expect(formatThreadProgressPromptBlock("# PROGRESS")).toContain(
      "<thread_progress_md>\n",
    );
    expect(prependThreadProgressPromptBlock("do work", "# PROGRESS")).toContain(
      "</thread_progress_md>\n\n---\n\ndo work",
    );
  });
});
