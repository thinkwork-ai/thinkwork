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
const ingestSource = readFileSync(
  resolve(
    process.cwd(),
    "src/components/settings/knowledge-graph/KnowledgeGraphIngestControls.tsx",
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
  it("wires the typed Knowledge Graph read and ingest operations", () => {
    expect(explorerSource).toContain(
      "SettingsKnowledgeGraphThreadCandidatesQuery",
    );
    expect(explorerSource).toContain("SettingsKnowledgeGraphEntitiesQuery");
    expect(explorerSource).toContain(
      "SettingsStartKnowledgeGraphThreadIngestMutation",
    );
    expect(explorerSource).toContain("startIngest");
    expect(explorerSource).toContain("graphRef.current?.refetch()");
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

  it("exposes thread search, selection, and manual ingest controls", () => {
    expect(settingsSource).toContain("IconMessages");
    expect(settingsSource).toContain("Open thread ingest");
    expect(explorerSource).toContain("threadSheetOpen");
    expect(explorerSource).toContain("Thread Ingest");
    expect(explorerSource).toContain("Thread Detail");
    expect(explorerSource).toContain("ThreadIngestDetailView");
    expect(explorerSource).toContain("Ingest thread");
    expect(explorerSource).toContain("Ontology gate diagnostics");
    expect(explorerSource).toContain("droppedNodeSamples");
    expect(explorerSource).toContain("droppedEdgeSamples");
    expect(explorerSource).toContain("runId={run.id}");
    expect(explorerSource).toContain("run.metrics");
    expect(ingestSource).toContain("Search threads");
    expect(ingestSource).toContain("DataTable");
    expect(ingestSource).toContain("pageSize={0}");
    expect(ingestSource).toContain("hideHeader");
    expect(ingestSource).toContain("CheckCircle2");
    expect(ingestSource).toContain("XCircle");
    expect(ingestSource).toContain("Clock3");
    expect(ingestSource).toContain("Status");
    expect(ingestSource).toContain("onSelectThread");
    expect(ingestSource).toContain("lastIngestRun");
    expect(ingestSource).not.toContain("onIngestThread");
    expect(ingestSource).not.toContain("Messages");
  });
});
