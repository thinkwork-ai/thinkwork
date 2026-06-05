import type {
  CogneeGraphEdge,
  CogneeGraphNode,
  CogneeGraphPayload,
} from "./cognee-client.js";
import {
  normalizeOntologySlug,
  type KnowledgeGraphOntologyExport,
  type OntologyEntityDefinition,
  type OntologyRelationshipDefinition,
} from "./ontology-export.js";
import type { ThreadTranscriptMessage } from "./thread-transcript.js";

export interface NormalizedKnowledgeGraphEntity {
  tempId: string;
  cogneeNodeId: string;
  label: string;
  normalizedLabel: string;
  typeLabel: string | null;
  ontologyEntityTypeId: string | null;
  ontologyTypeSlug: string | null;
  groundingStatus: "grounded" | "unapproved_type" | "unknown";
  provenanceStatus: "strong" | "missing";
  summary: string | null;
  aliases: string[];
  properties: Record<string, unknown>;
  diagnostics: Record<string, unknown>;
  lastSeenAt: Date | null;
}

export interface NormalizedKnowledgeGraphRelationship {
  tempId: string;
  cogneeEdgeId: string | null;
  sourceTempId: string;
  targetTempId: string;
  label: string;
  ontologyRelationshipTypeId: string | null;
  ontologyTypeSlug: string | null;
  groundingStatus: "grounded" | "unapproved_type" | "unknown";
  provenanceStatus: "strong" | "missing";
  confidence: number | null;
  properties: Record<string, unknown>;
  diagnostics: Record<string, unknown>;
  lastSeenAt: Date | null;
}

export interface NormalizedKnowledgeGraphEvidence {
  entityTempId?: string;
  relationshipTempId?: string;
  messageId: string | null;
  messageRole: string | null;
  messageCreatedAt: Date | null;
  speakerLabel: string | null;
  snippet: string;
  charStart: number | null;
  charEnd: number | null;
  sourceKind:
    | "thread_message"
    | "wiki_page"
    | "wiki_section"
    | "brain_page"
    | "brain_section"
    | "cognee_payload"
    | "normalizer";
  sourceRef: string | null;
  metadata: Record<string, unknown>;
  observedAt: Date | null;
}

export interface NormalizedKnowledgeGraphSnapshot {
  entities: NormalizedKnowledgeGraphEntity[];
  relationships: NormalizedKnowledgeGraphRelationship[];
  evidence: NormalizedKnowledgeGraphEvidence[];
  metrics: {
    cogneeNodeCount: number;
    cogneeEdgeCount: number;
    droppedNodeCount: number;
    droppedEdgeCount: number;
    structuralNodeCount: number;
    unapprovedNodeCount: number;
    isolatedNodeCount: number;
    unapprovedRelationshipCount: number;
    incompatibleRelationshipCount: number;
    orphanRelationshipCount: number;
    droppedNodeSamples: DroppedNodeSample[];
    droppedEdgeSamples: DroppedEdgeSample[];
  };
}

export interface DroppedNodeSample {
  id: string;
  label: string;
  rawType: string | null;
  dropReason: "structural_node" | "unapproved_entity_type";
  propertyKeys: string[];
}

export interface DroppedEdgeSample {
  id: string | null;
  label: string;
  rawType: string | null;
  sourceId: string;
  sourceLabel: string | null;
  targetId: string;
  targetLabel: string | null;
  dropReason:
    | "orphan_endpoint"
    | "unapproved_relationship_type"
    | "incompatible_endpoint";
  propertyKeys: string[];
}

const MAX_DROP_SAMPLES = 12;

export function normalizeCogneeGraph(args: {
  graph: CogneeGraphPayload;
  transcript: ThreadTranscriptMessage[];
  ontology: KnowledgeGraphOntologyExport;
}): NormalizedKnowledgeGraphSnapshot {
  const entityTypes = buildEntityTypeIndex(args.ontology.entityTypes);
  const relationshipTypes = buildRelationshipTypeIndex(
    args.ontology.relationshipTypes,
  );
  const rawNodeById = new Map(
    args.graph.nodes.map((node) => [node.id, node] as const),
  );
  const entityEvidence = new Map<string, NormalizedKnowledgeGraphEvidence>();
  const entities: NormalizedKnowledgeGraphEntity[] = [];
  const entityByTempId = new Map<string, NormalizedKnowledgeGraphEntity>();
  const droppedNodeSamples: DroppedNodeSample[] = [];
  let structuralNodeCount = 0;
  let unapprovedNodeCount = 0;
  for (const node of dedupeNodes(args.graph.nodes)) {
    const label = node.label.trim();
    const typeLabel = coerceTypeLabel(node);
    const ontologyType = findEntityType(entityTypes, typeLabel);
    if (!ontologyType) {
      if (isStructuralCogneeNodeType(typeLabel)) {
        structuralNodeCount += 1;
        addDroppedNodeSample(droppedNodeSamples, node, {
          rawType: typeLabel,
          dropReason: "structural_node",
        });
      } else {
        unapprovedNodeCount += 1;
        addDroppedNodeSample(droppedNodeSamples, node, {
          rawType: typeLabel,
          dropReason: "unapproved_entity_type",
        });
      }
      continue;
    }
    const evidence = findEvidence(args.transcript, [label, typeLabel ?? ""]);
    const provenanceStatus = evidence ? "strong" : "missing";
    const tempId = node.id;
    if (evidence) {
      entityEvidence.set(tempId, {
        entityTempId: tempId,
        messageId: messageIdForEvidence(evidence.message),
        messageRole: evidence.message.role,
        messageCreatedAt: evidence.message.createdAt,
        speakerLabel: evidence.message.speakerLabel,
        snippet: evidence.snippet,
        charStart: evidence.charStart,
        charEnd: evidence.charEnd,
        sourceKind: evidenceSourceKind(evidence.message),
        sourceRef: evidenceSourceRef(evidence.message),
        metadata: {
          ...evidence.message.evidenceMetadata,
          match: evidence.match,
        },
        observedAt: evidence.message.createdAt,
      });
    }
    const entity = {
      tempId,
      cogneeNodeId: node.id,
      label,
      normalizedLabel: normalizeLabel(label),
      typeLabel,
      ontologyEntityTypeId: ontologyType.id,
      ontologyTypeSlug: ontologyType.slug,
      groundingStatus: "grounded",
      provenanceStatus,
      summary:
        typeof node.properties?.summary === "string"
          ? node.properties.summary
          : null,
      aliases: readStringArray(node.properties?.aliases),
      properties: node.properties ?? {},
      diagnostics: {},
      lastSeenAt: evidence?.message.createdAt ?? null,
    } satisfies NormalizedKnowledgeGraphEntity;
    entities.push(entity);
    entityByTempId.set(entity.tempId, entity);
  }

  const relationshipEvidence = new Map<
    string,
    NormalizedKnowledgeGraphEvidence
  >();
  let droppedEdgeCount = 0;
  let unapprovedRelationshipCount = 0;
  let incompatibleRelationshipCount = 0;
  let orphanRelationshipCount = 0;
  const relationships: NormalizedKnowledgeGraphRelationship[] = [];
  const droppedEdgeSamples: DroppedEdgeSample[] = [];
  for (const edge of dedupeEdges(args.graph.edges)) {
    const source = entityByTempId.get(edge.source);
    const target = entityByTempId.get(edge.target);
    if (!source || !target) {
      droppedEdgeCount += 1;
      orphanRelationshipCount += 1;
      addDroppedEdgeSample(droppedEdgeSamples, edge, rawNodeById, {
        dropReason: "orphan_endpoint",
      });
      continue;
    }
    const relationshipType = findRelationshipType(
      relationshipTypes,
      edge.type ?? edge.label,
    );
    if (!relationshipType) {
      droppedEdgeCount += 1;
      unapprovedRelationshipCount += 1;
      addDroppedEdgeSample(droppedEdgeSamples, edge, rawNodeById, {
        dropReason: "unapproved_relationship_type",
      });
      continue;
    }
    if (!relationshipEndpointsAllowed(relationshipType, source, target)) {
      droppedEdgeCount += 1;
      incompatibleRelationshipCount += 1;
      addDroppedEdgeSample(droppedEdgeSamples, edge, rawNodeById, {
        dropReason: "incompatible_endpoint",
      });
      continue;
    }
    const evidence = findEvidence(args.transcript, [
      source.label,
      target.label,
      edge.label,
    ]);
    const tempId = edge.id ?? `${edge.source}->${edge.label}->${edge.target}`;
    if (evidence) {
      relationshipEvidence.set(tempId, {
        relationshipTempId: tempId,
        messageId: messageIdForEvidence(evidence.message),
        messageRole: evidence.message.role,
        messageCreatedAt: evidence.message.createdAt,
        speakerLabel: evidence.message.speakerLabel,
        snippet: evidence.snippet,
        charStart: evidence.charStart,
        charEnd: evidence.charEnd,
        sourceKind: evidenceSourceKind(evidence.message),
        sourceRef: evidenceSourceRef(evidence.message),
        metadata: {
          ...evidence.message.evidenceMetadata,
          match: evidence.match,
        },
        observedAt: evidence.message.createdAt,
      });
    }
    relationships.push({
      tempId,
      cogneeEdgeId: edge.id ?? null,
      sourceTempId: edge.source,
      targetTempId: edge.target,
      label: edge.label,
      ontologyRelationshipTypeId: relationshipType.id,
      ontologyTypeSlug: relationshipType.slug,
      groundingStatus: "grounded",
      provenanceStatus: evidence ? "strong" : "missing",
      confidence: readConfidence(edge.properties),
      properties: edge.properties ?? {},
      diagnostics: {},
      lastSeenAt: evidence?.message.createdAt ?? null,
    });
  }
  const connectedEntityIds = new Set<string>();
  for (const relationship of relationships) {
    connectedEntityIds.add(relationship.sourceTempId);
    connectedEntityIds.add(relationship.targetTempId);
  }
  const isolatedNodeCount = entities.filter(
    (entity) => !connectedEntityIds.has(entity.tempId),
  ).length;

  return {
    entities,
    relationships,
    evidence: [
      ...Array.from(entityEvidence.values()),
      ...Array.from(relationshipEvidence.values()),
    ],
    metrics: {
      cogneeNodeCount: args.graph.nodes.length,
      cogneeEdgeCount: args.graph.edges.length,
      droppedNodeCount: structuralNodeCount + unapprovedNodeCount,
      droppedEdgeCount,
      structuralNodeCount,
      unapprovedNodeCount,
      isolatedNodeCount,
      unapprovedRelationshipCount,
      incompatibleRelationshipCount,
      orphanRelationshipCount,
      droppedNodeSamples,
      droppedEdgeSamples,
    },
  };
}

function evidenceSourceKind(
  message: ThreadTranscriptMessage,
): NormalizedKnowledgeGraphEvidence["sourceKind"] {
  return message.evidenceSourceKind ?? "thread_message";
}

function evidenceSourceRef(message: ThreadTranscriptMessage): string {
  return message.evidenceSourceRef ?? message.id;
}

function messageIdForEvidence(message: ThreadTranscriptMessage): string | null {
  return evidenceSourceKind(message) === "thread_message" ? message.id : null;
}

function dedupeNodes(nodes: CogneeGraphNode[]): CogneeGraphNode[] {
  const seen = new Set<string>();
  return nodes.filter((node) => {
    if (seen.has(node.id)) return false;
    seen.add(node.id);
    return true;
  });
}

function dedupeEdges(edges: CogneeGraphEdge[]): CogneeGraphEdge[] {
  const seen = new Set<string>();
  return edges.filter((edge) => {
    const key = edge.id ?? `${edge.source}:${edge.label}:${edge.target}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildEntityTypeIndex(types: OntologyEntityDefinition[]) {
  const index = new Map<string, OntologyEntityDefinition>();
  for (const type of types) {
    for (const key of [type.slug, type.name, ...type.aliases]) {
      index.set(normalizeOntologySlug(key), type);
    }
  }
  return index;
}

function buildRelationshipTypeIndex(types: OntologyRelationshipDefinition[]) {
  const index = new Map<string, OntologyRelationshipDefinition>();
  for (const type of types) {
    for (const key of [type.slug, type.name, ...type.aliases]) {
      index.set(normalizeOntologySlug(key), type);
    }
  }
  return index;
}

function findEntityType(
  index: Map<string, OntologyEntityDefinition>,
  typeLabel: string | null,
) {
  return typeLabel
    ? (index.get(normalizeOntologySlug(typeLabel)) ?? null)
    : null;
}

function findRelationshipType(
  index: Map<string, OntologyRelationshipDefinition>,
  label: string | null | undefined,
) {
  return label ? (index.get(normalizeOntologySlug(label)) ?? null) : null;
}

function coerceTypeLabel(node: CogneeGraphNode): string | null {
  return (
    readNestedTypeLabel(node.properties) ??
    node.type ??
    (typeof node.properties?.type === "string" ? node.properties.type : null)
  );
}

function readNestedTypeLabel(
  properties: Record<string, unknown> | null | undefined,
): string | null {
  if (!properties) return null;
  for (const key of [
    "is_a",
    "isA",
    "ontology_type",
    "ontologyType",
    "entity_type",
    "entityType",
  ]) {
    const value = properties[key];
    if (typeof value === "string") return value;
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const record = value as Record<string, unknown>;
    for (const nestedKey of ["slug", "name", "label", "type"]) {
      if (typeof record[nestedKey] === "string") return record[nestedKey];
    }
  }
  return null;
}

function isStructuralCogneeNodeType(typeLabel: string | null): boolean {
  if (!typeLabel) return false;
  return STRUCTURAL_COGNEE_NODE_TYPES.has(normalizeOntologySlug(typeLabel));
}

const STRUCTURAL_COGNEE_NODE_TYPES = new Set([
  "data",
  "data_point",
  "datapoint",
  "document",
  "document_chunk",
  "documentchunk",
  "node_set",
  "nodeset",
  "text_document",
  "textdocument",
  "text_summary",
  "textsummary",
]);

function relationshipEndpointsAllowed(
  relationshipType: OntologyRelationshipDefinition,
  source: NormalizedKnowledgeGraphEntity,
  target: NormalizedKnowledgeGraphEntity,
): boolean {
  return (
    slugAllowed(relationshipType.sourceTypeSlugs, source.ontologyTypeSlug) &&
    slugAllowed(relationshipType.targetTypeSlugs, target.ontologyTypeSlug)
  );
}

function slugAllowed(allowedSlugs: string[], actualSlug: string | null) {
  if (!allowedSlugs.length) return true;
  if (!actualSlug) return false;
  const normalizedActual = normalizeOntologySlug(actualSlug);
  return allowedSlugs.some(
    (allowedSlug) => normalizeOntologySlug(allowedSlug) === normalizedActual,
  );
}

function findEvidence(
  messages: ThreadTranscriptMessage[],
  terms: string[],
): {
  message: ThreadTranscriptMessage;
  snippet: string;
  charStart: number;
  charEnd: number;
  match: string;
} | null {
  const normalizedTerms = terms
    .map((term) => term.trim())
    .filter((term) => term.length >= 2);
  for (const message of messages) {
    const lower = message.text.toLowerCase();
    const matchedTerm = normalizedTerms.find((term) =>
      lower.includes(term.toLowerCase()),
    );
    if (!matchedTerm) continue;
    const charStart = lower.indexOf(matchedTerm.toLowerCase());
    const charEnd = charStart + matchedTerm.length;
    return {
      message,
      snippet: snippetAround(message.text, charStart, charEnd),
      charStart,
      charEnd,
      match: matchedTerm,
    };
  }
  return null;
}

function snippetAround(text: string, start: number, end: number): string {
  const before = Math.max(0, start - 120);
  const after = Math.min(text.length, end + 120);
  return text.slice(before, after).trim();
}

function normalizeLabel(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function readConfidence(
  properties: Record<string, unknown> | null | undefined,
) {
  const value = properties?.confidence;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function addDroppedNodeSample(
  samples: DroppedNodeSample[],
  node: CogneeGraphNode,
  args: Pick<DroppedNodeSample, "rawType" | "dropReason">,
): void {
  if (samples.length >= MAX_DROP_SAMPLES) return;
  samples.push({
    id: node.id,
    label: node.label.trim() || node.id,
    rawType: args.rawType,
    dropReason: args.dropReason,
    propertyKeys: readPropertyKeys(node.properties),
  });
}

function addDroppedEdgeSample(
  samples: DroppedEdgeSample[],
  edge: CogneeGraphEdge,
  rawNodeById: Map<string, CogneeGraphNode>,
  args: Pick<DroppedEdgeSample, "dropReason">,
): void {
  if (samples.length >= MAX_DROP_SAMPLES) return;
  const source = rawNodeById.get(edge.source);
  const target = rawNodeById.get(edge.target);
  samples.push({
    id: edge.id ?? null,
    label: edge.label,
    rawType: edge.type ?? null,
    sourceId: edge.source,
    sourceLabel: source?.label?.trim() || null,
    targetId: edge.target,
    targetLabel: target?.label?.trim() || null,
    dropReason: args.dropReason,
    propertyKeys: readPropertyKeys(edge.properties),
  });
}

function readPropertyKeys(
  properties: Record<string, unknown> | null | undefined,
): string[] {
  return properties ? Object.keys(properties).sort().slice(0, 12) : [];
}
