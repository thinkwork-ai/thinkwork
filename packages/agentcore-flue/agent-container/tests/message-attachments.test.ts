import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildFileReadTool,
  cleanupMessageAttachments,
  formatMessageAttachmentsPreamble,
  stageMessageAttachments,
} from "../src/runtime/message-attachments.js";

function s3ClientWithBody(body: Buffer | string) {
  return {
    send: async () => ({
      Body: Buffer.isBuffer(body) ? body : Buffer.from(body),
    }),
  };
}

describe("stageMessageAttachments", () => {
  it("downloads valid same-tenant attachment refs and creates text previews", async () => {
    const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "flue-attachments-"));
    try {
      const result = await stageMessageAttachments({
        attachments: [
          {
            attachment_id: "att-1",
            s3_key: "tenants/tenant-1/attachments/thread-1/att-1/brief.md",
            name: "brief.md",
            mime_type: "text/markdown",
            size_bytes: 64,
          },
        ],
        workspaceBucket: "bucket",
        expectedTenantId: "tenant-1",
        expectedThreadId: "thread-1",
        s3Client: s3ClientWithBody("# Brief\n\nRevenue grew 12%.") as never,
        tmpRoot,
      });
      try {
        expect(result.staged).toHaveLength(1);
        expect(result.staged[0]?.localPath).toContain("/attachments/brief.md");
        expect(result.staged[0]?.textPreview).toContain("Revenue grew 12%.");
        expect(await readFile(result.staged[0]!.localPath, "utf-8")).toContain(
          "# Brief",
        );
      } finally {
        await cleanupMessageAttachments(result.turnDir);
      }
    } finally {
      await rm(tmpRoot, { recursive: true, force: true });
    }
  });

  it("rejects refs outside the expected tenant/thread prefix", async () => {
    let sends = 0;
    const result = await stageMessageAttachments({
      attachments: [
        {
          attachment_id: "att-1",
          s3_key: "tenants/other/attachments/thread-1/att-1/brief.md",
          name: "brief.md",
        },
      ],
      workspaceBucket: "bucket",
      expectedTenantId: "tenant-1",
      expectedThreadId: "thread-1",
      s3Client: { send: async () => void sends++ } as never,
    });

    expect(result.staged).toEqual([]);
    expect(sends).toBe(0);
  });
});

describe("formatMessageAttachmentsPreamble", () => {
  it("makes attachment presence explicit", () => {
    const preamble = formatMessageAttachmentsPreamble([
      {
        attachmentId: "att-1",
        localPath: "/tmp/flue-turn/attachments/brief.md",
        name: "brief.md",
        mimeType: "text/markdown",
        sizeBytes: 1024,
        textPreview: "# Brief",
      },
    ]);

    expect(preamble).toContain("Files attached to this turn:");
    expect(preamble).toContain("Do not say that no file is attached");
    expect(preamble).toContain("file_read");
    expect(preamble).toContain("# Brief");
  });
});

describe("buildFileReadTool", () => {
  it("only reads staged attachment paths", async () => {
    const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "flue-file-read-"));
    const filePath = path.join(tmpRoot, "brief.md");
    await import("node:fs/promises").then((fs) =>
      fs.writeFile(filePath, "# Brief\n\nRevenue grew 12%."),
    );
    try {
      const tool = buildFileReadTool([
        {
          attachmentId: "att-1",
          localPath: filePath,
          name: "brief.md",
          mimeType: "text/markdown",
          sizeBytes: 64,
        },
      ]);

      const result = await tool!.execute("tool-1", { path: filePath });
      expect(result.content[0]?.type).toBe("text");
      expect(result.content[0]).toMatchObject({
        type: "text",
        text: expect.stringContaining("Revenue grew 12%."),
      });
      await expect(
        tool!.execute("tool-2", { path: "/etc/passwd" }),
      ).rejects.toThrow(/Access denied/);
    } finally {
      await rm(tmpRoot, { recursive: true, force: true });
    }
  });
});
