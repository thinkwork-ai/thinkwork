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
  sourceKind: "thread_message" | "cognee_payload" | "normalizer";
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
    droppedEdgeCount: number;
  };
}

export function normalizeCogneeGraph(args: {
  graph: CogneeGraphPayload;
  transcript: ThreadTranscriptMessage[];
  ontology: KnowledgeGraphOntologyExport;
}): NormalizedKnowledgeGraphSnapshot {
  const entityTypes = buildEntityTypeIndex(args.ontology.entityTypes);
  const relationshipTypes = buildRelationshipTypeIndex(
    args.ontology.relationshipTypes,
  );
  const entityEvidence = new Map<string, NormalizedKnowledgeGraphEvidence>();
  const entities = dedupeNodes(args.graph.nodes).map((node) => {
    const label = node.label.trim();
    const typeLabel = coerceTypeLabel(node);
    const ontologyType = findEntityType(entityTypes, typeLabel);
    const evidence = findEvidence(args.transcript, [label, typeLabel ?? ""]);
    const provenanceStatus = evidence ? "strong" : "missing";
    const tempId = node.id;
    if (evidence) {
      entityEvidence.set(tempId, {
        entityTempId: tempId,
        messageId: evidence.message.id,
        messageRole: evidence.message.role,
        messageCreatedAt: evidence.message.createdAt,
        speakerLabel: evidence.message.speakerLabel,
        snippet: evidence.snippet,
        charStart: evidence.charStart,
        charEnd: evidence.charEnd,
        sourceKind: "thread_message",
        sourceRef: evidence.message.id,
        metadata: { match: evidence.match },
        observedAt: evidence.message.createdAt,
      });
    }
    return {
      tempId,
      cogneeNodeId: node.id,
      label,
      normalizedLabel: normalizeLabel(label),
      typeLabel,
      ontologyEntityTypeId: ontologyType?.id ?? null,
      ontologyTypeSlug: ontologyType?.slug ?? (typeLabel ? null : null),
      groundingStatus: ontologyType
        ? "grounded"
        : typeLabel
          ? "unapproved_type"
          : "unknown",
      provenanceStatus,
      summary:
        typeof node.properties?.summary === "string"
          ? node.properties.summary
          : null,
      aliases: readStringArray(node.properties?.aliases),
      properties: node.properties ?? {},
      diagnostics: ontologyType
        ? {}
        : {
            reason: typeLabel
              ? "unapproved_entity_type"
              : "missing_entity_type",
            typeLabel,
          },
      lastSeenAt: evidence?.message.createdAt ?? null,
    } satisfies NormalizedKnowledgeGraphEntity;
  });

  const entityIds = new Set(entities.map((entity) => entity.tempId));
  const relationshipEvidence = new Map<
    string,
    NormalizedKnowledgeGraphEvidence
  >();
  let droppedEdgeCount = 0;
  const relationships: NormalizedKnowledgeGraphRelationship[] = [];
  for (const edge of dedupeEdges(args.graph.edges)) {
    if (!entityIds.has(edge.source) || !entityIds.has(edge.target)) {
      droppedEdgeCount += 1;
      continue;
    }
    const relationshipType = findRelationshipType(
      relationshipTypes,
      edge.type ?? edge.label,
    );
    const source = entities.find((entity) => entity.tempId === edge.source)!;
    const target = entities.find((entity) => entity.tempId === edge.target)!;
    const evidence = findEvidence(args.transcript, [
      source.label,
      target.label,
      edge.label,
    ]);
    const tempId = edge.id ?? `${edge.source}->${edge.label}->${edge.target}`;
    if (evidence) {
      relationshipEvidence.set(tempId, {
        relationshipTempId: tempId,
        messageId: evidence.message.id,
        messageRole: evidence.message.role,
        messageCreatedAt: evidence.message.createdAt,
        speakerLabel: evidence.message.speakerLabel,
        snippet: evidence.snippet,
        charStart: evidence.charStart,
        charEnd: evidence.charEnd,
        sourceKind: "thread_message",
        sourceRef: evidence.message.id,
        metadata: { match: evidence.match },
        observedAt: evidence.message.createdAt,
      });
    }
    relationships.push({
      tempId,
      cogneeEdgeId: edge.id ?? null,
      sourceTempId: edge.source,
      targetTempId: edge.target,
      label: edge.label,
      ontologyRelationshipTypeId: relationshipType?.id ?? null,
      ontologyTypeSlug: relationshipType?.slug ?? null,
      groundingStatus: relationshipType
        ? "grounded"
        : edge.label
          ? "unapproved_type"
          : "unknown",
      provenanceStatus: evidence ? "strong" : "missing",
      confidence: readConfidence(edge.properties),
      properties: edge.properties ?? {},
      diagnostics: relationshipType
        ? {}
        : { reason: "unapproved_relationship_type", label: edge.label },
      lastSeenAt: evidence?.message.createdAt ?? null,
    });
  }

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
      droppedEdgeCount,
    },
  };
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
    node.type ??
    (typeof node.properties?.type === "string" ? node.properties.type : null)
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
