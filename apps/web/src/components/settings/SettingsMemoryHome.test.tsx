import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const source = read("src/components/settings/SettingsMemoryHome.tsx");
const memoryRoute = read("src/routes/_authed/settings.memory.tsx");
const kbRoute = read("src/routes/_authed/settings.knowledge-bases.index.tsx");
const kgRoute = read("src/routes/_authed/settings.knowledge-graph.tsx");
const memoryKbRoute = read(
  "src/routes/_authed/settings.memory.knowledge-bases.tsx",
);
const memoryKgRoute = read(
  "src/routes/_authed/settings.memory.knowledge-graph.tsx",
);

describe("SettingsMemoryHome", () => {
  it("owns a single stable Knowledge breadcrumb (U9 umbrella naming)", () => {
    expect(source).toContain('title: "Knowledge"');
    expect(source).toContain('breadcrumbs: [{ label: "Knowledge" }]');
  });

  it("publishes the Knowledge tabs into the page header", () => {
    expect(source).toContain("tabs: [");
    // THINK-339 U15: the Company Brain and Ontology tabs moved to the
    // standalone console — Memory leads and is the default tab.
    expect(source).not.toContain('label: "Company Brain"');
    expect(source).not.toContain('label: "Ontology"');
    expect(source).toContain('to: RECORDS, label: "Memory"');
    expect(source).toContain('label: "KBs"');
    expect(source.indexOf('to: RECORDS, label: "Memory"')).toBeLessThan(
      source.indexOf('label: "KBs"'),
    );
    // The bare /settings/memory path lands on Memory records.
    expect(source).toContain('return "memory";');
  });

  it("carries no Company Brain link-out (banner removed, Eric 2026-07-25)", () => {
    // The console link-out card shipped with THINK-339 U15 and was removed
    // by request — Knowledge stays purely Memory/KBs.
    expect(source).not.toContain("BrainConsoleCard");
    expect(source).not.toContain("https://brain.thinkwork.ai");
  });

  it("keeps the Memory refresh control visually interactive", () => {
    expect(source).toContain("hover:text-primary");
    expect(source).toContain("bg-primary/10 text-primary");
    expect(source).toContain('"animate-spin"');
    expect(source).toContain("setRefreshPending(true)");
  });

  it("hosts the KBs new-source action in the page header on the KBs tab", () => {
    // Plus TooltipIconButton with a hover tooltip, driven by the controller
    // the KBs tab publishes.
    expect(source).toContain("KnowledgeBasesHeaderController");
    expect(source).toContain("onHeaderControllerChange={updateKbController}");
    expect(source).toContain('label="New source"');
    expect(source).toContain("kbController.openNewSource()");
    expect(source).toMatch(/activeTab === "knowledge-bases" && kbController/);
    // Icon-only: no labeled "+ New source" pill in the header actions.
    expect(source).not.toContain("+ New source");
  });

  it("renders the active facet selected by the current route", () => {
    expect(source).toContain("tabForPath");
    expect(source).toMatch(/<SettingsMemory\s+[\s\S]*?\bembedded\b/);
    expect(source).toMatch(/<SettingsKnowledgeBases\s+[\s\S]*?\bembedded\b/);
    // The twin explorer and ontology tabs are gone (THINK-339 U15).
    expect(source).not.toContain("KnowledgeModelTab");
    expect(source).not.toContain("TwinExplorer");
    // No in-body tab strip — the tabs live in the header now.
    expect(source).not.toContain("TabsList");
  });

  it("mounts the combined page across the Memory sub-routes", () => {
    expect(memoryRoute).toContain("SettingsMemoryHome");
    expect(memoryKbRoute).toContain("SettingsMemoryHome");
  });

  it("redirects retired memory routes into the matching tab", () => {
    expect(kbRoute).toContain(
      'redirect({ to: "/settings/memory/knowledge-bases" })',
    );
    // The retired knowledge-graph/ontology URLs land on Memory records.
    expect(kgRoute).toContain(
      'redirect({ to: "/settings/memory/records", replace: true })',
    );
    expect(memoryKgRoute).toContain(
      'redirect({ to: "/settings/memory/records", replace: true })',
    );
  });
});
