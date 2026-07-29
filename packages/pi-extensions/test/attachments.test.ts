import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import JSZip from "jszip";
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

const PPTX_MIME =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function makePptx(slides: string[][]): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", "<Types/>");
  slides.forEach((paragraphs, i) => {
    const body = paragraphs
      .map((p) => `<a:p><a:r><a:t>${p}</a:t></a:r></a:p>`)
      .join("");
    zip.file(
      `ppt/slides/slide${i + 1}.xml`,
      `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${body}</p:sld>`,
    );
  });
  return zip.generateAsync({ type: "uint8array" });
}

function makeDocx(paragraphs: string[]): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", "<Types/>");
  const body = paragraphs
    .map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`)
    .join("");
  zip.file(
    "word/document.xml",
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
  );
  return zip.generateAsync({ type: "uint8array" });
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

  it("extracts slide text from a pptx", async () => {
    const bytes = await makePptx([
      ["Q2 Highlights", "Revenue up 12%"],
      ["Risks &amp; Mitigations"],
    ]);
    const out = await extractAttachmentText({
      name: "deck.pptx",
      mimeType: PPTX_MIME,
      bytes,
    });
    expect(out.readable).toBe(true);
    expect(out.kind).toBe("presentation");
    expect(out.text).toContain("### Slide 1");
    expect(out.text).toContain("Q2 Highlights");
    expect(out.text).toContain("Revenue up 12%");
    expect(out.text).toContain("### Slide 2");
    expect(out.text).toContain("Risks & Mitigations");
    expect(out.text).not.toContain("\u0000");
  });

  it("extracts paragraph text from a docx", async () => {
    const bytes = await makeDocx(["Executive Summary", "We grew 12%."]);
    const out = await extractAttachmentText({
      name: "memo.docx",
      mimeType: DOCX_MIME,
      bytes,
    });
    expect(out.readable).toBe(true);
    expect(out.kind).toBe("document");
    expect(out.text).toContain("Executive Summary");
    expect(out.text).toContain("We grew 12%.");
    expect(out.text).not.toContain("\u0000");
  });

  it("never decodes an OOXML binary as raw text, even when unparseable", async () => {
    // Regression: PPTX/DOCX MIME types contain the substring "xml"
    // ("openxmlformats"), which used to trip the text-like MIME check and dump
    // raw NUL-laden ZIP bytes into the transcript (wedging turn persistence).
    const garbage = new Uint8Array(64 * 1024);
    garbage.set([0x50, 0x4b, 0x03, 0x04]); // PK zip magic, but corrupt beyond
    for (const mime of [PPTX_MIME, DOCX_MIME]) {
      const out = await extractAttachmentText({
        name: mime === PPTX_MIME ? "deck.pptx" : "memo.docx",
        mimeType: mime,
        bytes: garbage,
      });
      expect(out.readable).toBe(false);
      expect(out.text).toBe("");
    }
  });

  it("still treats real XML MIME types as text", async () => {
    const out = await extractAttachmentText({
      name: "feed",
      mimeType: "application/rss+xml",
      bytes: new TextEncoder().encode("<rss><title>hello</title></rss>"),
    });
    expect(out.readable).toBe(true);
    expect(out.kind).toBe("text");
  });

  it("strips NUL bytes from text extractions", async () => {
    const bytes = new Uint8Array([104, 105, 0, 33]); // "hi\0!"
    const out = await extractAttachmentText({
      name: "weird.txt",
      mimeType: "text/plain",
      bytes,
    });
    expect(out.readable).toBe(true);
    expect(out.text).toBe("hi!");
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
