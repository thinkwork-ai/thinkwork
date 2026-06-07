import { describe, expect, it } from "vitest";
import {
  parseAttachmentReferences,
  resolveMessageAttachments,
} from "./thread-message-attachments";

const attachments = [
  {
    id: "att-2",
    name: "Second.csv",
    mimeType: "text/csv",
    sizeBytes: 2048,
  },
  {
    id: "att-1",
    name: "Financial Sample.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    sizeBytes: 4096,
  },
];

describe("thread message attachments", () => {
  it("parses attachment references from object or string metadata", () => {
    expect(
      parseAttachmentReferences({
        attachments: [{ attachmentId: "att-1" }],
      }),
    ).toEqual(["att-1"]);
    expect(
      parseAttachmentReferences(
        JSON.stringify({ attachments: [{ attachmentId: "att-2" }] }),
      ),
    ).toEqual(["att-2"]);
  });

  it("resolves known attachments in message metadata order", () => {
    expect(
      resolveMessageAttachments({
        metadata: {
          attachments: [
            { attachmentId: "att-1" },
            { attachmentId: "missing" },
            { attachmentId: "att-2" },
          ],
        },
        threadAttachments: attachments,
      }).map((attachment) => attachment.label),
    ).toEqual(["Financial Sample.xlsx", "Second.csv"]);
  });

  it("deduplicates repeated references", () => {
    expect(
      resolveMessageAttachments({
        metadata: {
          attachments: [
            { attachmentId: "att-1" },
            { attachmentId: "att-1" },
          ],
        },
        threadAttachments: attachments,
      }),
    ).toHaveLength(1);
  });

  it("ignores malformed metadata without throwing", () => {
    expect(resolveMessageAttachments({ metadata: null })).toEqual([]);
    expect(resolveMessageAttachments({ metadata: "{nope" })).toEqual([]);
    expect(
      resolveMessageAttachments({
        metadata: { attachments: [{ attachmentId: 123 }, null] },
        threadAttachments: attachments,
      }),
    ).toEqual([]);
  });
});
