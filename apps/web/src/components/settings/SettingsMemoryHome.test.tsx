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
const memoryOntologyRoute = read(
  "src/routes/_authed/settings.memory.ontology.tsx",
);

describe("SettingsMemoryHome", () => {
  it("owns a single stable Knowledge breadcrumb (U9 umbrella naming)", () => {
    expect(source).toContain('title: "Knowledge"');
    expect(source).toContain('breadcrumbs: [{ label: "Knowledge" }]');
  });

  it("publishes the Knowledge tabs into the page header", () => {
    expect(source).toContain("tabs: [");
    expect(source).toContain('{ to: MEMORY, label: "Memory" }');
    // THINK-327 U8: Explorer replaced the wiki "Pages" tab in its slot.
    expect(source).toContain('{ to: EXPLORER, label: "Digital Twin" }');
    expect(source).not.toContain('label: "Pages"');
    expect(source).toContain('{ to: KNOWLEDGE_BASES, label: "KBs" }');
    expect(source).toContain('{ to: ONTOLOGY, label: "Ontology" }');
    expect(source).not.toContain('{ to: ONTOLOGY, label: "Model" }');
    expect(source).not.toContain('label: "Knowledge Model"');
    expect(source).not.toContain('label: "Graph"');
  });

  it("keeps the Memory refresh control visually interactive", () => {
    expect(source).toContain("hover:text-primary");
    expect(source).toContain("bg-primary/10 text-primary");
    expect(source).toContain('"animate-spin"');
    expect(source).toContain("setRefreshPending(true)");
  });

  it("hosts the Living Map actions in the page header on the Ontology tab", () => {
    // Icon-only ghost buttons with hover tooltips — the Agents page header
    // TooltipIconButton pattern — driven by the controller the map
    // publishes (SettingsMemory refresh-controller pattern).
    expect(source).toContain("OntologyMapHeaderController");
    expect(source).toContain("onMapHeaderControllerChange");
    expect(source).toContain('label="Add triple"');
    expect(source).toContain('label="Review queue"');
    expect(source).toContain("ontologyMapController.openAddTriple()");
    expect(source).toContain("ontologyMapController.openQueue()");
    expect(source).toMatch(/activeTab === "ontology" && ontologyMapController/);
    // The queue icon keeps its pending-count badge and accessible name.
    expect(source).toContain("ontologyMapController.pendingCount > 0");
    expect(source).toContain(
      "`Review queue (${ontologyMapController.pendingCount} pending)`",
    );
    // Icon-only: no labeled pill buttons in the header actions.
    expect(source).not.toContain(">Add triple</Button>");
  });

  it("hosts the KBs new-source action in the page header on the KBs tab", () => {
    // Plus TooltipIconButton with a hover tooltip, driven by the controller
    // the KBs tab publishes — the Ontology header-action pattern.
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
    expect(source).toContain("<KnowledgeModelTab");
    expect(source).toContain("<TwinExplorer");
    // No in-body tab strip — the tabs live in the header now.
    expect(source).not.toContain("TabsList");
  });

  it("keeps the Ontology tab on the ontology route", () => {
    expect(source).toContain('{ to: ONTOLOGY, label: "Ontology" }');
    expect(source).toContain('activeTab === "ontology"');
    expect(source).not.toContain("ontologyEnabled");
    expect(source).not.toContain("SettingsPluginCatalogQuery");
    expect(source).not.toContain("SettingsDeploymentStatusQuery");
  });

  it("mounts the combined page across the Memory sub-routes", () => {
    expect(memoryRoute).toContain("SettingsMemoryHome");
    expect(memoryKbRoute).toContain("SettingsMemoryHome");
    expect(memoryOntologyRoute).toContain("SettingsMemoryHome");
    expect(memoryKgRoute).toContain(
      'redirect({ to: "/settings/memory/ontology", replace: true })',
    );
  });

  it("redirects retired memory routes into the matching tab", () => {
    expect(kbRoute).toContain(
      'redirect({ to: "/settings/memory/knowledge-bases" })',
    );
    expect(kgRoute).toContain(
      'redirect({ to: "/settings/memory/ontology", replace: true })',
    );
  });
});
