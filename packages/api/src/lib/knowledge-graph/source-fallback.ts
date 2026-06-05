import {
  normalizeOntologySlug,
  type KnowledgeGraphOntologyExport,
  type OntologyEntityDefinition,
  type OntologyRelationshipDefinition,
} from "./ontology-export.js";
import type {
  KnowledgeGraphSourceBundle,
  KnowledgeGraphSourcePacket,
  KnowledgeGraphSourceRelationshipPacket,
} from "./source-adapters.js";
import type { ThreadTranscriptMessage } from "./thread-transcript.js";
import type {
  NormalizedKnowledgeGraphEntity,
  NormalizedKnowledgeGraphEvidence,
  NormalizedKnowledgeGraphRelationship,
  NormalizedKnowledgeGraphSnapshot,
} from "./normalizer.js";

export function applySourceDeclaredFallback(args: {
  snapshot: NormalizedKnowledgeGraphSnapshot;
  source: KnowledgeGraphSourceBundle;
  ontology: KnowledgeGraphOntologyExport;
}): NormalizedKnowledgeGraphSnapshot {
  if (args.source.sourceKind === "thread") return args.snapshot;
  if (args.snapshot.entities.length > 0) return args.snapshot;

  const entityTypes = buildEntityTypeIndex(args.ontology.entityTypes);
  const relationshipTypes = buildRelationshipTypeIndex(
    args.ontology.relationshipTypes,
  );
  const trustedPackets = args.source.packets.filter(
    (packet) => packet.trustedOntologyType && packet.entityTypeSlug,
  );
  if (trustedPackets.length === 0) return args.snapshot;

  const entityByPacketId = new Map<string, NormalizedKnowledgeGraphEntity>();
  const entities = trustedPackets.flatMap((packet) => {
    const ontologyType = findEntityType(entityTypes, packet.entityTypeSlug);
    if (!ontologyType) return [];
    const evidence = findPacketEvidence(args.source.evidence, packet.id);
    const entity: NormalizedKnowledgeGraphEntity = {
      tempId: packetTempId(packet.id),
      cogneeNodeId: `source:${args.source.sourceKind}:${packet.id}`,
      label: packet.title,
      normalizedLabel: normalizeLabel(packet.title),
      typeLabel: ontologyType.name,
      ontologyEntityTypeId: ontologyType.id,
      ontologyTypeSlug: ontologyType.slug,
      groundingStatus: "grounded",
      provenanceStatus: evidence ? "strong" : "missing",
      summary: readNullableString(packet.metadata.summary),
      aliases: readStringArray(packet.metadata.aliases),
      properties: {
        ...packet.metadata,
        sourceDeclaredFallback: true,
        sourceKind: args.source.sourceKind,
        sourceRef: args.source.sourceRef,
      },
      diagnostics: {
        sourceDeclaredFallback: true,
        fallbackReason: "cognee_returned_no_approved_entities",
      },
      lastSeenAt: evidence?.createdAt ?? null,
    };
    entityByPacketId.set(packet.id, entity);
    return [entity];
  });

  const relationships = args.source.relationships.flatMap((relationship) => {
    const source = entityByPacketId.get(relationship.fromPacketId);
    const target = entityByPacketId.get(relationship.toPacketId);
    if (!source || !target || !relationship.trustedOntologyType) return [];
    const relationshipType = findRelationshipType(
      relationshipTypes,
      relationship.relationshipTypeSlug ?? relationship.label,
    );
    if (!relationshipType) return [];
    if (!relationshipEndpointsAllowed(relationshipType, source, target)) {
      return [];
    }
    const evidence =
      findPacketEvidence(args.source.evidence, relationship.fromPacketId) ??
      findPacketEvidence(args.source.evidence, relationship.toPacketId);
    return [
      {
        tempId: relationshipTempId(relationship.id),
        cogneeEdgeId: null,
        sourceTempId: source.tempId,
        targetTempId: target.tempId,
        label: relationshipType.name,
        ontologyRelationshipTypeId: relationshipType.id,
        ontologyTypeSlug: relationshipType.slug,
        groundingStatus: "grounded",
        provenanceStatus: evidence ? "strong" : "missing",
        confidence: 1,
        properties: {
          ...relationship.metadata,
          context: relationship.context,
          sourceDeclaredFallback: true,
          sourceKind: args.source.sourceKind,
          sourceRef: args.source.sourceRef,
        },
        diagnostics: {
          sourceDeclaredFallback: true,
          fallbackReason: "cognee_returned_no_approved_entities",
        },
        lastSeenAt: evidence?.createdAt ?? null,
      } satisfies NormalizedKnowledgeGraphRelationship,
    ];
  });

  const evidence = [
    ...entities.flatMap((entity) => {
      const packetId = entity.tempId.replace(/^source-packet:/, "");
      const match = findPacketEvidence(args.source.evidence, packetId);
      return match
        ? [
            evidenceFromMessage({
              entityTempId: entity.tempId,
              message: match,
              metadata: {
                fallbackReason: "cognee_returned_no_approved_entities",
              },
            }),
          ]
        : [];
    }),
    ...relationships.flatMap((relationship) => {
      const sourcePacketId = relationship.sourceTempId.replace(
        /^source-packet:/,
        "",
      );
      const match = findPacketEvidence(args.source.evidence, sourcePacketId);
      return match
        ? [
            evidenceFromMessage({
              relationshipTempId: relationship.tempId,
              message: match,
              metadata: {
                fallbackReason: "cognee_returned_no_approved_entities",
              },
            }),
          ]
        : [];
    }),
  ];

  return {
    entities,
    relationships,
    evidence,
    metrics: {
      ...args.snapshot.metrics,
      sourceDeclaredFallback: true,
      sourceDeclaredReason: "cognee_returned_no_approved_entities",
      sourceDeclaredEntityCount: entities.length,
      sourceDeclaredRelationshipCount: relationships.length,
      sourceDeclaredEvidenceCount: evidence.length,
    },
  } as NormalizedKnowledgeGraphSnapshot;
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
  slug: string | null | undefined,
) {
  return slug ? (index.get(normalizeOntologySlug(slug)) ?? null) : null;
}

function findRelationshipType(
  index: Map<string, OntologyRelationshipDefinition>,
  slug: string | null | undefined,
) {
  return slug ? (index.get(normalizeOntologySlug(slug)) ?? null) : null;
}

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

function findPacketEvidence(
  messages: ThreadTranscriptMessage[],
  packetId: string,
): ThreadTranscriptMessage | null {
  return (
    messages.find(
      (message) =>
        message.evidenceSourceRef === packetId ||
        message.evidenceMetadata?.pageId === packetId,
    ) ?? null
  );
}

function evidenceFromMessage(args: {
  entityTempId?: string;
  relationshipTempId?: string;
  message: ThreadTranscriptMessage;
  metadata: Record<string, unknown>;
}): NormalizedKnowledgeGraphEvidence {
  return {
    entityTempId: args.entityTempId,
    relationshipTempId: args.relationshipTempId,
    messageId:
      args.message.evidenceSourceKind === "thread_message"
        ? args.message.id
        : null,
    messageRole: args.message.role,
    messageCreatedAt: args.message.createdAt,
    speakerLabel: args.message.speakerLabel,
    snippet: snippet(args.message.text),
    charStart: null,
    charEnd: null,
    sourceKind: args.message.evidenceSourceKind ?? "thread_message",
    sourceRef: args.message.evidenceSourceRef ?? args.message.id,
    metadata: {
      ...args.message.evidenceMetadata,
      ...args.metadata,
    },
    observedAt: args.message.createdAt,
  };
}

function packetTempId(id: string): string {
  return `source-packet:${id}`;
}

function relationshipTempId(id: string): string {
  return `source-relationship:${id}`;
}

function normalizeLabel(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function readNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function snippet(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 500);
}
