import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./AdminAppletPreview.tsx", import.meta.url),
  "utf8",
);

describe("AdminAppletPreview source contract", () => {
  it("mounts applet source through the sandbox shell instead of the Computer route", () => {
    expect(source).toContain('sandbox="allow-scripts"');
    expect(source).toContain('postEnvelope("init"');
    expect(source).toContain("tsx: source");
    expect(source).toContain("resolveAdminSandboxIframeSrc");
    expect(source).not.toContain("/artifacts/");
  });
});
