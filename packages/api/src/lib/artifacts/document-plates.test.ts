/**
 * THINK-147 U7: the document-composer genre plates must pass the validator
 * the emission path enforces — a plate that fails DocSpector would teach
 * agents to produce rejected documents.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runDocumentPreflight } from "./document-preflight.js";

const platesDir = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../../../workspace-defaults/files/skills/document-composer/references",
);

describe("document-composer plates pass DocSpector", () => {
  const plates = readdirSync(platesDir).filter((f) => f.endsWith(".html"));

  it("has all four genre plates", () => {
    expect(plates.sort()).toEqual([
      "plate-brief.html",
      "plate-ideation.html",
      "plate-plan.html",
      "plate-report.html",
    ]);
  });

  for (const plate of plates) {
    it(`${plate} is fully self-contained, dual-theme, and scriptless`, () => {
      const renderHtml = readFileSync(join(platesDir, plate), "utf8");
      const result = runDocumentPreflight({
        renderHtml,
        digestMarkdown: "# Plate digest placeholder",
      });
      if (!result.ok) {
        throw new Error(
          `${plate} failed preflight:\n${result.diagnostics
            .map((d) => `  [${d.code}] ${d.location}: ${d.message}`)
            .join("\n")}`,
        );
      }
      expect(result.ok).toBe(true);
      // The reader-injected token overrides must exist alongside the media query.
      expect(renderHtml).toContain('data-theme="dark"');
      expect(renderHtml).toContain("@media print");
    });
  }
});
