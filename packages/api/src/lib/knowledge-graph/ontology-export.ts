import { createHash } from "node:crypto";
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
  mechanism: "cognee_owl_ontology" | "custom_prompt";
  entityTypes: OntologyEntityDefinition[];
  relationshipTypes: OntologyRelationshipDefinition[];
  customPrompt: string;
  ontologyKey: string | null;
  ontologyOwlXml: string | null;
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

  const ontologyOwlXml = renderOntologyOwl({
    tenantId: args.tenantId,
    entityTypes,
    relationshipTypes,
  });
  const hasApprovedDefinitions =
    entityTypes.length > 0 || relationshipTypes.length > 0;

  return {
    mechanism: hasApprovedDefinitions ? "cognee_owl_ontology" : "custom_prompt",
    entityTypes,
    relationshipTypes,
    customPrompt: renderOntologyPrompt(entityTypes, relationshipTypes),
    ontologyKey: hasApprovedDefinitions
      ? buildCogneeOntologyKey(args.tenantId, ontologyOwlXml)
      : null,
    ontologyOwlXml: hasApprovedDefinitions ? ontologyOwlXml : null,
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
    "Use the attached Cognee ontology as the primary schema constraint when it is present.",
    "Only extract facts whose entity types and relationship types appear in the approved ontology below.",
    "Ignore document chunks, documents, text summaries, node sets, pipeline metadata, and any unknown or unapproved types.",
    "Do not invent new entity types or relationship types.",
    "Approved entity types:",
    entityLines.length ? entityLines.join("\n") : "- none configured",
    "Approved relationship types:",
    relationshipLines.length
      ? relationshipLines.join("\n")
      : "- none configured",
    "Preserve source message evidence whenever possible.",
  ].join("\n\n");
}

export function renderOntologyOwl(args: {
  tenantId: string;
  entityTypes: OntologyEntityDefinition[];
  relationshipTypes: OntologyRelationshipDefinition[];
}): string {
  const baseIri = `https://thinkwork.ai/ontology/${encodeURIComponent(args.tenantId)}/`;
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"',
    '         xmlns:rdfs="http://www.w3.org/2000/01/rdf-schema#"',
    '         xmlns:owl="http://www.w3.org/2002/07/owl#"',
    '         xmlns:skos="http://www.w3.org/2004/02/skos/core#">',
    `  <owl:Ontology rdf:about="${escapeXmlAttribute(baseIri)}">`,
    "    <rdfs:comment>Approved ThinkWork business ontology exported for Cognee thread graph extraction.</rdfs:comment>",
    "  </owl:Ontology>",
  ];

  for (const type of args.entityTypes) {
    lines.push(
      `  <owl:Class rdf:about="${escapeXmlAttribute(`${baseIri}#${iriFragment(type.slug)}`)}">`,
      `    <rdfs:label>${escapeXmlText(type.name)}</rdfs:label>`,
    );
    if (type.description) {
      lines.push(
        `    <rdfs:comment>${escapeXmlText(type.description)}</rdfs:comment>`,
      );
    }
    for (const alias of type.aliases) {
      lines.push(`    <skos:altLabel>${escapeXmlText(alias)}</skos:altLabel>`);
    }
    lines.push("  </owl:Class>");
  }

  for (const type of args.relationshipTypes) {
    const comments = [
      type.description,
      type.sourceTypeSlugs.length
        ? `Allowed source types: ${type.sourceTypeSlugs.join(", ")}`
        : null,
      type.targetTypeSlugs.length
        ? `Allowed target types: ${type.targetTypeSlugs.join(", ")}`
        : null,
    ].filter(Boolean);
    lines.push(
      `  <owl:ObjectProperty rdf:about="${escapeXmlAttribute(`${baseIri}#${iriFragment(type.slug)}`)}">`,
      `    <rdfs:label>${escapeXmlText(type.name)}</rdfs:label>`,
    );
    if (comments.length) {
      lines.push(
        `    <rdfs:comment>${escapeXmlText(comments.join(" "))}</rdfs:comment>`,
      );
    }
    if (type.sourceTypeSlugs.length === 1) {
      lines.push(
        `    <rdfs:domain rdf:resource="${escapeXmlAttribute(`${baseIri}#${iriFragment(type.sourceTypeSlugs[0]!)}`)}"/>`,
      );
    }
    if (type.targetTypeSlugs.length === 1) {
      lines.push(
        `    <rdfs:range rdf:resource="${escapeXmlAttribute(`${baseIri}#${iriFragment(type.targetTypeSlugs[0]!)}`)}"/>`,
      );
    }
    for (const alias of type.aliases) {
      lines.push(`    <skos:altLabel>${escapeXmlText(alias)}</skos:altLabel>`);
    }
    lines.push("  </owl:ObjectProperty>");
  }

  lines.push("</rdf:RDF>", "");
  return lines.join("\n");
}

export function buildCogneeOntologyKey(
  tenantId: string,
  ontologyOwlXml: string,
): string {
  const tenantFragment = tenantId.replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase();
  const hash = createHash("sha256").update(ontologyOwlXml).digest("hex");
  return `thinkwork_${tenantFragment}_${hash.slice(0, 16)}`;
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

function iriFragment(value: string): string {
  return normalizeOntologySlug(value) || "unnamed";
}

function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeXmlAttribute(value: string): string {
  return escapeXmlText(value).replace(/"/g, "&quot;");
}
