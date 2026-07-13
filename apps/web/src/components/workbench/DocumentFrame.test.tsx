// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { ThemeProvider } from "@thinkwork/ui";
import {
  DocumentFrame,
  DOCUMENT_FRAME_CSP,
  documentThemeToken,
  withDocumentFrameEnvelope,
} from "./DocumentFrame";

const DOC =
  '<!DOCTYPE html><html lang="en"><head><title>T</title></head><body><h1 id="a">T</h1></body></html>';

describe("withDocumentFrameEnvelope", () => {
  it("prepends the CSP meta into <head>", () => {
    const out = withDocumentFrameEnvelope(DOC, "light");
    expect(out).toContain(DOCUMENT_FRAME_CSP);
    expect(out.indexOf("Content-Security-Policy")).toBeLessThan(
      out.indexOf("<title>"),
    );
  });

  it("injects the app theme token (dark app, regardless of OS)", () => {
    const out = withDocumentFrameEnvelope(DOC, "dark");
    expect(out).toContain("color-scheme:dark");
    expect(out).toContain('data-theme="dark"');
  });

  it("keeps documents without an <html> tag renderable", () => {
    const out = withDocumentFrameEnvelope("<body>x</body>", "light");
    expect(out).toContain(DOCUMENT_FRAME_CSP);
  });
});

describe("documentThemeToken", () => {
  it("maps explicit app themes directly", () => {
    expect(documentThemeToken("dark")).toBe("dark");
    expect(documentThemeToken("light")).toBe("light");
  });
});

describe("DocumentFrame", () => {
  it("renders a zero-grant sandbox (AE5 render half) with the envelope", () => {
    const { getByTestId } = render(
      <ThemeProvider>
        <DocumentFrame html={DOC} title="T" />
      </ThemeProvider>,
    );
    const frame = getByTestId("document-frame") as HTMLIFrameElement;
    // Literal attribute assertion: the document tier grants NOTHING.
    expect(frame.getAttribute("sandbox")).toBe("");
    expect(frame.getAttribute("srcdoc")).toContain("Content-Security-Policy");
  });
});
