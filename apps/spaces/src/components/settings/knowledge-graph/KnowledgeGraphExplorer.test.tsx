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
    expect(explorerSource).toContain("SettingsKnowledgeGraphIngestRunsQuery");
    expect(explorerSource).toContain("SettingsKnowledgeGraphEntitiesQuery");
    expect(explorerSource).toContain(
      "SettingsStartKnowledgeGraphThreadIngestMutation",
    );
    expect(explorerSource).toContain("startIngest");
    expect(explorerSource).toContain("refetchRuns");
    expect(explorerSource).toContain("graphRef.current?.refetch()");
  });

  it("keeps table and graph on the same thread and filter state", () => {
    expect(explorerSource).toContain("selectedThreadId");
    expect(explorerSource).toContain("activeSearch");
    expect(explorerSource).toContain("ontologyType");
    expect(explorerSource).toContain("groundingStatus");
    expect(explorerSource).toContain("provenanceStatus");
    expect(explorerSource).toContain('value="table"');
    expect(explorerSource).toContain('value="graph"');
    expect(explorerSource).toContain("KnowledgeGraph");
    expect(explorerSource).toContain("DataTable");
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
    expect(ingestSource).toContain("Search threads");
    expect(ingestSource).toContain("Ingest now");
    expect(ingestSource).toContain("onSelectThread");
    expect(ingestSource).toContain("lastIngestRun");
  });
});
