const enumValue = (value: string | null | undefined) =>
  value ? value.toUpperCase() : value;

const iso = (value: Date | string | null | undefined) => {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
};

export function toOntologyVersion(row: any) {
  if (!row) return null;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    versionNumber: row.version_number,
    status: row.status,
    sourceChangeSetId: row.source_change_set_id,
    activatedAt: iso(row.activated_at),
    createdAt: iso(row.created_at),
  };
}

export function toOntologyFacetTemplate(row: any) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    entityTypeId: row.entity_type_id,
    slug: row.slug,
    heading: row.heading,
    facetType: row.facet_type,
    position: row.position,
    sourcePriority: row.source_priority ?? [],
    prompt: row.prompt,
    guidanceNotes: row.guidance_notes,
    lifecycleStatus: enumValue(row.lifecycle_status),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export function toOntologyExternalMapping(row: any) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    subjectKind: row.subject_kind,
    subjectId: row.subject_id,
    mappingKind: enumValue(row.mapping_kind),
    vocabulary: row.vocabulary,
    externalUri: row.external_uri,
    externalLabel: row.external_label,
    notes: row.notes,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export function toOntologyEntityType(
  row: any,
  facetTemplates: any[] = [],
  externalMappings: any[] = [],
) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    versionId: row.version_id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    broadType: row.broad_type,
    aliases: row.aliases ?? [],
    propertiesSchema: row.properties_schema ?? {},
    guidanceNotes: row.guidance_notes,
    lifecycleStatus: enumValue(row.lifecycle_status),
    approvedAt: iso(row.approved_at),
    deprecatedAt: iso(row.deprecated_at),
    rejectedAt: iso(row.rejected_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    facetTemplates: facetTemplates.map(toOntologyFacetTemplate),
    externalMappings: externalMappings.map(toOntologyExternalMapping),
  };
}

export function toOntologyRelationshipType(
  row: any,
  externalMappings: any[] = [],
) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    versionId: row.version_id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    inverseName: row.inverse_name,
    sourceEntityTypeId: row.source_entity_type_id,
    targetEntityTypeId: row.target_entity_type_id,
    sourceTypeSlugs: row.source_type_slugs ?? [],
    targetTypeSlugs: row.target_type_slugs ?? [],
    aliases: row.aliases ?? [],
    guidanceNotes: row.guidance_notes,
    lifecycleStatus: enumValue(row.lifecycle_status),
    approvedAt: iso(row.approved_at),
    deprecatedAt: iso(row.deprecated_at),
    rejectedAt: iso(row.rejected_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    externalMappings: externalMappings.map(toOntologyExternalMapping),
  };
}

export function toOntologyEvidenceExample(row: any) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    changeSetId: row.change_set_id,
    itemId: row.item_id,
    sourceKind: row.source_kind,
    sourceRef: row.source_ref,
    sourceLabel: row.source_label,
    quote: row.quote,
    metadata: row.metadata ?? {},
    observedAt: iso(row.observed_at),
    createdAt: iso(row.created_at),
  };
}

export function toOntologyChangeSetItem(
  row: any,
  evidenceExamples: any[] = [],
) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    changeSetId: row.change_set_id,
    itemType: enumValue(row.item_type),
    action: enumValue(row.action),
    status: enumValue(row.status),
    targetKind: row.target_kind,
    targetSlug: row.target_slug,
    title: row.title,
    description: row.description,
    proposedValue: row.proposed_value ?? {},
    editedValue: row.edited_value,
    confidence:
      row.confidence === null || row.confidence === undefined
        ? null
        : Number(row.confidence),
    position: row.position,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    evidenceExamples: evidenceExamples.map(toOntologyEvidenceExample),
  };
}

export function toOntologyChangeSet(
  row: any,
  items: any[] = [],
  evidenceExamples: any[] = [],
) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    title: row.title,
    summary: row.summary,
    status: enumValue(row.status),
    confidence:
      row.confidence === null || row.confidence === undefined
        ? null
        : Number(row.confidence),
    observedFrequency: row.observed_frequency,
    expectedImpact: row.expected_impact ?? {},
    proposedBy: row.proposed_by,
    proposedByUserId: row.proposed_by_user_id,
    approvedByUserId: row.approved_by_user_id,
    approvedAt: iso(row.approved_at),
    rejectedByUserId: row.rejected_by_user_id,
    rejectedAt: iso(row.rejected_at),
    appliedVersionId: row.applied_version_id,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    items: items.map((item) =>
      toOntologyChangeSetItem(
        item,
        evidenceExamples.filter((evidence) => evidence.item_id === item.id),
      ),
    ),
    evidenceExamples: evidenceExamples.map(toOntologyEvidenceExample),
  };
}

export function toOntologySuggestionScanJob(row: any) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    status: enumValue(row.status),
    trigger: row.trigger,
    dedupeKey: row.dedupe_key,
    startedAt: iso(row.started_at),
    finishedAt: iso(row.finished_at),
    error: row.error,
    result: row.result ?? {},
    metrics: row.metrics ?? {},
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export function toOntologyReprocessJob(row: any) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    changeSetId: row.change_set_id,
    ontologyVersionId: row.ontology_version_id,
    dedupeKey: row.dedupe_key,
    status: enumValue(row.status),
    attempt: row.attempt,
    claimedAt: iso(row.claimed_at),
    startedAt: iso(row.started_at),
    finishedAt: iso(row.finished_at),
    input: row.input ?? {},
    impact: row.impact ?? {},
    metrics: row.metrics ?? {},
    error: row.error,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}
