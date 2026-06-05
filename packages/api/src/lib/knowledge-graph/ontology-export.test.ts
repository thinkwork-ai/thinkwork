import { describe, expect, it } from "vitest";
import {
  buildCogneeOntologyKey,
  renderOntologyOwl,
} from "./ontology-export.js";

describe("knowledge graph ontology export", () => {
  it("renders approved ontology definitions as a deterministic Cognee OWL file", () => {
    const owl = renderOntologyOwl({
      tenantId: "tenant-1",
      entityTypes: [
        {
          id: "entity-company",
          slug: "company",
          name: "Company & Partner",
          description: "An approved organization type.",
          aliases: ["Organization"],
        },
      ],
      relationshipTypes: [
        {
          id: "relationship-uses",
          slug: "uses",
          name: "Uses",
          description: "A uses B.",
          aliases: ["depends on"],
          sourceTypeSlugs: ["company"],
          targetTypeSlugs: ["company"],
        },
      ],
    });

    expect(owl).toContain(
      '<owl:Class rdf:about="https://thinkwork.ai/ontology/tenant-1/#company">',
    );
    expect(owl).toContain("<rdfs:label>Company &amp; Partner</rdfs:label>");
    expect(owl).toContain("<skos:altLabel>Organization</skos:altLabel>");
    expect(owl).toContain(
      '<owl:ObjectProperty rdf:about="https://thinkwork.ai/ontology/tenant-1/#uses">',
    );
    expect(owl).toContain(
      '<rdfs:domain rdf:resource="https://thinkwork.ai/ontology/tenant-1/#company"/>',
    );
    expect(owl).toContain(
      '<rdfs:range rdf:resource="https://thinkwork.ai/ontology/tenant-1/#company"/>',
    );

    expect(buildCogneeOntologyKey("tenant-1", owl)).toMatch(
      /^thinkwork_tenant_1_[a-f0-9]{16}$/,
    );
    expect(buildCogneeOntologyKey("tenant-1", owl)).toBe(
      buildCogneeOntologyKey("tenant-1", owl),
    );
  });
});
