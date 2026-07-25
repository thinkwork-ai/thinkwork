import { describe, expect, it } from "vitest";
import {
  baseDocumentKey,
  derivedPrefix,
  foldPageStatuses,
  pageDocumentHeader,
  pageDocumentId,
  pageNumberFromId,
  routePage,
  sanitizeForInlineIngestion,
} from "./kb-transcribe-report";

describe("routePage", () => {
  it("takes a text-dense page with no images natively", () => {
    expect(routePage({ nativeChars: 1200, imageCount: 0 })).toBe("native");
  });

  it("transcribes a caption-only SOP page", () => {
    // Scribe-style step pages carry ~100-250 characters of caption beside the
    // screenshot that is the actual instruction — the caption alone is what
    // the default parser indexes today, and it is not the content.
    expect(routePage({ nativeChars: 180, imageCount: 0 })).toBe("transcribed");
  });

  it("transcribes a page with no text layer at all", () => {
    expect(routePage({ nativeChars: 0, imageCount: 1 })).toBe("transcribed");
  });

  it("transcribes a text-dense page that still carries an image", () => {
    expect(routePage({ nativeChars: 5000, imageCount: 2 })).toBe("transcribed");
  });
});

describe("sanitizeForInlineIngestion", () => {
  it("strips the control characters that fail Bedrock inline ingestion", () => {
    // \x0B is what python-pptx emits for a soft line break; Bedrock rejects
    // the document with an empty statusReason, so it must never reach it.
    expect(sanitizeForInlineIngestion("a\x0Bb\x00c\x1Fd")).toBe("abcd");
  });

  it("preserves tabs, newlines and carriage returns", () => {
    expect(sanitizeForInlineIngestion("a\tb\nc\r\nd")).toBe("a\tb\nc\r\nd");
  });
});

describe("page document ids", () => {
  it("round-trips a key through the page id", () => {
    const key = "cx/files/CX-0215 Setting Up New Reason Code.pdf";
    const id = pageDocumentId(key, 1);
    expect(id).toBe(`${key}#p=1`);
    expect(baseDocumentKey(id)).toBe(key);
    expect(pageNumberFromId(id)).toBe(1);
  });

  it("leaves a plain key untouched", () => {
    // Documents ingested before transcription have no page suffix; the
    // citation surface has to keep resolving them.
    expect(baseDocumentKey("cx/files/a.pdf")).toBe("cx/files/a.pdf");
    expect(pageNumberFromId("cx/files/a.pdf")).toBeNull();
  });

  it("does not mistake a '#' inside the key for the page delimiter", () => {
    const key = "cx/files/PO #4471 handling.pdf";
    expect(baseDocumentKey(pageDocumentId(key, 12))).toBe(key);
    expect(pageNumberFromId(pageDocumentId(key, 12))).toBe(12);
  });
});

describe("foldPageStatuses", () => {
  it("reports a document as FAILED when any page failed", () => {
    const folded = foldPageStatuses(
      new Map([
        ["a.pdf#p=1", "INDEXED"],
        ["a.pdf#p=2", "FAILED"],
        ["a.pdf#p=3", "INDEXED"],
      ]),
    );
    expect(folded.get("a.pdf")).toBe("FAILED");
  });

  it("reports in-flight over indexed so a sync does not settle early", () => {
    const folded = foldPageStatuses(
      new Map([
        ["a.pdf#p=1", "INDEXED"],
        ["a.pdf#p=2", "IN_PROGRESS"],
      ]),
    );
    expect(folded.get("a.pdf")).toBe("IN_PROGRESS");
  });

  it("reports INDEXED only when every page is indexed", () => {
    const folded = foldPageStatuses(
      new Map([
        ["a.pdf#p=1", "INDEXED"],
        ["a.pdf#p=2", "INDEXED"],
      ]),
    );
    expect(folded.get("a.pdf")).toBe("INDEXED");
  });

  it("keeps documents separate", () => {
    const folded = foldPageStatuses(
      new Map([
        ["a.pdf#p=1", "FAILED"],
        ["b.pdf#p=1", "INDEXED"],
      ]),
    );
    expect(folded.get("a.pdf")).toBe("FAILED");
    expect(folded.get("b.pdf")).toBe("INDEXED");
  });
});

describe("derivedPrefix", () => {
  const base = {
    tenantSlug: "mcpherson",
    knowledgeBaseId: "00b8fedf",
    documentKey: "cx/files/CX-0215.pdf",
  };

  it("changes when the source bytes change", () => {
    // Change detection has to invalidate derived pages, or a re-scanned
    // document would keep serving the old transcription.
    expect(derivedPrefix({ ...base, etag: "aaa" })).not.toBe(
      derivedPrefix({ ...base, etag: "bbb" }),
    );
  });

  it("changes when the pipeline version changes", () => {
    expect(
      derivedPrefix({ ...base, etag: "aaa", preprocessorVersion: "1" }),
    ).not.toBe(
      derivedPrefix({ ...base, etag: "aaa", preprocessorVersion: "2" }),
    );
  });

  it("is stable for identical inputs", () => {
    expect(derivedPrefix({ ...base, etag: "aaa" })).toBe(
      derivedPrefix({ ...base, etag: "aaa" }),
    );
  });

  it("produces a key-safe path from a key with spaces", () => {
    const prefix = derivedPrefix({
      ...base,
      documentKey: "cx/files/CX-0215 Setting Up.pdf",
      etag: "aaa",
    });
    expect(prefix).not.toContain(" ");
  });
});

describe("pageDocumentHeader", () => {
  it("names the document and page so a lone chunk can be cited", () => {
    const header = pageDocumentHeader({
      title: "CX-0215 Setting Up New Reason Code",
      page: 1,
      pageCount: 1,
      transcribed: true,
    });
    expect(header).toContain("CX-0215 Setting Up New Reason Code");
    expect(header).toContain("Page 1 of 1");
  });

  it("marks transcribed pages so the agent can attribute them", () => {
    expect(
      pageDocumentHeader({
        title: "t",
        page: 2,
        pageCount: 3,
        transcribed: true,
      }),
    ).toContain("transcribed");
    expect(
      pageDocumentHeader({
        title: "t",
        page: 2,
        pageCount: 3,
        transcribed: false,
      }),
    ).not.toContain("transcribed");
  });
});
