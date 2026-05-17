import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readSource(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("ontology studio route", () => {
  const routeSource = readSource("./ontology.tsx");
  const sidebarSource = readSource("../../../components/Sidebar.tsx");
  const queriesSource = readSource("../../../lib/graphql-queries.ts");

  it("registers Ontology Studio under the Manage navigation group", () => {
    expect(sidebarSource).toContain('label: "Ontology"');
    expect(sidebarSource).toContain('to: "/ontology"');
    expect(routeSource).toContain(
      'createFileRoute("/_authed/_tenant/ontology")',
    );
  });

  it("exposes the practical studio surfaces", () => {
    expect(routeSource).toContain("Change Sets");
    expect(routeSource).toContain("Entities");
    expect(routeSource).toContain("Relationships");
    expect(routeSource).toContain("Mappings");
    expect(routeSource).toContain("Reprocess Jobs");
  });

  it("uses tables for approved entity and relationship definitions", () => {
    expect(routeSource).toContain("const entityColumns");
    expect(routeSource).toContain("const relationshipColumns");
    expect(routeSource).toContain("<DataTable");
    expect(routeSource).toContain("allowHorizontalScroll={false}");
    expect(routeSource).toContain("onRowClick={onSelectEntity}");
    expect(routeSource).toContain("onRowClick={onSelectRelationship}");
    expect(routeSource).not.toContain('header: "Description"');
    expect(routeSource).not.toContain('header: "Aliases"');
  });

  it("keeps definition detail in editable side sheets", () => {
    expect(routeSource).toContain("<SheetContent");
    expect(routeSource).toContain("function OntologyEntitySheet");
    expect(routeSource).toContain("function OntologyRelationshipSheet");
    expect(routeSource).toContain("saveEntityDefinition");
    expect(routeSource).toContain("saveRelationshipDefinition");
  });

  it("wires the ontology GraphQL operations used by the page", () => {
    expect(queriesSource).toContain("query OntologyDefinitions");
    expect(queriesSource).toContain("query OntologyChangeSets");
    expect(queriesSource).toContain("mutation StartOntologySuggestionScan");
    expect(queriesSource).toContain("mutation UpdateOntologyChangeSet");
    expect(queriesSource).toContain("mutation UpdateOntologyEntityType");
    expect(queriesSource).toContain("mutation UpdateOntologyRelationshipType");
    expect(queriesSource).toContain("mutation ApproveOntologyChangeSet");
    expect(queriesSource).toContain("mutation RejectOntologyChangeSet");
    expect(queriesSource).toContain("query OntologyReprocessJob");
  });

  it("persists reviewer edits before approving a change set", () => {
    expect(routeSource).toContain("buildChangeSetUpdateInput");
    expect(routeSource).toContain("Save before approval failed");
  });
});
