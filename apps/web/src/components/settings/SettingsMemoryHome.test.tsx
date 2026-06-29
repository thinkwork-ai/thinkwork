import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const source = read("src/components/settings/SettingsMemoryHome.tsx");
const memoryRoute = read("src/routes/_authed/settings.memory.tsx");
const wikiRoute = read("src/routes/_authed/settings.wiki.tsx");
const kbRoute = read("src/routes/_authed/settings.knowledge-bases.index.tsx");
const kgRoute = read("src/routes/_authed/settings.knowledge-graph.tsx");
const memoryWikiRoute = read("src/routes/_authed/settings.memory.wiki.tsx");
const memoryKbRoute = read(
  "src/routes/_authed/settings.memory.knowledge-bases.tsx",
);
const memoryKgRoute = read(
  "src/routes/_authed/settings.memory.knowledge-graph.tsx",
);

describe("SettingsMemoryHome", () => {
  it("owns a single stable Memory breadcrumb", () => {
    expect(source).toContain('title: "Memory"');
    expect(source).toContain('breadcrumbs: [{ label: "Memory" }]');
  });

  it("publishes the Memory tabs into the page header", () => {
    expect(source).toContain("tabs: [");
    expect(source).toContain('{ to: MEMORY, label: "Memory" }');
    expect(source).toContain('{ to: KNOWLEDGE_BASES, label: "KBs" }');
    expect(source).toContain('{ to: ONTOLOGY, label: "Ontology" }');
    expect(source).not.toContain('label: "Wiki"');
    expect(source).not.toContain('label: "Graph"');
  });

  it("renders the active facet selected by the current route", () => {
    expect(source).toContain("tabForPath");
    expect(source).toMatch(/<SettingsMemory\s+[\s\S]*?\bembedded\b/);
    expect(source).toContain("<SettingsKnowledgeBases embedded");
    expect(source).toContain("<KnowledgeGraphTab");
    expect(source).not.toContain("<SettingsWiki embedded");
    // No in-body tab strip — the tabs live in the header now.
    expect(source).not.toContain("TabsList");
  });

  it("keeps Ontology as definitions-only memory tab without Cognee gating", () => {
    expect(source).toContain('{ to: ONTOLOGY, label: "Ontology" }');
    expect(source).toContain('activeTab === "ontology"');
    expect(source).not.toContain("legacyCogneeEnabled");
    expect(source).not.toContain("ontologyEnabled");
    expect(source).not.toContain("SettingsPluginCatalogQuery");
    expect(source).not.toContain("SettingsDeploymentStatusQuery");
  });

  it("mounts the combined page across the Memory sub-routes", () => {
    expect(memoryRoute).toContain("SettingsMemoryHome");
    expect(memoryWikiRoute).toContain('redirect({ to: "/settings/memory" })');
    expect(memoryKbRoute).toContain("SettingsMemoryHome");
    expect(memoryKgRoute).toContain("SettingsMemoryHome");
  });

  it("redirects retired memory routes into the matching tab", () => {
    expect(wikiRoute).toContain('redirect({ to: "/settings/memory" })');
    expect(kbRoute).toContain(
      'redirect({ to: "/settings/memory/knowledge-bases" })',
    );
    expect(kgRoute).toContain(
      'redirect({ to: "/settings/memory/knowledge-graph" })',
    );
  });
});
