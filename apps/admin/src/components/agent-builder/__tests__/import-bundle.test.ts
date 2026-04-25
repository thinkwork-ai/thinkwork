import { describe, expect, it } from "vitest";
import {
  acceptsZipFile,
  buildGitImportRequest,
  describeImportError,
} from "@/lib/agent-builder-api";

describe("import bundle helpers", () => {
  it("accepts zip files by extension or zip mime type", () => {
    expect(
      acceptsZipFile(new File(["x"], "agent.zip", { type: "text/plain" })),
    ).toBe(true);
    expect(
      acceptsZipFile(new File(["x"], "agent.bin", { type: "application/zip" })),
    ).toBe(true);
    expect(acceptsZipFile(new File(["x"], "agent.tar"))).toBe(false);
  });

  it("trims optional git ref fields and omits empty secrets", () => {
    expect(
      buildGitImportRequest({
        url: " https://github.com/acme/agent ",
        ref: " main ",
        pat: "",
      }),
    ).toEqual({
      source: "git",
      url: "https://github.com/acme/agent",
      ref: "main",
    });
  });

  it("maps SI-4 zip safety errors to operator copy", () => {
    expect(
      describeImportError({
        code: "ZipSafetyFailed",
        details: { errors: [{ kind: "ZipPathEscape", path: "../x" }] },
      }),
    ).toEqual({
      title: "Archive contains unsafe paths",
      description: "Archive contains a path that escapes the import root.",
    });
  });

  it("maps root reserved and collision responses", () => {
    expect(describeImportError({ code: "ReservedRootFile" }).title).toBe(
      "Import wants to replace a protected root file",
    );
    expect(
      describeImportError({
        code: "ExistingSubAgentCollision",
        message: "A sub-agent folder already exists at sales/",
      }).description,
    ).toBe("A sub-agent folder already exists at sales/");
  });
});
