import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const explorerSource = readFileSync(
  resolve(
    process.cwd(),
    "src/components/settings/knowledge-graph/KnowledgeGraphExplorer.tsx",
  ),
  "utf8",
);
const settingsSource = readFileSync(
  resolve(
    process.cwd(),
    "src/components/settings/knowledge-graph/KnowledgeGraphTab.tsx",
  ),
  "utf8",
);
const sheetSource = readFileSync(
  resolve(
    process.cwd(),
    "src/components/settings/knowledge-graph/KnowledgeGraphEntitySheet.tsx",
  ),
  "utf8",
);

describe("KnowledgeGraphExplorer", () => {
  it("wires the typed Knowledge Graph read operations", () => {
    expect(explorerSource).toContain("SettingsKnowledgeGraphEntitiesQuery");
    expect(explorerSource).toContain("SettingsKnowledgeGraphOntologyQuery");
  });

  it("retires the thread-ingest trigger and candidate picker", () => {
    expect(explorerSource).not.toContain("ThreadCandidate");
    expect(explorerSource).not.toContain("startKnowledgeGraphThreadIngest");
    expect(explorerSource).not.toContain("KnowledgeGraphIngestControls");
    expect(explorerSource).not.toContain("ThreadIngestDetailView");
    expect(explorerSource).not.toContain("Ingest thread");
  });

  it("keeps the main table and graph on tenant-wide ontology filters", () => {
    expect(explorerSource).toContain("threadId: null");
    expect(explorerSource).toContain("runId: null");
    expect(explorerSource).toContain("activeSearch");
    expect(explorerSource).toContain("ontologyType");
    expect(explorerSource).toContain("groundingStatus");
    expect(explorerSource).toContain("provenanceStatus");
    expect(explorerSource).toContain('value="table"');
    expect(explorerSource).toContain('value="graph"');
    expect(explorerSource).toContain("KnowledgeGraph");
    expect(explorerSource).toContain("DataTable");
  });

  it("gives definitions a searchable DataTable matching the data toolbar", () => {
    // Definitions renders a DataTable, not stacked multi-line rows.
    expect(explorerSource).toContain("OntologyDefinitionsTable");
    expect(explorerSource).not.toContain("OntologyContractPanel");
    expect(explorerSource).not.toContain("OntologyEntityList");
    // The "Ontology Definitions" header label is gone.
    expect(explorerSource).not.toContain("Ontology Definitions");
    // Toggle groups carry no counts.
    expect(explorerSource).not.toMatch(/Entities \(\{/);
    expect(explorerSource).not.toMatch(/Links \(\{/);
    expect(explorerSource).not.toMatch(/Maps \(\{/);
    // Definitions has its own search box.
    expect(explorerSource).toContain("Search definitions...");
    expect(explorerSource).toContain("definitionsQuery");
  });

  it("opens entity details from rows, graph nodes, and neighbor links", () => {
    expect(explorerSource).toContain("onRowClick");
    expect(explorerSource).toContain("onNodeClick");
    expect(explorerSource).toContain("getNodeWithEdges");
    expect(explorerSource).toContain("onNeighborClick={reanchorEntity}");
    expect(sheetSource).toContain("SettingsKnowledgeGraphEntityQuery");
    expect(sheetSource).toContain("Relationships");
    expect(sheetSource).toContain("Evidence");
    expect(sheetSource).toContain("messageId");
  });

  it("mounts Ontology as definitions only", () => {
    expect(settingsSource).toContain("Ontology");
    expect(settingsSource).toContain('mode="definitions"');
    expect(settingsSource).toContain("approved ontology terms");
    expect(settingsSource).not.toContain("Cognee");
    expect(settingsSource).not.toContain("Data");
    expect(settingsSource).not.toContain("Definitions");
  });
});
