import { describe, expect, it, vi } from "vitest";

import type { HarnessCapabilityContext } from "../../handlers/harness-capability-mcp.js";
import { createMessageAttachmentTools } from "./message-attachment-tools.js";

const ATTACHMENT_ID = "11111111-1111-4111-8111-111111111111";

const context: HarnessCapabilityContext = {
  tenantId: "tenant-1",
  userId: "user-1",
  agentId: "agent-1",
  threadId: "thread-1",
  turnId: "turn-1",
  triggeringMessageId: "message-1",
  spaceId: "space-1",
};

function setup(
  overrides: Partial<Parameters<typeof createMessageAttachmentTools>[0]> = {},
) {
  const resolveAttachments = vi.fn(async () => [
    {
      attachmentId: ATTACHMENT_ID,
      s3Key: `tenants/tenant-1/attachments/thread-1/${ATTACHMENT_ID}/pipeline.csv`,
      name: "pipeline.csv",
      mimeType: "text/csv",
      sizeBytes: 46,
    },
  ]);
  const readObject = vi.fn(async () =>
    new TextEncoder().encode("customer,amount\nAcme,1000\nBeta,2500\n"),
  );
  return {
    tools: createMessageAttachmentTools({
      resolveAttachments,
      readObject,
      ...overrides,
    }),
    resolveAttachments,
    readObject,
  };
}

describe("AgentCore governed message attachment tools", () => {
  it("lists canonical metadata without disclosing object storage coordinates", async () => {
    const { tools, resolveAttachments } = setup();
    const result = await tools.list(context);

    expect(resolveAttachments).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      threadId: "thread-1",
      messageId: "message-1",
    });
    expect(result.attachments).toEqual([
      {
        attachmentId: ATTACHMENT_ID,
        name: "pipeline.csv",
        mimeType: "text/csv",
        sizeBytes: 46,
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("tenants/");
  });

  it("re-authorizes and returns only the requested bounded chunk", async () => {
    const { tools, resolveAttachments, readObject } = setup();
    const result = await tools.read(context, ATTACHMENT_ID, 16, 10);

    expect(resolveAttachments).toHaveBeenCalledTimes(1);
    expect(readObject).toHaveBeenCalledWith(
      `tenants/tenant-1/attachments/thread-1/${ATTACHMENT_ID}/pipeline.csv`,
      25 * 1024 * 1024,
    );
    expect(result).toEqual(
      expect.objectContaining({
        attachmentId: ATTACHMENT_ID,
        content: "Acme,1000\n",
        offset: 16,
        nextOffset: 26,
        truncated: true,
        kind: "text",
      }),
    );
  });

  it("denies an attachment not referenced by the triggering message", async () => {
    const { tools, readObject } = setup();
    await expect(
      tools.read(context, "22222222-2222-4222-8222-222222222222", 0, 100),
    ).rejects.toMatchObject({
      code: "message_attachment_not_authorized",
    });
    expect(readObject).not.toHaveBeenCalled();
  });

  it("fails closed when the canonical row points outside the exact tenant/thread/id prefix", async () => {
    const { tools, readObject } = setup({
      resolveAttachments: vi.fn(async () => [
        {
          attachmentId: ATTACHMENT_ID,
          s3Key: `tenants/tenant-2/attachments/thread-1/${ATTACHMENT_ID}/pipeline.csv`,
          name: "pipeline.csv",
          mimeType: "text/csv",
          sizeBytes: 46,
        },
      ]),
    });
    await expect(tools.list(context)).rejects.toMatchObject({
      code: "message_attachment_not_authorized",
    });
    expect(readObject).not.toHaveBeenCalled();
  });
});
