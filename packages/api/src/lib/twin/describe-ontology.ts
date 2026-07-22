/**
 * Agent-facing ontology description for the Digital Twin MCP server
 * (THINK-333 KTD-5).
 *
 * Renders the compiled twin-mapping export (`twin-mapping/v1` — the same
 * contract the ETL projection consumes) as a compact text document a model
 * with NO prior knowledge of the tenant can read and then compose correct
 * openCypher against Neptune. The export doesn't state the Neptune
 * addressing contract, so this adds it: node label = entity type slug,
 * facet property naming (`f_<facet>__<attribute>`), per-facet freshness
 * stamps, edge type slugs, opaque canonical ids, and worked examples —
 * the examples ARE the prompt.
 */
import {
  compileTwinMappingExport,
  type TwinMappingExport,
} from "../ontology/twin-export.js";

export interface DescribeOntologyArgs {
  tenantId: string;
  db?: Parameters<typeof compileTwinMappingExport>[0]["db"];
}

export async function describeTwinOntology(
  args: DescribeOntologyArgs,
): Promise<string> {
  const exported = await compileTwinMappingExport({
    tenantId: args.tenantId,
    ...(args.db ? { db: args.db } : {}),
  });
  return renderTwinOntology(exported);
}

/** Pure renderer — unit-testable against a fixture export. */
export function renderTwinOntology(exported: TwinMappingExport): string {
  const lines: string[] = [];
  lines.push(
    `# Digital Twin ontology (version ${exported.ontologyVersion})`,
    "",
    "Query this graph with the `twin_cypher` tool (openCypher, read-only).",
    "",
    "## Addressing contract",
    "",
    "- Node label = the entity type slug below (e.g. `MATCH (c:customer)`).",
    "- Facet attributes are node properties named `f_<facet>__<attribute>`" +
      " (e.g. `f_aging__days_past_due`).",
    "- Every facet also has `f_<facet>__state` (synced | pending | limited |" +
      " synced_empty | tombstoned) and `f_<facet>__synced_at` freshness stamps." +
      " Exclude tombstoned facets when correctness matters.",
    "- `displayName` is the human-readable node name.",
    "- Node ids (the `~id` property) are opaque — never construct or guess" +
      " one; discover entities by label + property filters.",
    "- Relationships use the edge type slugs below: `-[:has_invoice]->`.",
    "- The server scopes every query to your tenant and injects a row LIMIT" +
      " (default 100, max 500) — add your own LIMIT for smaller results.",
    "",
    "## Entity types",
    "",
  );

  for (const entity of exported.entities) {
    lines.push(`### ${entity.slug} — ${entity.name}`);
    for (const facet of entity.facets) {
      const attrs = facet.attributes
        .map(
          (attr) =>
            `f_${facet.slug}__${attr.attribute}${
              attr.filterType ? ` (${attr.filterType})` : ""
            }`,
        )
        .join(", ");
      lines.push(
        `- facet \`${facet.slug}\` (source: ${facet.sourceSystem})` +
          (attrs ? `: ${attrs}` : ""),
      );
    }
    lines.push("");
  }

  lines.push("## Relationship types", "");
  for (const rel of exported.relationships) {
    lines.push(
      `- \`${rel.slug}\` (${rel.name}): ` +
        `${rel.sourceTypeSlugs.join("|") || "?"} -> ${
          rel.targetTypeSlugs.join("|") || "?"
        }`,
    );
  }

  lines.push(
    "",
    "## Worked examples",
    "",
    "Customers with overdue invoices:",
    "```",
    "MATCH (c:customer)-[:has_invoice]->(i:invoice)",
    "WHERE i.f_aging__days_past_due > 60",
    "RETURN DISTINCT c.displayName, c.`~id` LIMIT 50",
    "```",
    "",
    "Cross-system chain (filter on one type, traverse to another):",
    "```",
    "MATCH (c:customer)-[:has_invoice]->(i:invoice)",
    "WHERE i.f_aging__days_past_due > 60",
    "MATCH (c)-[:ships_to]->(:site)-[:has_tank]->(:tank)-[:monitored_by]->(m:tank_monitor)",
    "RETURN DISTINCT c.displayName, count(m) AS monitors",
    "```",
    "",
    "Aggregate over a neighborhood:",
    "```",
    "MATCH (c:customer)",
    "WHERE EXISTS { MATCH (c)-[:owns]->(:tank) }",
    "RETURN c.displayName, COUNT { (c)-[:has_invoice]->(:invoice) } AS invoices",
    "ORDER BY invoices DESC LIMIT 20",
    "```",
    "",
    "Adapt label/relationship/property names to THIS tenant's ontology above" +
      " — the examples show shape, not guaranteed slugs.",
  );

  return lines.join("\n");
}
