// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
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

  it("injects no <base> tag by default (artifact posture unchanged)", () => {
    expect(withDocumentFrameEnvelope(DOC, "light")).not.toContain("<base");
    expect(
      withDocumentFrameEnvelope(DOC, "light", { baseTargetTop: false }),
    ).not.toContain("<base");
  });

  it("default envelope output is byte-identical to the pre-variant shape", () => {
    // Regression tripwire for PlatePreviewPanel, which calls
    // withDocumentFrameEnvelope directly: the exact pre-THINK-274 output.
    expect(withDocumentFrameEnvelope("<body>x</body>", "light")).toBe(
      `<meta http-equiv="Content-Security-Policy" content="${DOCUMENT_FRAME_CSP}">` +
        `<style data-thinkwork-document-theme>:root{color-scheme:light;}</style>` +
        "<body>x</body>",
    );
  });

  it('injects <base target="_top"> into <head> after the CSP meta for the wiki variant', () => {
    const out = withDocumentFrameEnvelope(DOC, "light", {
      baseTargetTop: true,
    });
    expect(out).toContain('<base target="_top">');
    const headOpen = out.indexOf("<head");
    const csp = out.indexOf("Content-Security-Policy");
    const base = out.indexOf('<base target="_top">');
    const headClose = out.indexOf("</head>");
    expect(headOpen).toBeLessThan(csp);
    expect(csp).toBeLessThan(base);
    expect(base).toBeLessThan(headClose);
  });

  it("still injects CSP + theme + base on the prepend path (no <head>)", () => {
    const out = withDocumentFrameEnvelope("<body>x</body>", "dark", {
      baseTargetTop: true,
    });
    expect(out).toContain(DOCUMENT_FRAME_CSP);
    expect(out).toContain("color-scheme:dark");
    expect(out).toContain('<base target="_top">');
  });
});

describe("documentThemeToken", () => {
  it("maps explicit app themes directly", () => {
    expect(documentThemeToken("dark")).toBe("dark");
    expect(documentThemeToken("light")).toBe("light");
  });
});

describe("DocumentFrame", () => {
  afterEach(cleanup);

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
    expect(frame.getAttribute("srcdoc")).not.toContain("<base");
  });

  it("wiki navigation variant grants exactly top-navigation-by-user-activation with a base tag", () => {
    const { getByTestId } = render(
      <ThemeProvider>
        <DocumentFrame
          html={DOC}
          title="T"
          navigation="top-by-user-activation"
        />
      </ThemeProvider>,
    );
    const frame = getByTestId("document-frame") as HTMLIFrameElement;
    expect(frame.getAttribute("sandbox")).toBe(
      "allow-top-navigation-by-user-activation",
    );
    expect(frame.getAttribute("srcdoc")).toContain('<base target="_top">');
    // Theme stamping is unchanged in the variant.
    expect(frame.getAttribute("srcdoc")).toContain("data-theme=");
  });
});
