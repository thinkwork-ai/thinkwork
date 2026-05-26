import { describe, expect, it } from "vitest";
import {
  canonicalizeMessageAttachmentMetadata,
  dedupeAttachmentIds,
  MessageAttachmentRefsError,
} from "./message-attachment-refs.js";

const ATTACHMENT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ATTACHMENT_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

describe("message attachment refs", () => {
  it("deduplicates valid UUID attachment refs in first-seen order", () => {
    expect(
      dedupeAttachmentIds([
        { attachmentId: ATTACHMENT_A },
        { attachmentId: ATTACHMENT_B },
        { attachmentId: ATTACHMENT_A },
      ]),
    ).toEqual([ATTACHMENT_A, ATTACHMENT_B]);
  });

  it("rejects malformed attachment refs", () => {
    expect(() => dedupeAttachmentIds([{ attachmentId: "not-a-uuid" }])).toThrow(
      MessageAttachmentRefsError,
    );
    expect(() => dedupeAttachmentIds([{}])).toThrow(
      MessageAttachmentRefsError,
    );
  });

  it("canonicalizes metadata against same-thread attachment rows", async () => {
    const db = fakeDb([ATTACHMENT_A]);
    await expect(
      canonicalizeMessageAttachmentMetadata({
        db,
        tenantId: "tenant-1",
        threadId: "thread-1",
        metadata: {
          keep: true,
          attachments: [{ attachmentId: ATTACHMENT_A }],
        },
      }),
    ).resolves.toEqual({
      keep: true,
      attachments: [{ attachmentId: ATTACHMENT_A }],
    });
  });

  it("rejects attachment IDs that do not resolve for the thread", async () => {
    await expect(
      canonicalizeMessageAttachmentMetadata({
        db: fakeDb([]),
        tenantId: "tenant-1",
        threadId: "thread-1",
        metadata: {
          attachments: [{ attachmentId: ATTACHMENT_A }],
        },
      }),
    ).rejects.toThrow(MessageAttachmentRefsError);
  });
});

function fakeDb(ids: string[]) {
  const builder = {
    from: () => builder,
    where: async () => ids.map((id) => ({ id })),
  };
  return {
    select: () => builder,
  };
}
