import { describe, expect, it, vi } from "vitest";
import {
  knowledgeGraphEntities,
  knowledgeGraphEvidence,
  knowledgeGraphIngestRuns,
  knowledgeGraphRelationships,
} from "@thinkwork/database-pg/schema";

import { mergeKnowledgeGraphSnapshot } from "./repository.js";
import type { NormalizedKnowledgeGraphSnapshot } from "./normalizer.js";

const RUN = {
  id: "run-2",
  tenant_id: "tenant-1",
  thread_id: null,
  source_kind: "observations",
  source_ref: "tenant:tenant-1:observations",
  source_label: "Hindsight observations",
  metadata: {},
} as never;

function entity(
  tempId: string,
  normalizedLabel: string,
  slug: string | null,
): NormalizedKnowledgeGraphSnapshot["entities"][number] {
  return {
    tempId,
    graphNodeId: tempId,
    label: normalizedLabel,
    normalizedLabel,
    typeLabel: slug,
    ontologyEntityTypeId: null,
    ontologyTypeSlug: slug,
    groundingStatus: "grounded",
    provenanceStatus: "strong",
    summary: null,
    aliases: [],
    properties: {},
    diagnostics: {},
    lastSeenAt: null,
  };
}

/**
 * Transaction double that records every call and routes the two `select`s
 * (entities, then relationships) to preset existing rows.
 */
function makeTx(opts: {
  existingEntities: Array<{
    id: string;
    normalized_label: string;
    ontology_type_slug: string | null;
  }>;
  existingRelationships?: Array<Record<string, unknown>>;
}) {
  const calls = {
    entityUpdates: [] as string[],
    entityInserts: [] as string[],
    entityDeletes: 0,
    relationshipDeletes: 0,
    evidenceDeletes: 0,
    runUpdate: null as Record<string, unknown> | null,
  };
  let selectCall = 0;
  let insertSeq = 0;

  const tx = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => {
          selectCall += 1;
          return selectCall === 1
            ? opts.existingEntities
            : (opts.existingRelationships ?? []);
        }),
      })),
    })),
    update: vi.fn((table: unknown) => ({
      set: vi.fn((values: Record<string, unknown>) => ({
        where: vi.fn(async () => {
          if (table === knowledgeGraphEntities) {
            calls.entityUpdates.push(String(values.normalized_label));
          } else if (table === knowledgeGraphIngestRuns) {
            calls.runUpdate = values;
          }
          return undefined;
        }),
      })),
    })),
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((values: Record<string, unknown>) => ({
        returning: vi.fn(async () => {
          insertSeq += 1;
          if (table === knowledgeGraphEntities) {
            calls.entityInserts.push(String(values.normalized_label));
          }
          return [{ id: `new-${insertSeq}` }];
        }),
      })),
    })),
    delete: vi.fn((table: unknown) => ({
      where: vi.fn(async () => {
        if (table === knowledgeGraphEvidence) calls.evidenceDeletes += 1;
        else if (table === knowledgeGraphRelationships)
          calls.relationshipDeletes += 1;
        else if (table === knowledgeGraphEntities) calls.entityDeletes += 1;
        return undefined;
      }),
    })),
    execute: vi.fn(async () => ({ rows: [] })),
  };
  return { tx, calls };
}

function snapshot(
  entities: NormalizedKnowledgeGraphSnapshot["entities"],
): NormalizedKnowledgeGraphSnapshot {
  return {
    entities,
    relationships: [],
    evidence: [],
    metrics: {
      extractedNodeCount: entities.length,
      extractedEdgeCount: 0,
      droppedNodeCount: 0,
      droppedEdgeCount: 0,
      structuralNodeCount: 0,
      unapprovedNodeCount: 0,
      outOfScopeNodeCount: 0,
      isolatedNodeCount: 0,
      unapprovedRelationshipCount: 0,
      incompatibleRelationshipCount: 0,
      orphanRelationshipCount: 0,
      droppedNodeSamples: [],
      droppedEdgeSamples: [],
    },
  };
}

describe("mergeKnowledgeGraphSnapshot", () => {
  it("merges into prior entities without deleting the source (extractor-accumulator regression)", async () => {
    // Prior run left one entity; this run re-mentions it plus adds a new one.
    const { tx, calls } = makeTx({
      existingEntities: [
        {
          id: "acme-id",
          normalized_label: "acme corp",
          ontology_type_slug: "company",
        },
      ],
    });
    const extraWork = vi.fn(async () => undefined);
    const db = {
      transaction: async (fn: (t: unknown) => Promise<void>) => fn(tx),
    } as never;

    await mergeKnowledgeGraphSnapshot({
      db,
      run: RUN,
      snapshot: snapshot([
        entity("t1", "acme corp", "company"), // matches existing → update
        entity("t2", "jane doe", "person"), // new → insert
      ]),
      startedAt: new Date("2026-07-03T00:00:00.000Z"),
      ingestMode: "bedrock_extraction",
      ontologyMechanism: "custom_prompt",
      extraWork,
    });

    // The whole point: NO delete of the entity/relationship mirror by source.
    expect(calls.entityDeletes).toBe(0);
    expect(calls.relationshipDeletes).toBe(0);
    // Existing entity updated in place; only the new one inserted.
    expect(calls.entityUpdates).toEqual(["acme corp"]);
    expect(calls.entityInserts).toEqual(["jane doe"]);
    // Run marked succeeded via merge path; cursor extraWork ran in-tx.
    expect(calls.runUpdate?.status).toBe("succeeded");
    expect(
      (calls.runUpdate?.metrics as Record<string, unknown>)?.writeMode,
    ).toBe("merge_upsert");
    expect(extraWork).toHaveBeenCalledTimes(1);
  });

  it("inserts all entities on an empty source without deleting anything", async () => {
    const { tx, calls } = makeTx({ existingEntities: [] });
    const db = {
      transaction: async (fn: (t: unknown) => Promise<void>) => fn(tx),
    } as never;

    await mergeKnowledgeGraphSnapshot({
      db,
      run: RUN,
      snapshot: snapshot([entity("t1", "acme corp", "company")]),
      startedAt: new Date("2026-07-03T00:00:00.000Z"),
      ingestMode: "bedrock_extraction",
      ontologyMechanism: "custom_prompt",
    });

    expect(calls.entityDeletes).toBe(0);
    expect(calls.entityInserts).toEqual(["acme corp"]);
    expect(calls.entityUpdates).toEqual([]);
  });
});
