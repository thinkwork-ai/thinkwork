import { describe, expect, it } from "vitest";
import {
  canonicalizeMessageAttachmentMetadata,
  dedupeAttachmentIds,
  MessageAttachmentRefsError,
  resolveDispatchMessageAttachments,
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
    expect(() => dedupeAttachmentIds([{}])).toThrow(MessageAttachmentRefsError);
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

  it("resolves dispatch attachments in metadata order, dropping keyless rows", async () => {
    const db = fakeResolverDb({
      metadata: {
        attachments: [
          { attachmentId: ATTACHMENT_B },
          { attachmentId: ATTACHMENT_A },
        ],
      },
      rows: [
        {
          id: ATTACHMENT_A,
          s3Key: null, // not finalized — must be dropped
          name: "A.xlsx",
          mimeType: "x",
          sizeBytes: 1,
        },
        {
          id: ATTACHMENT_B,
          s3Key: "k-b",
          name: "B.xlsx",
          mimeType: "y",
          sizeBytes: 2,
        },
      ],
    });
    await expect(
      resolveDispatchMessageAttachments({
        db,
        tenantId: "tenant-1",
        threadId: "thread-1",
        messageId: "message-1",
      }),
    ).resolves.toEqual([
      {
        attachmentId: ATTACHMENT_B,
        s3Key: "k-b",
        name: "B.xlsx",
        mimeType: "y",
        sizeBytes: 2,
      },
    ]);
  });

  it("returns no dispatch attachments when the message has none", async () => {
    const db = fakeResolverDb({ metadata: { attachments: [] }, rows: [] });
    await expect(
      resolveDispatchMessageAttachments({
        db,
        tenantId: "tenant-1",
        threadId: "thread-1",
        messageId: "message-1",
      }),
    ).resolves.toEqual([]);
  });
});

function fakeResolverDb({
  metadata,
  rows,
}: {
  metadata: unknown;
  rows: Array<Record<string, unknown>>;
}) {
  let call = 0;
  return {
    select() {
      call += 1;
      const isMessageQuery = call === 1;
      const builder: Record<string, unknown> = {
        from: () => builder,
        where: () => builder,
        limit: async () => (isMessageQuery ? [{ metadata }] : rows),
        then: (resolve: (value: unknown) => unknown) => resolve(rows),
      };
      return builder;
    },
  };
}

function fakeDb(ids: string[]) {
  const builder = {
    from: () => builder,
    where: async () => ids.map((id) => ({ id })),
  };
  return {
    select: () => builder,
  };
}
