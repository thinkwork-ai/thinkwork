import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";

import {
  buildFileReadToolDefinition,
  cleanupStagedAttachments,
  extractAttachmentText,
  formatMessageAttachmentsPreamble,
  normalizeAttachmentRef,
  stageAttachmentsViaFetch,
} from "../src/attachments.js";

function makeXlsx(sheets: Record<string, (string | number)[][]>): Uint8Array {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return new Uint8Array(
    XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer,
  );
}

/** Minimal single-page PDF with extractable text (no external fixtures). */
function makePdf(textLine: string): Uint8Array {
  const objs: Record<number, string> = {
    1: "<</Type/Catalog/Pages 2 0 R>>",
    2: "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    3: "<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 5 0 R>>>>/Contents 4 0 R>>",
    5: "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
  };
  const stream = `BT /F1 18 Tf 72 700 Td (${textLine}) Tj ET`;
  objs[4] = `<</Length ${stream.length}>>\nstream\n${stream}\nendstream`;
  let pdf = "%PDF-1.4\n";
  const offsets: Record<number, number> = {};
  for (let i = 1; i <= 5; i++) {
    offsets[i] = pdf.length;
    pdf += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xrefStart = pdf.length;
  pdf += "xref\n0 6\n0000000000 65535 f \n";
  for (let i = 1; i <= 5; i++) {
    pdf += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
  }
  pdf += `trailer\n<</Size 6/Root 1 0 R>>\nstartxref\n${xrefStart}\n%%EOF`;
  return new Uint8Array(Buffer.from(pdf, "latin1"));
}

type FileReadExec = (
  id: string,
  params: { path: string },
) => Promise<{ content: { text: string }[] }>;

function execFileRead(
  tool: ReturnType<typeof buildFileReadToolDefinition>,
  filePath: string,
): Promise<{ content: { text: string }[] }> {
  return (tool!.execute as unknown as FileReadExec)("call", { path: filePath });
}

const tempDirs: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "attach-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length) {
    await rm(tempDirs.pop()!, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

describe("extractAttachmentText", () => {
  it("renders an xlsx as CSV per sheet with cell values", async () => {
    const bytes = makeXlsx({
      "Income Statement": [
        ["Account", "Q1", "Q2"],
        ["Revenue", 100, 120],
        ["COGS", 40, 50],
      ],
    });
    const out = await extractAttachmentText({
      name: "financials.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      bytes,
    });
    expect(out.readable).toBe(true);
    expect(out.kind).toBe("spreadsheet");
    expect(out.text).toContain("### Sheet: Income Statement");
    expect(out.text).toContain("Account,Q1,Q2");
    expect(out.text).toContain("Revenue,100,120");
  });

  it("emits one block per sheet for multi-sheet workbooks", async () => {
    const bytes = makeXlsx({
      IS: [["Revenue", 1]],
      BS: [["Cash", 2]],
    });
    const out = await extractAttachmentText({
      name: "model.xlsx",
      mimeType: "",
      bytes,
    });
    expect(out.text).toContain("### Sheet: IS");
    expect(out.text).toContain("### Sheet: BS");
  });

  it("passes CSV text through unchanged", async () => {
    const csv = "Account,Q1\nRevenue,100\n";
    const out = await extractAttachmentText({
      name: "gl.csv",
      mimeType: "text/csv",
      bytes: new TextEncoder().encode(csv),
    });
    expect(out.kind).toBe("text");
    expect(out.readable).toBe(true);
    expect(out.text).toContain("Revenue,100");
  });

  it("extracts text from a PDF", async () => {
    const bytes = makePdf("Revenue 100 COGS 40");
    const out = await extractAttachmentText({
      name: "statement.pdf",
      mimeType: "application/pdf",
      bytes,
    });
    expect(out.kind).toBe("pdf");
    expect(out.readable).toBe(true);
    expect(out.text).toContain("Revenue 100 COGS 40");
  });

  it("marks unknown binary as not readable", async () => {
    // PNG magic bytes — not a spreadsheet, not text.
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x00, 1]);
    const out = await extractAttachmentText({
      name: "logo.png",
      mimeType: "image/png",
      bytes,
    });
    expect(out.readable).toBe(false);
    expect(out.kind).toBe("binary");
  });
});

describe("normalizeAttachmentRef", () => {
  it("accepts snake_case and camelCase and rejects path traversal", () => {
    expect(
      normalizeAttachmentRef({
        attachment_id: "a1",
        s3_key: "tenants/t/attachments/th/a1/x.csv",
        download_url: "https://signed/x",
        name: "x.csv",
        mime_type: "text/csv",
        size_bytes: 10,
      }),
    ).toMatchObject({ attachmentId: "a1", downloadUrl: "https://signed/x" });
    expect(
      normalizeAttachmentRef({ attachmentId: "a1", name: "../escape.csv" }),
    ).toBeNull();
  });
});

describe("stageAttachmentsViaFetch + file_read", () => {
  it("downloads via download_url and file_read returns extracted text", async () => {
    const dir = await tempDir();
    const turnDir = path.join(dir, "attachments");
    const xlsx = makeXlsx({
      GL: [
        ["Account", "Amount"],
        ["Cash", 999],
      ],
    });
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => xlsx.buffer.slice(0),
    })) as unknown as typeof fetch;

    const staged = await stageAttachmentsViaFetch({
      attachments: [
        {
          attachment_id: "a1",
          s3_key: "tenants/t/attachments/th/a1/General-Ledger.xlsx",
          download_url: "https://signed.example/gl",
          name: "General-Ledger.xlsx",
          mime_type:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          size_bytes: xlsx.byteLength,
        },
      ],
      turnDir,
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledWith("https://signed.example/gl");
    expect(staged).toHaveLength(1);
    expect(staged[0]!.localPath).toBe(
      path.join(turnDir, "General-Ledger.xlsx"),
    );

    const preamble = formatMessageAttachmentsPreamble(staged);
    expect(preamble).toContain("General-Ledger.xlsx");
    expect(preamble).toContain("file_read");

    const tool = buildFileReadToolDefinition(staged);
    expect(tool).not.toBeNull();
    const result = await execFileRead(tool, staged[0]!.localPath);
    const text = result.content[0]!.text;
    expect(text).toContain("### Sheet: GL");
    expect(text).toContain("Cash,999");
  });

  it("skips refs without a download_url and denies unknown paths", async () => {
    const dir = await tempDir();
    const staged = await stageAttachmentsViaFetch({
      attachments: [{ attachment_id: "a1", name: "x.csv" }],
      turnDir: path.join(dir, "attachments"),
    });
    expect(staged).toHaveLength(0);
    expect(buildFileReadToolDefinition(staged)).toBeNull();
  });

  it("cleans up the staged dir", async () => {
    const dir = await tempDir();
    const turnDir = path.join(dir, "attachments");
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new TextEncoder().encode("a,b\n1,2\n").buffer,
    })) as unknown as typeof fetch;
    const staged = await stageAttachmentsViaFetch({
      attachments: [
        {
          attachment_id: "a1",
          download_url: "https://signed/x",
          name: "x.csv",
          mime_type: "text/csv",
        },
      ],
      turnDir,
      fetchImpl,
    });
    expect(staged).toHaveLength(1);
    await cleanupStagedAttachments(dir);
    const tool = buildFileReadToolDefinition(staged);
    await expect(execFileRead(tool, staged[0]!.localPath)).rejects.toThrow();
  });
});
