import { sql } from "drizzle-orm";
import type { Database } from "../db.js";

export interface OntologyEntityDefinition {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  aliases: string[];
}

export interface OntologyRelationshipDefinition {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  aliases: string[];
  sourceTypeSlugs: string[];
  targetTypeSlugs: string[];
}

export interface KnowledgeGraphOntologyExport {
  mechanism: "custom_prompt";
  entityTypes: OntologyEntityDefinition[];
  relationshipTypes: OntologyRelationshipDefinition[];
  customPrompt: string;
}

export async function loadApprovedOntologyExport(args: {
  db: Database;
  tenantId: string;
}): Promise<KnowledgeGraphOntologyExport> {
  const [entities, relationships] = await Promise.all([
    args.db.execute(sql`
      SELECT id, slug, name, description, aliases
        FROM ontology.entity_types
       WHERE tenant_id = ${args.tenantId}
         AND lifecycle_status = 'approved'
       ORDER BY slug ASC
    `),
    args.db.execute(sql`
      SELECT id, slug, name, description, aliases, source_type_slugs, target_type_slugs
        FROM ontology.relationship_types
       WHERE tenant_id = ${args.tenantId}
         AND lifecycle_status = 'approved'
       ORDER BY slug ASC
    `),
  ]);

  const entityTypes = (
    (entities as unknown as { rows?: OntologyEntityDefinition[] }).rows ?? []
  ).map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    aliases: row.aliases ?? [],
  }));
  const relationshipTypes = (
    (
      relationships as unknown as {
        rows?: Array<
          OntologyRelationshipDefinition & {
            source_type_slugs?: string[] | null;
            target_type_slugs?: string[] | null;
          }
        >;
      }
    ).rows ?? []
  ).map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    aliases: row.aliases ?? [],
    sourceTypeSlugs: row.source_type_slugs ?? [],
    targetTypeSlugs: row.target_type_slugs ?? [],
  }));

  return {
    mechanism: "custom_prompt",
    entityTypes,
    relationshipTypes,
    customPrompt: renderOntologyPrompt(entityTypes, relationshipTypes),
  };
}

export function renderOntologyPrompt(
  entityTypes: OntologyEntityDefinition[],
  relationshipTypes: OntologyRelationshipDefinition[],
): string {
  const entityLines = entityTypes.map((type) =>
    [
      `- ${type.slug}: ${type.name}`,
      type.description ? `  Description: ${type.description}` : "",
      type.aliases.length ? `  Aliases: ${type.aliases.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
  const relationshipLines = relationshipTypes.map((type) =>
    [
      `- ${type.slug}: ${type.name}`,
      type.description ? `  Description: ${type.description}` : "",
      type.sourceTypeSlugs.length
        ? `  Source types: ${type.sourceTypeSlugs.join(", ")}`
        : "",
      type.targetTypeSlugs.length
        ? `  Target types: ${type.targetTypeSlugs.join(", ")}`
        : "",
      type.aliases.length ? `  Aliases: ${type.aliases.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );

  return [
    "Extract a read-only knowledge graph from this ThinkWork thread.",
    "Prefer these approved entity types; keep unknown types visible as diagnostics rather than inventing ontology changes.",
    "Approved entity types:",
    entityLines.length ? entityLines.join("\n") : "- none configured",
    "Approved relationship types:",
    relationshipLines.length
      ? relationshipLines.join("\n")
      : "- none configured",
    "Preserve source message evidence whenever possible.",
  ].join("\n\n");
}

export function normalizeOntologySlug(
  value: string | null | undefined,
): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
