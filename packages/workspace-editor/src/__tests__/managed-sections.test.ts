import { describe, expect, it } from "vitest";
import {
  DEFAULT_MANAGED_SECTION_HEADINGS,
  editTouchesManagedSection,
  findManagedSectionRanges,
  hasManagedSections,
  managedSectionHeadingsPresent,
} from "../lib/managed-sections.js";

const HEADINGS = DEFAULT_MANAGED_SECTION_HEADINGS;

const DOC = [
  "# Agent",
  "",
  "Operator prose the human owns.",
  "",
  "## Folder Structure",
  "",
  "- computed/folder/map",
  "",
  "## Skills & Tools",
  "",
  "- computed skill row",
  "",
  "## Notes",
  "",
  "More operator prose.",
  "",
].join("\n");

describe("findManagedSectionRanges", () => {
  it("finds each managed heading body and stops at the next heading", () => {
    const ranges = findManagedSectionRanges(DOC, HEADINGS);
    expect(ranges.map((r) => r.heading)).toEqual([
      "Folder Structure",
      "Skills & Tools",
    ]);
    const folder = ranges[0];
    expect(DOC.slice(folder.bodyStart, folder.bodyEnd)).toContain(
      "computed/folder/map",
    );
    // The body must not spill into the following "## Skills & Tools" heading.
    expect(DOC.slice(folder.bodyStart, folder.bodyEnd)).not.toContain(
      "Skills & Tools",
    );
  });

  it("returns no ranges for a prose-only document", () => {
    expect(
      findManagedSectionRanges(
        "# Just prose\n\nno managed headings\n",
        HEADINGS,
      ),
    ).toEqual([]);
    expect(hasManagedSections("# Just prose\n", HEADINGS)).toBe(false);
  });

  it("reports present headings in document order", () => {
    expect(managedSectionHeadingsPresent(DOC, HEADINGS)).toEqual([
      "Folder Structure",
      "Skills & Tools",
    ]);
  });
});

describe("editTouchesManagedSection", () => {
  it("is false when nothing changed", () => {
    expect(editTouchesManagedSection(DOC, DOC, HEADINGS)).toBe(false);
  });

  it("is false when only operator prose outside managed sections changed", () => {
    const edited = DOC.replace(
      "Operator prose the human owns.",
      "Operator prose the human owns — reworded.",
    );
    expect(editTouchesManagedSection(DOC, edited, HEADINGS)).toBe(false);
  });

  it("is false when trailing prose after all managed sections changed", () => {
    const edited = DOC.replace("More operator prose.", "Even more prose here.");
    expect(editTouchesManagedSection(DOC, edited, HEADINGS)).toBe(false);
  });

  it("is true when a managed body line is edited", () => {
    const edited = DOC.replace(
      "- computed skill row",
      "- computed skill row (operator tampered)",
    );
    expect(editTouchesManagedSection(DOC, edited, HEADINGS)).toBe(true);
  });

  it("is true when a managed body line is deleted", () => {
    const edited = DOC.replace("- computed/folder/map\n", "");
    expect(editTouchesManagedSection(DOC, edited, HEADINGS)).toBe(true);
  });

  it("is true when text is inserted into a managed body", () => {
    const edited = DOC.replace(
      "- computed/folder/map",
      "- computed/folder/map\n- sneaky/extra/line",
    );
    expect(editTouchesManagedSection(DOC, edited, HEADINGS)).toBe(true);
  });
});
