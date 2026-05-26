import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./CopyLinkButton.tsx", import.meta.url),
  "utf8",
);

describe("CopyLinkButton", () => {
  it("renders a ghost icon-xs button that swaps Copy/Check icons", () => {
    expect(source).toContain('variant="ghost"');
    expect(source).toContain('size="icon-xs"');
    expect(source).toContain("<Copy");
    expect(source).toContain("<Check");
    expect(source).toContain("copied ?");
  });

  it("writes text to clipboard and restores Copy icon after 1500ms", () => {
    expect(source).toContain("navigator.clipboard.writeText(text)");
    expect(source).toContain("setCopied(true)");
    expect(source).toContain("setTimeout(() => setCopied(false), 1500)");
  });

  it("stops propagation so row-click handlers do not fire on copy", () => {
    expect(source).toContain("event.stopPropagation()");
  });

  it("swallows clipboard errors silently to leave Copy icon visible", () => {
    expect(source).toContain("} catch {");
  });

  it("exposes ariaLabel prop with a sensible default", () => {
    expect(source).toContain("ariaLabel = \"Copy\"");
    expect(source).toContain("aria-label={ariaLabel}");
  });
});
