import type { KnowledgeGraphSourceKind } from "@thinkwork/database-pg/schema";
import type { ThreadTranscriptMessage } from "./thread-transcript.js";

export interface KnowledgeGraphSourcePacket {
  id: string;
  title: string;
  entityTypeSlug: string | null;
  trustedOntologyType: boolean;
  text: string;
  metadata: Record<string, unknown>;
}

export interface KnowledgeGraphSourceRelationshipPacket {
  id: string;
  fromPacketId: string;
  toPacketId: string;
  relationshipTypeSlug: string | null;
  trustedOntologyType: boolean;
  label: string;
  context: string | null;
  metadata: Record<string, unknown>;
}

export interface KnowledgeGraphSourceBundle {
  sourceKind: KnowledgeGraphSourceKind;
  sourceRef: string;
  sourceLabel: string;
  document: string;
  evidence: ThreadTranscriptMessage[];
  packets: KnowledgeGraphSourcePacket[];
  relationships: KnowledgeGraphSourceRelationshipPacket[];
  packetCount: number;
  skippedCount: number;
  diagnostics: Record<string, unknown>;
}

export function renderPacketDocument(args: {
  heading: string;
  packets: KnowledgeGraphSourcePacket[];
}): string {
  return [
    `# ${args.heading}`,
    "",
    "Use the declared ontology_type_slug values and relationship hints below. Preserve citations in properties when possible.",
    "",
    ...args.packets.map((packet, index) =>
      [
        `<!-- source_packet:${packet.id} trusted_ontology_type:${packet.trustedOntologyType ? "true" : "false"} -->`,
        `## Entity ${index + 1}: ${packet.title}`,
        `ontology_type_slug: ${packet.entityTypeSlug ?? "unapproved"}`,
        packet.text,
      ].join("\n"),
    ),
  ].join("\n\n");
}
