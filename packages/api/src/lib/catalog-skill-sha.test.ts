import { describe, expect, it } from "vitest";
import {
  computeCatalogSkillSha,
  computeCatalogSkillShaBySlug,
} from "./catalog-skill-sha.js";

describe("catalog skill sha", () => {
  it("is stable across file ordering", () => {
    const first = computeCatalogSkillSha([
      { relativePath: "SKILL.md", content: "# Skill\n" },
      { relativePath: "WIRING.md", content: "## Wiring\n" },
    ]);
    const second = computeCatalogSkillSha([
      { relativePath: "WIRING.md", content: "## Wiring\n" },
      { relativePath: "SKILL.md", content: "# Skill\n" },
    ]);

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(second).toBe(first);
  });

  it("changes when a file changes by one trailing newline", () => {
    const withoutExtraNewline = computeCatalogSkillSha([
      { relativePath: "SKILL.md", content: "# Skill\n" },
    ]);
    const withExtraNewline = computeCatalogSkillSha([
      { relativePath: "SKILL.md", content: "# Skill\n\n" },
    ]);

    expect(withExtraNewline).not.toBe(withoutExtraNewline);
  });

  it("has a well-defined empty-folder hash", () => {
    expect(computeCatalogSkillSha([])).toBe(
      "e3b0c44298fc1c149afbf4c8996fb924" + "27ae41e4649b934ca495991b7852b855",
    );
  });

  it("groups catalog file paths by top-level skill slug", () => {
    const hashes = computeCatalogSkillShaBySlug([
      {
        path: "finance-audit-xls/SKILL.md",
        content: "# Finance Audit XLS\n",
      },
      {
        path: "finance-audit-xls/WIRING.md",
        content: "## Wiring\n",
      },
      {
        path: "ledger-review/SKILL.md",
        content: "# Ledger Review\n",
      },
    ]);

    expect(hashes.get("finance-audit-xls")).toBe(
      computeCatalogSkillSha([
        { relativePath: "SKILL.md", content: "# Finance Audit XLS\n" },
        { relativePath: "WIRING.md", content: "## Wiring\n" },
      ]),
    );
    expect(hashes.get("ledger-review")).toBe(
      computeCatalogSkillSha([
        { relativePath: "SKILL.md", content: "# Ledger Review\n" },
      ]),
    );
  });
});
