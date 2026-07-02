import { describe, expect, it } from "vitest";
import {
  findManagedSectionRanges,
  managedHeadingsForFile,
  managedSectionsEdited,
} from "../lib/managed-sections.js";

const AGENTS_MD = [
  "# Agent",
  "",
  "Operator prose up top.",
  "",
  "## Folder Structure",
  "",
  "- skills/",
  "- Spaces/",
  "",
  "## Skills & Tools",
  "",
  "| Skill | When |",
  "| --- | --- |",
  "",
  "## Notes",
  "",
  "Hand-written notes below the managed block.",
  "",
].join("\n");

const CONTEXT_MD = [
  "# Context",
  "",
  "Prose.",
  "",
  "## Routing",
  "",
  "- For tasks covered by the `alpha` skill, read skills/alpha/SKILL.md and follow it.",
  "",
].join("\n");

describe("managedHeadingsForFile", () => {
  it("matches by basename at any depth", () => {
    expect(managedHeadingsForFile("AGENTS.md")).toEqual([
      "Folder Structure",
      "Skills & Tools",
    ]);
    expect(managedHeadingsForFile("Spaces/growth/CONTEXT.md")).toEqual([
      "Routing",
    ]);
    expect(managedHeadingsForFile("skills/alpha/SKILL.md")).toEqual([]);
    expect(managedHeadingsForFile("notes.md")).toEqual([]);
  });
});

describe("findManagedSectionRanges", () => {
  it("finds both AGENTS.md sections in document order and stops at the next heading", () => {
    const ranges = findManagedSectionRanges("AGENTS.md", AGENTS_MD);
    expect(ranges.map((range) => range.heading)).toEqual([
      "Folder Structure",
      "Skills & Tools",
    ]);
    const skillsRange = ranges[1];
    const body = AGENTS_MD.slice(skillsRange.bodyStart, skillsRange.end);
    expect(body).toContain("| Skill | When |");
    expect(body).not.toContain("## Notes");
    expect(body).not.toContain("Hand-written");
  });

  it("returns nothing for a file whose managed headings are absent", () => {
    expect(
      findManagedSectionRanges("CONTEXT.md", "# Context\n\nJust prose.\n"),
    ).toEqual([]);
  });

  it("runs a trailing section to end of file", () => {
    const ranges = findManagedSectionRanges("CONTEXT.md", CONTEXT_MD);
    expect(ranges).toHaveLength(1);
    expect(ranges[0].end).toBe(CONTEXT_MD.length);
  });
});

describe("managedSectionsEdited", () => {
  it("returns nothing for a prose-only edit", () => {
    const edited = AGENTS_MD.replace(
      "Operator prose up top.",
      "Operator prose, revised.",
    ).replace("Hand-written notes", "Rewritten notes");
    expect(managedSectionsEdited("AGENTS.md", AGENTS_MD, edited)).toEqual([]);
  });

  it("flags an edit inside a managed body", () => {
    const edited = AGENTS_MD.replace("- skills/", "- skills/ (tweaked)");
    expect(managedSectionsEdited("AGENTS.md", AGENTS_MD, edited)).toEqual([
      "Folder Structure",
    ]);
  });

  it("flags deleting a managed section", () => {
    const edited = CONTEXT_MD.slice(0, CONTEXT_MD.indexOf("## Routing"));
    expect(managedSectionsEdited("CONTEXT.md", CONTEXT_MD, edited)).toEqual([
      "Routing",
    ]);
  });

  it("ignores files with no managed vocabulary", () => {
    expect(managedSectionsEdited("notes.md", "a", "b")).toEqual([]);
  });

  it("ignores a heading that never existed in the original", () => {
    const original = "# Context\n\nProse only.\n";
    const edited = `${original}\n## Routing\n\n- hand-added row\n`;
    expect(managedSectionsEdited("CONTEXT.md", original, edited)).toEqual([]);
  });
});
