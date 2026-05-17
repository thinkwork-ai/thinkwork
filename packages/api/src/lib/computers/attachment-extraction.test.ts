import { describe, expect, it } from "vitest";
import JSZip from "jszip";

import {
  attachmentDownloadByteLimit,
  extractAttachmentText,
} from "./attachment-extraction.js";

describe("Computer attachment extraction", () => {
  it("keeps existing text attachment behavior", async () => {
    const result = await extractAttachmentText({
      name: "report.md",
      mimeType: "text/markdown",
      sizeBytes: 18,
      body: Buffer.from("# Report\n\nRevenue."),
    });

    expect(result).toMatchObject({
      readable: true,
      contentText: "# Report\n\nRevenue.",
      extractionKind: "text",
      truncated: false,
    });
  });

  it("extracts workbook sheet names and values from xlsx attachments", async () => {
    const body = await buildXlsxBuffer({
      sheetName: "Statement",
      rows: [
        ["Metric", "Value"],
        ["Revenue", "12345"],
        ["EBITDA", "6789"],
      ],
    });

    const result = await extractAttachmentText({
      name: "financials.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      sizeBytes: body.length,
      body,
    });

    expect(result).toMatchObject({
      readable: true,
      extractionKind: "xlsx",
      truncated: false,
    });
    if (result.readable) {
      expect(result.contentText).toContain("Sheet: Statement");
      expect(result.contentText).toContain("A2=Revenue");
      expect(result.contentText).toContain("B2=12345");
      expect(result.contentText).toContain("A3=EBITDA");
      expect(result.contentText).toContain("B3=6789");
    }
  });

  it("rejects unsafe macro-enabled xlsx attachments before parsing", async () => {
    const zip = new JSZip();
    zip.file("[Content_Types].xml", "<Types />");
    zip.file("xl/workbook.xml", "<workbook />");
    zip.file("xl/worksheets/sheet1.xml", "<worksheet />");
    zip.file("xl/vbaProject.bin", Buffer.from([0xd0, 0xcf, 0x11, 0xe0]));
    const body = Buffer.from(await zip.generateAsync({ type: "uint8array" }));

    const result = await extractAttachmentText({
      name: "financials.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      sizeBytes: body.length,
      body,
    });

    expect(result).toEqual({
      readable: false,
      truncated: false,
      reason: "unsafe_ooxml",
      extractionKind: "xlsx",
    });
  });

  it("extracts visible text from pdf attachments", async () => {
    const body = Buffer.from(minimalPdf("Board revenue was 12345"), "utf8");

    const result = await extractAttachmentText({
      name: "board-statement.pdf",
      mimeType: "application/pdf",
      sizeBytes: body.length,
      body,
    });

    expect(result).toMatchObject({
      readable: true,
      extractionKind: "pdf",
      truncated: false,
    });
    if (result.readable) {
      expect(result.contentText).toContain("Board revenue was 12345");
    }
  });

  it("rejects unsupported binary attachments without parsing", async () => {
    const result = await extractAttachmentText({
      name: "archive.zip",
      mimeType: "application/zip",
      sizeBytes: 4,
      body: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    });

    expect(result).toEqual({
      readable: false,
      truncated: false,
      reason: "unsupported_mime_type",
    });
    expect(
      attachmentDownloadByteLimit({
        name: "archive.zip",
        mimeType: "application/zip",
      }),
    ).toBe(0);
  });
});

async function buildXlsxBuffer(input: {
  sheetName: string;
  rows: string[][];
}): Promise<Buffer> {
  const zip = new JSZip();
  const sharedStrings = Array.from(new Set(input.rows.flat()));
  const sharedStringIndex = new Map(
    sharedStrings.map((value, index) => [value, index]),
  );
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>`,
  );
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="${escapeXml(input.sheetName)}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`,
  );
  zip.file(
    "xl/sharedStrings.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<sst>${sharedStrings
      .map((value) => `<si><t>${escapeXml(value)}</t></si>`)
      .join("")}</sst>`,
  );
  zip.file(
    "xl/worksheets/sheet1.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<worksheet><sheetData>${input.rows
      .map(
        (row, rowIndex) =>
          `<row r="${rowIndex + 1}">${row
            .map(
              (value, columnIndex) =>
                `<c r="${columnName(columnIndex)}${rowIndex + 1}" t="s"><v>${sharedStringIndex.get(value)}</v></c>`,
            )
            .join("")}</row>`,
      )
      .join("")}</sheetData></worksheet>`,
  );
  return Buffer.from(await zip.generateAsync({ type: "uint8array" }));
}

function minimalPdf(text: string): string {
  const stream = `BT /F1 24 Tf 72 720 Td (${escapePdfText(text)}) Tj ET`;
  return `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>
endobj
4 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
5 0 obj
<< /Length ${stream.length} >>
stream
${stream}
endstream
endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000241 00000 n 
0000000311 00000 n 
trailer
<< /Size 6 /Root 1 0 R >>
startxref
${360 + stream.length}
%%EOF`;
}

function columnName(index: number): string {
  let n = index + 1;
  let name = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapePdfText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}
