import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const source = read("src/components/settings/SettingsMemoryHome.tsx");
const memoryRoute = read("src/routes/_authed/settings.memory.tsx");
const wikiRoute = read("src/routes/_authed/settings.wiki.tsx");
const kbRoute = read("src/routes/_authed/settings.knowledge-bases.index.tsx");
const kgRoute = read("src/routes/_authed/settings.knowledge-graph.tsx");

describe("SettingsMemoryHome", () => {
  it("owns a single stable Memory breadcrumb", () => {
    expect(source).toContain('title: "Memory"');
    expect(source).toContain('breadcrumbs: [{ label: "Memory" }]');
  });

  it("renders Memory, Knowledge Bases, and Wiki as embedded tabs", () => {
    expect(source).toContain('value="memory"');
    expect(source).toContain('value="knowledge-bases"');
    expect(source).toContain('value="wiki"');
    expect(source).toContain("<SettingsMemory embedded");
    expect(source).toContain("<SettingsKnowledgeBases embedded");
    expect(source).toContain("<SettingsWiki embedded");
  });

  it("adds a Knowledge Graph tab gated on Cognee being enabled", () => {
    expect(source).toContain('value="knowledge-graph"');
    expect(source).toContain("<KnowledgeGraphTab");
    expect(source).toContain("cogneeEnabled");
  });

  it("mounts the combined page at /settings/memory", () => {
    expect(memoryRoute).toContain("SettingsMemoryHome");
  });

  it("redirects retired memory routes into the combined page", () => {
    expect(wikiRoute).toContain('redirect({ to: "/settings/memory" })');
    expect(kbRoute).toContain('redirect({ to: "/settings/memory" })');
    expect(kgRoute).toContain('redirect({ to: "/settings/memory" })');
  });
});
