import { listOntologyDefinitions } from "./repository.js";
import {
  resolveOntologyTemplates,
  type OntologyEntityPageTemplate,
  type OntologyFacetSectionTemplate,
} from "./templates.js";
import type {
  BrainSectionSourceKind,
  FacetType,
} from "../brain/facet-types.js";

type OntologyDefinitions = Awaited<ReturnType<typeof listOntologyDefinitions>>;
type DbLike = NonNullable<Parameters<typeof listOntologyDefinitions>[0]["db"]>;

export interface ApprovedOntologyExternalMapping {
  id: string;
  subjectKind: "entity_type" | "relationship_type" | "facet_template" | string;
  subjectId: string;
  mappingKind: string;
  vocabulary: string;
  externalUri: string;
  externalLabel: string | null;
  notes: string | null;
}

export interface ApprovedOntologyEntityType {
  id: string;
  slug: string;
  name: string;
  broadType: string;
  description: string | null;
  aliases: string[];
  guidanceNotes: string | null;
  externalMappings: ApprovedOntologyExternalMapping[];
}

export interface ApprovedOntologyFacetTemplate {
  key: string;
  entityTypeSlug: string;
  slug: string;
  heading: string;
  facetType: FacetType;
  position: number;
  sourcePriority: BrainSectionSourceKind[];
  prompt: string | null;
  guidanceNotes: string | null;
  source: "tenant" | "seed";
}

export interface ApprovedOntologyRelationshipType {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  inverseName: string | null;
  sourceTypeSlugs: string[];
  targetTypeSlugs: string[];
  aliases: string[];
  guidanceNotes: string | null;
  externalMappings: ApprovedOntologyExternalMapping[];
}

export interface OntologyCompileSnapshot {
  tenantId: string;
  activeVersionId: string | null;
  activeVersionNumber: number | null;
  conservative: boolean;
  entityTypeSlugs: Set<string>;
  relationshipTypeSlugs: Set<string>;
  facetTemplateKeys: Set<string>;
  externalMappingKeys: Set<string>;
  entityTypesBySlug: Map<string, ApprovedOntologyEntityType>;
  relationshipTypesBySlug: Map<string, ApprovedOntologyRelationshipType>;
  facetTemplatesByKey: Map<string, ApprovedOntologyFacetTemplate>;
  templatesByEntityType: Record<string, OntologyEntityPageTemplate>;
}

export async function loadOntologyCompileSnapshot(args: {
  tenantId: string;
  db?: DbLike;
}): Promise<OntologyCompileSnapshot> {
  const [definitions, templates] = await Promise.all([
    listOntologyDefinitions({ tenantId: args.tenantId, db: args.db }),
    resolveOntologyTemplates({ tenantId: args.tenantId, db: args.db }),
  ]);

  return buildOntologyCompileSnapshot({ definitions, templates });
}

export function buildOntologyCompileSnapshot(args: {
  definitions: OntologyDefinitions;
  templates: Record<string, OntologyEntityPageTemplate>;
}): OntologyCompileSnapshot {
  const activeVersion = isActiveVersion(args.definitions.activeVersion)
    ? args.definitions.activeVersion
    : null;
  const conservative = !activeVersion;

  if (conservative) {
    return emptyOntologyCompileSnapshot(args.definitions.tenantId);
  }

  const entityTypes = args.definitions.entityTypes
    .filter((entity: any) => isApproved(entity.lifecycleStatus))
    .map(toApprovedEntityType);
  const entityTypesBySlug = new Map(
    entityTypes.map((entity) => [entity.slug, entity]),
  );
  const entityTypeSlugs = new Set(entityTypesBySlug.keys());

  const templatesByEntityType = Object.fromEntries(
    Object.entries(args.templates).filter(([slug]) =>
      entityTypeSlugs.has(slug),
    ),
  );

  const facetTemplates = Object.values(templatesByEntityType).flatMap(
    (template) =>
      template.sections
        .filter((section) => isApproved(section.lifecycleStatus))
        .map((section) => toApprovedFacetTemplate(template, section)),
  );
  const facetTemplatesByKey = new Map(
    facetTemplates.map((template) => [template.key, template]),
  );

  const relationshipTypes = args.definitions.relationshipTypes
    .filter((relationship: any) => isApproved(relationship.lifecycleStatus))
    .map(toApprovedRelationshipType)
    .filter(
      (relationship) =>
        slugsAreKnown(relationship.sourceTypeSlugs, entityTypeSlugs) &&
        slugsAreKnown(relationship.targetTypeSlugs, entityTypeSlugs),
    );
  const relationshipTypesBySlug = new Map(
    relationshipTypes.map((relationship) => [relationship.slug, relationship]),
  );

  const externalMappingKeys = new Set(
    args.definitions.externalMappings.map(toExternalMappingKey),
  );

  return {
    tenantId: args.definitions.tenantId,
    activeVersionId: activeVersion.id,
    activeVersionNumber: numberOrNull(activeVersion.versionNumber),
    conservative: false,
    entityTypeSlugs,
    relationshipTypeSlugs: new Set(relationshipTypesBySlug.keys()),
    facetTemplateKeys: new Set(facetTemplatesByKey.keys()),
    externalMappingKeys,
    entityTypesBySlug,
    relationshipTypesBySlug,
    facetTemplatesByKey,
    templatesByEntityType,
  };
}

export function facetTemplateKey(args: {
  entityTypeSlug: string;
  facetSlug: string;
}): string {
  return `${args.entityTypeSlug}:${args.facetSlug}`;
}

export function relationshipAllowsEndpoints(
  relationship: ApprovedOntologyRelationshipType,
  args: { sourceTypeSlug: string; targetTypeSlug: string },
): boolean {
  return (
    slugAllowed(relationship.sourceTypeSlugs, args.sourceTypeSlug) &&
    slugAllowed(relationship.targetTypeSlugs, args.targetTypeSlug)
  );
}

function emptyOntologyCompileSnapshot(
  tenantId: string,
): OntologyCompileSnapshot {
  return {
    tenantId,
    activeVersionId: null,
    activeVersionNumber: null,
    conservative: true,
    entityTypeSlugs: new Set(),
    relationshipTypeSlugs: new Set(),
    facetTemplateKeys: new Set(),
    externalMappingKeys: new Set(),
    entityTypesBySlug: new Map(),
    relationshipTypesBySlug: new Map(),
    facetTemplatesByKey: new Map(),
    templatesByEntityType: {},
  };
}

function toApprovedEntityType(entity: any): ApprovedOntologyEntityType {
  return {
    id: String(entity.id),
    slug: String(entity.slug),
    name: String(entity.name),
    broadType: entity.broadType ?? "entity",
    description: entity.description ?? null,
    aliases: stringArray(entity.aliases),
    guidanceNotes: entity.guidanceNotes ?? null,
    externalMappings: (entity.externalMappings ?? []).map(toExternalMapping),
  };
}

function toApprovedRelationshipType(
  relationship: any,
): ApprovedOntologyRelationshipType {
  return {
    id: String(relationship.id),
    slug: String(relationship.slug),
    name: String(relationship.name),
    description: relationship.description ?? null,
    inverseName: relationship.inverseName ?? null,
    sourceTypeSlugs: stringArray(relationship.sourceTypeSlugs),
    targetTypeSlugs: stringArray(relationship.targetTypeSlugs),
    aliases: stringArray(relationship.aliases),
    guidanceNotes: relationship.guidanceNotes ?? null,
    externalMappings: (relationship.externalMappings ?? []).map(
      toExternalMapping,
    ),
  };
}

function toApprovedFacetTemplate(
  entityTemplate: OntologyEntityPageTemplate,
  section: OntologyFacetSectionTemplate,
): ApprovedOntologyFacetTemplate {
  return {
    key: facetTemplateKey({
      entityTypeSlug: entityTemplate.entityTypeSlug,
      facetSlug: section.slug,
    }),
    entityTypeSlug: entityTemplate.entityTypeSlug,
    slug: section.slug,
    heading: section.heading,
    facetType: section.facetType,
    position: section.position,
    sourcePriority: section.sourcePriority,
    prompt: section.prompt,
    guidanceNotes: section.guidanceNotes,
    source: section.source,
  };
}

function toExternalMapping(mapping: any): ApprovedOntologyExternalMapping {
  return {
    id: String(mapping.id),
    subjectKind: mapping.subjectKind,
    subjectId: String(mapping.subjectId),
    mappingKind: String(mapping.mappingKind),
    vocabulary: String(mapping.vocabulary),
    externalUri: String(mapping.externalUri),
    externalLabel: mapping.externalLabel ?? null,
    notes: mapping.notes ?? null,
  };
}

function toExternalMappingKey(mapping: any): string {
  return `${mapping.subjectKind}:${mapping.subjectId}:${mapping.vocabulary}:${mapping.externalUri}`;
}

function isActiveVersion(version: any): version is {
  id: string;
  versionNumber: number;
  status: string;
} {
  return (
    Boolean(version?.id) && String(version.status).toLowerCase() === "active"
  );
}

function isApproved(value: unknown): boolean {
  return String(value ?? "").toLowerCase() === "approved";
}

function numberOrNull(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function slugsAreKnown(slugs: string[], known: Set<string>): boolean {
  return slugs.length === 0 || slugs.every((slug) => known.has(slug));
}

function slugAllowed(allowedSlugs: string[], slug: string): boolean {
  return allowedSlugs.length === 0 || allowedSlugs.includes(slug);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
