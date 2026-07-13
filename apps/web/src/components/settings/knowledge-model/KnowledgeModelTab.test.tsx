import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const tabSource = read(
  "src/components/settings/knowledge-model/KnowledgeModelTab.tsx",
);
const definitionsSource = read(
  "src/components/settings/knowledge-graph/KnowledgeGraphTab.tsx",
);
const identitySource = read(
  "src/components/settings/knowledge-model/IdentityList.tsx",
);
const queueSource = read(
  "src/components/settings/knowledge-model/ResolutionQueue.tsx",
);

describe("KnowledgeModelTab", () => {
  it("owns a single title row with the toggle group in the badge slot", () => {
    expect(tabSource).toContain("SettingsPageTitle");
    expect(tabSource).toContain("badge={");
    expect(tabSource).toContain("<ToggleGroup");
    expect(tabSource).toContain('aria-label="Model view"');
    expect(tabSource).not.toContain('aria-label="Knowledge model view"');
  });

  it("swaps title and description from the per-view map", () => {
    expect(tabSource).toContain("VIEW_TITLES");
    expect(tabSource).toContain('title: "Definitions"');
    expect(tabSource).toContain('title: "Identity"');
    expect(tabSource).toContain('title: "Resolution Queue"');
  });

  it("titles the Definitions view without ontology jargon", () => {
    expect(tabSource).toContain(
      "Inspect approved terms and relationship definitions.",
    );
    expect(tabSource).not.toContain('title: "Ontology"');
    expect(tabSource).not.toContain("approved ontology terms");
  });

  it("keeps the toggle position stable while titles swap", () => {
    expect(tabSource).toContain("min-w-52");
    expect(tabSource).toContain("titleClassName");
  });

  it("renders the sub-views as content only", () => {
    for (const source of [definitionsSource, identitySource, queueSource]) {
      expect(source).not.toContain("SettingsPageTitle");
    }
  });
});
