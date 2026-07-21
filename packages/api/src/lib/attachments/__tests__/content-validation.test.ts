import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import {
  validateOoxmlSafety,
  verifyMagicBytes,
} from "../content-validation.js";

describe("verifyMagicBytes", () => {
  it("accepts a real .xlsx PK\\x03\\x04 prefix", () => {
    const buf = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0xff, 0xff]);
    expect(verifyMagicBytes(buf, ".xlsx").ok).toBe(true);
  });

  it("rejects a .xlsx whose prefix doesn't match (e.g., a renamed .exe)", () => {
    const peHeader = Buffer.from([0x4d, 0x5a, 0x90, 0x00]); // "MZ" Windows EXE
    const result = verifyMagicBytes(peHeader, ".xlsx");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("magic_byte_mismatch");
  });

  it("accepts a real .xls CFBF prefix", () => {
    const buf = Buffer.from([
      0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00, 0x00,
    ]);
    expect(verifyMagicBytes(buf, ".xls").ok).toBe(true);
  });

  it("accepts CSV with UTF-8 BOM", () => {
    const buf = Buffer.from([0xef, 0xbb, 0xbf, 0x61, 0x2c, 0x62]); // "...a,b"
    expect(verifyMagicBytes(buf, ".csv").ok).toBe(true);
  });

  it("accepts CSV without BOM (printable ASCII prefix)", () => {
    const buf = Buffer.from("col1,col2,col3\n1,2,3\n", "utf-8");
    expect(verifyMagicBytes(buf, ".csv").ok).toBe(true);
  });

  it("rejects CSV with binary prefix", () => {
    const buf = Buffer.from([0xff, 0xfe, 0x00, 0x00]); // UTF-16 BOM
    const result = verifyMagicBytes(buf, ".csv");
    expect(result.ok).toBe(false);
  });

  it("rejects empty CSV (buffer_too_short)", () => {
    const result = verifyMagicBytes(Buffer.alloc(0), ".csv");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("buffer_too_short");
  });

  it("accepts Markdown and text files with printable ASCII prefixes", () => {
    expect(verifyMagicBytes(Buffer.from("# Spec\n\nHello"), ".md").ok).toBe(
      true,
    );
    expect(verifyMagicBytes(Buffer.from("Plain notes"), ".txt").ok).toBe(true);
  });

  it("accepts a real PDF prefix", () => {
    const result = verifyMagicBytes(Buffer.from("%PDF-1.4\n"), ".pdf");
    expect(result.ok).toBe(true);
  });

  it("rejects Markdown with a binary prefix", () => {
    const result = verifyMagicBytes(Buffer.from([0xff, 0xfe, 0x00]), ".md");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("magic_byte_mismatch");
  });

  it("passes through extensions without a registered magic table", () => {
    // Any-file-type support: unknown formats aren't sniffable, so they
    // are accepted here and gated by the extension blocklist + forced
    // download disposition instead.
    expect(verifyMagicBytes(Buffer.from([0x00]), ".zip").ok).toBe(true);
    expect(verifyMagicBytes(Buffer.from("{}"), ".json").ok).toBe(true);
    expect(verifyMagicBytes(Buffer.from("FROM node:22"), "").ok).toBe(true);
  });

  it("accepts real image prefixes", () => {
    expect(
      verifyMagicBytes(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
        ".png",
      ).ok,
    ).toBe(true);
    expect(
      verifyMagicBytes(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), ".jpg").ok,
    ).toBe(true);
    expect(
      verifyMagicBytes(Buffer.from([0xff, 0xd8, 0xff, 0xe1]), ".jpeg").ok,
    ).toBe(true);
    expect(verifyMagicBytes(Buffer.from("GIF89a"), ".gif").ok).toBe(true);
  });

  it("rejects a renamed executable posing as an image", () => {
    // PE/MZ header declared as .png
    const result = verifyMagicBytes(
      Buffer.from([0x4d, 0x5a, 0x90, 0x00]),
      ".png",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("magic_byte_mismatch");
  });
});

describe("validateOoxmlSafety", () => {
  async function buildXlsxBuffer(
    entries: Record<string, string | Buffer>,
  ): Promise<Buffer> {
    const zip = new JSZip();
    for (const [path, body] of Object.entries(entries)) {
      zip.file(path, body);
    }
    return Buffer.from(
      await zip.generateAsync({ type: "uint8array", platform: "UNIX" }),
    );
  }

  it("accepts a minimal valid xlsx-shaped zip", async () => {
    const buf = await buildXlsxBuffer({
      "[Content_Types].xml": '<?xml version="1.0"?><Types></Types>',
      "xl/workbook.xml": '<?xml version="1.0"?><workbook/>',
      "xl/worksheets/sheet1.xml": '<?xml version="1.0"?><worksheet/>',
    });
    const result = await validateOoxmlSafety(buf);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.entryCount).toBeGreaterThan(0);
  });

  it("rejects macro-enabled workbook (xl/vbaProject.bin)", async () => {
    const buf = await buildXlsxBuffer({
      "[Content_Types].xml": '<?xml version="1.0"?><Types></Types>',
      "xl/workbook.xml": '<?xml version="1.0"?><workbook/>',
      "xl/vbaProject.bin": Buffer.from([0xd0, 0xcf, 0x11, 0xe0]),
    });
    const result = await validateOoxmlSafety(buf);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("macro_enabled");
      expect(result.detail).toContain("vbaProject.bin");
    }
  });

  it("rejects workbook with external links (xl/externalLinks/)", async () => {
    const buf = await buildXlsxBuffer({
      "[Content_Types].xml": '<?xml version="1.0"?><Types></Types>',
      "xl/workbook.xml": '<?xml version="1.0"?><workbook/>',
      "xl/externalLinks/externalLink1.xml":
        '<?xml version="1.0"?><externalLink/>',
    });
    const result = await validateOoxmlSafety(buf);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("external_links");
      expect(result.detail).toContain("externalLinks");
    }
  });

  it("rejects a buffer that is not a valid zip (malformed)", async () => {
    const result = await validateOoxmlSafety(Buffer.from("not a zip at all"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("zip_malformed");
  });

  it("rejects a zip with path-escape entries", async () => {
    // Build a zip whose central directory advertises a path that
    // resolves outside the root. JSZip's normalizer makes this hard
    // to construct via the high-level API; use the file() with a
    // `../` prefix and assert the zip-safety layer catches it.
    const zip = new JSZip();
    zip.file("../../../etc/passwd", "rootkit");
    const buf = Buffer.from(
      await zip.generateAsync({ type: "uint8array", platform: "UNIX" }),
    );
    const result = await validateOoxmlSafety(buf);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(["zip_path_escape", "zip_malformed"]).toContain(result.reason);
    }
  });

  it("rejects when macro detection matches case-insensitively", async () => {
    const buf = await buildXlsxBuffer({
      "XL/vbaproject.bin": Buffer.from([0xd0]), // odd casing
    });
    const result = await validateOoxmlSafety(buf);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("macro_enabled");
  });
});
