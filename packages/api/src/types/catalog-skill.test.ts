import { describe, expect, it } from "vitest";
import {
  isCatalogRef,
  isCatalogSkillManifest,
  isWiringSuggestion,
  type CatalogRef,
  type CatalogSkillManifest,
  type WiringSuggestion,
} from "./catalog-skill.js";

const validSha = "a".repeat(64);

describe("catalog skill storage contract", () => {
  it("accepts a valid CatalogRef that round-trips through JSON", () => {
    const ref = {
      slug: "finance-audit-xls",
      source_sha256: validSha,
      installed_at: "2026-05-24T16:30:00.000Z",
      wiring_choice: "stage-3-gate",
      snippet: "| stage-3 | finance-audit-xls | Run the skill |\n",
    } satisfies CatalogRef;

    const parsed = JSON.parse(JSON.stringify(ref));

    expect(isCatalogRef(parsed)).toBe(true);
    expect(parsed).toEqual(ref);
  });

  it("rejects a CatalogRef missing wiring_choice", () => {
    const ref = {
      slug: "finance-audit-xls",
      source_sha256: validSha,
      installed_at: "2026-05-24T16:30:00.000Z",
      snippet: "| stage-3 | finance-audit-xls | Run the skill |\n",
    };

    expect(isCatalogRef(ref)).toBe(false);
  });

  it("rejects a CatalogRef with a malformed source_sha256", () => {
    const ref = {
      slug: "finance-audit-xls",
      source_sha256: "not-a-hex-digest",
      installed_at: "2026-05-24T16:30:00.000Z",
      wiring_choice: "stage-3-gate",
      snippet: "| stage-3 | finance-audit-xls | Run the skill |\n",
    };

    expect(isCatalogRef(ref)).toBe(false);
  });

  it("preserves unicode and newlines in snippets through JSON", () => {
    const snippet = "## Context\nUse café totals.\n| équipe | ✓ |\n";
    const ref = {
      slug: "unicode-skill",
      source_sha256: validSha,
      installed_at: "2026-05-24T16:30:00.000Z",
      wiring_choice: "always-on",
      snippet,
    } satisfies CatalogRef;

    const parsed = JSON.parse(JSON.stringify(ref));

    expect(isCatalogRef(parsed)).toBe(true);
    expect(parsed.snippet).toBe(snippet);
  });

  it("accepts valid wiring suggestions and manifests", () => {
    const suggestion = {
      id: "always-on",
      title: "Always-on",
      description: "Load this skill for every run.",
      snippet: "| always | skill | Use it |\n",
    } satisfies WiringSuggestion;
    const manifest = {
      slug: "finance-audit-xls",
      sha256: validSha,
      has_skill_md: true,
      has_wiring_md: true,
      suggestions: [suggestion],
    } satisfies CatalogSkillManifest;

    expect(isWiringSuggestion(suggestion)).toBe(true);
    expect(isCatalogSkillManifest(manifest)).toBe(true);
  });

  it("rejects malformed wiring suggestions inside manifests", () => {
    expect(
      isCatalogSkillManifest({
        slug: "finance-audit-xls",
        sha256: validSha,
        has_skill_md: true,
        has_wiring_md: true,
        suggestions: [
          { id: "bad id", title: "Bad", description: "", snippet: "" },
        ],
      }),
    ).toBe(false);
  });
});
