/**
 * Upsert-by-sourceId record loading, deletion mirroring, rollback, and the
 * parity report (plan U5–U7, KTD3/KTD6/KTD7).
 *
 * Idempotency is query-then-branch on the unique `sourceId` custom field —
 * Twenty has no public upsert. Lookups include soft-deleted records (a miss on
 * a soft-deleted twin would create a live duplicate): missing → create; found
 * active → sourceHash diff, update or skip; found soft-deleted with a live
 * source row → restore + update. Two live records sharing a sourceId abort.
 */

import { contentHash } from "./mappers";
import type {
  MappedNote,
  MappedOpportunityProduct,
  MappedRecord,
} from "./mappers";
import {
  BATCH_LIMIT,
  chunk,
  TwentyClient,
  TwentyGraphqlError,
} from "./twenty-client";

const QUERY_PAGE = 200;

/** True when Twenty rejects a filter because the sourceId custom field does
 * not exist yet (virgin workspace before schema-ensure applies — the dry-run
 * plans the field but cannot create it). No field ⇒ no record carries it. */
export function isMissingSourceIdFieldError(error: unknown): boolean {
  return (
    error instanceof TwentyGraphqlError &&
    error.errors.some((entry) =>
      /doesn't have any .?sourceId.? field/i.test(entry.message),
    )
  );
}

export interface EntityShape {
  /** e.g. "company" */
  singular: string;
  /** e.g. "companies" */
  plural: string;
  /** Capitalized singular, e.g. "Company" — for mutation names. */
  capSingular: string;
  /** Capitalized plural, e.g. "Companies". */
  capPlural: string;
}

export const COMPANY: EntityShape = {
  singular: "company",
  plural: "companies",
  capSingular: "Company",
  capPlural: "Companies",
};
export const PERSON: EntityShape = {
  singular: "person",
  plural: "people",
  capSingular: "Person",
  capPlural: "People",
};
export const OPPORTUNITY: EntityShape = {
  singular: "opportunity",
  plural: "opportunities",
  capSingular: "Opportunity",
  capPlural: "Opportunities",
};
export const OPPORTUNITY_PRODUCT: EntityShape = {
  singular: "opportunityProduct",
  plural: "opportunityProducts",
  capSingular: "OpportunityProduct",
  capPlural: "OpportunityProducts",
};
export const NOTE: EntityShape = {
  singular: "note",
  plural: "notes",
  capSingular: "Note",
  capPlural: "Notes",
};

export interface ExistingRecord {
  id: string;
  sourceId: string;
  sourceHash: string | null;
  deletedAt: string | null;
}

export interface EntityCounters {
  sourceTotal: number;
  created: number;
  updated: number;
  restored: number;
  skipped: number;
  deleted: number;
  failed: number;
  plannedMutations: string[];
  gaps: string[];
  warnings: string[];
}

export function emptyCounters(): EntityCounters {
  return {
    sourceTotal: 0,
    created: 0,
    updated: 0,
    restored: 0,
    skipped: 0,
    deleted: 0,
    failed: 0,
    plannedMutations: [],
    gaps: [],
    warnings: [],
  };
}

/**
 * Fetch existing Twenty records for the given sourceIds — active AND
 * soft-deleted (two filtered passes; Twenty's default queries exclude deleted
 * rows). Aborts when two live records share a sourceId.
 */
export async function fetchExistingBySourceIds(
  client: TwentyClient,
  entity: EntityShape,
  ids: readonly string[],
): Promise<Map<string, ExistingRecord>> {
  const found = new Map<string, ExistingRecord>();
  const query = `
    query MigrationExisting${entity.capPlural}($filter: ${entity.capSingular}FilterInput) {
      ${entity.plural}(filter: $filter, first: ${QUERY_PAGE}) {
        edges { node { id sourceId sourceHash deletedAt } }
      }
    }
  `;
  for (const page of chunk(ids, QUERY_PAGE)) {
    for (const filter of [
      { sourceId: { in: [...page] } },
      { sourceId: { in: [...page] }, deletedAt: { is: "NOT_NULL" } },
    ]) {
      let data: {
        [plural: string]: { edges: Array<{ node: ExistingRecord }> };
      };
      try {
        data = await client.requestWithRetry<{
          [plural: string]: { edges: Array<{ node: ExistingRecord }> };
        }>("/graphql", query, { filter });
      } catch (error) {
        if (isMissingSourceIdFieldError(error)) return found;
        throw error;
      }
      for (const { node } of data[entity.plural].edges) {
        const existing = found.get(node.sourceId);
        if (existing && existing.id !== node.id) {
          if (!existing.deletedAt && !node.deletedAt) {
            throw new Error(
              `Two live ${entity.plural} share sourceId ${node.sourceId} (${existing.id}, ${node.id}) — aborting; reconcile manually.`,
            );
          }
          // Prefer the live record over a soft-deleted twin.
          if (existing.deletedAt && !node.deletedAt)
            found.set(node.sourceId, node);
          continue;
        }
        found.set(node.sourceId, node);
      }
    }
  }
  return found;
}

export interface UpsertOptions {
  client: TwentyClient;
  entity: EntityShape;
  mapped: MappedRecord[];
  dryRun: boolean;
  counters: EntityCounters;
  /** Extra fields ignored when creating (e.g. none today); test seam. */
  onCreated?: (sourceId: string, twentyId: string) => void;
}

/**
 * Core upsert pass. Returns sourceId → Twenty id for every record that exists
 * after the pass (created, updated, restored, or skipped), so later phases can
 * resolve relations.
 */
export async function upsertRecords(
  options: UpsertOptions,
): Promise<Map<string, string>> {
  const { client, entity, mapped, dryRun, counters } = options;
  counters.sourceTotal += mapped.length;
  for (const record of mapped) counters.warnings.push(...record.warnings);

  const existing = await fetchExistingBySourceIds(
    client,
    entity,
    mapped.map((record) => record.sourceId),
  );

  const idBySourceId = new Map<string, string>();
  const toCreate: MappedRecord[] = [];
  const toUpdate: Array<{
    record: MappedRecord;
    twentyId: string;
    restore: boolean;
  }> = [];

  for (const record of mapped) {
    const hash = contentHash(record.input);
    const current = existing.get(record.sourceId);
    if (!current) {
      toCreate.push(record);
      continue;
    }
    idBySourceId.set(record.sourceId, current.id);
    if (current.deletedAt) {
      toUpdate.push({ record, twentyId: current.id, restore: true });
    } else if (current.sourceHash !== hash) {
      toUpdate.push({ record, twentyId: current.id, restore: false });
    } else {
      counters.skipped += 1;
    }
  }

  if (dryRun) {
    for (const record of toCreate) {
      counters.created += 1;
      counters.plannedMutations.push(
        `create ${entity.singular} ${record.sourceId}`,
      );
    }
    for (const { record, restore } of toUpdate) {
      if (restore) {
        counters.restored += 1;
        counters.plannedMutations.push(
          `restore+update ${entity.singular} ${record.sourceId}`,
        );
      } else {
        counters.updated += 1;
        counters.plannedMutations.push(
          `update ${entity.singular} ${record.sourceId}`,
        );
      }
    }
    return idBySourceId;
  }

  // Creates — batched ≤60; on batch failure fall back per-record to isolate.
  const createMutation = `
    mutation MigrationCreate${entity.capPlural}($data: [${entity.capSingular}CreateInput!]!) {
      create${entity.capPlural}(data: $data) { id sourceId }
    }
  `;
  for (const batch of chunk(toCreate, BATCH_LIMIT)) {
    const data = batch.map((record) => ({
      ...record.input,
      sourceHash: contentHash(record.input),
    }));
    try {
      const result = await client.requestOnce<{
        [key: string]: Array<{ id: string; sourceId: string }>;
      }>("/graphql", createMutation, { data });
      for (const node of result[`create${entity.capPlural}`]) {
        idBySourceId.set(node.sourceId, node.id);
        options.onCreated?.(node.sourceId, node.id);
        counters.created += 1;
      }
    } catch (error) {
      // Ambiguous batch failure: re-query by sourceId before any re-attempt
      // (KTD3 — never blind-retry a create), then create the true misses
      // one-by-one so a single bad row can't sink the batch.
      const requeried = await fetchExistingBySourceIds(
        client,
        entity,
        batch.map((record) => record.sourceId),
      );
      for (const record of batch) {
        const current = requeried.get(record.sourceId);
        if (current) {
          idBySourceId.set(record.sourceId, current.id);
          counters.created += 1;
          continue;
        }
        try {
          const single = await client.requestOnce<{
            [key: string]: Array<{ id: string; sourceId: string }>;
          }>("/graphql", createMutation, {
            data: [{ ...record.input, sourceHash: contentHash(record.input) }],
          });
          const node = single[`create${entity.capPlural}`][0];
          idBySourceId.set(node.sourceId, node.id);
          counters.created += 1;
        } catch (singleError) {
          counters.failed += 1;
          counters.gaps.push(
            `create ${entity.singular} ${record.sourceId} failed: ${
              singleError instanceof Error
                ? singleError.message.slice(0, 300)
                : String(singleError)
            }`,
          );
        }
      }
      void error;
    }
  }

  // Restores then updates — per record.
  const restoreMutation = `
    mutation MigrationRestore${entity.capSingular}($id: UUID!) {
      restore${entity.capSingular}(id: $id) { id }
    }
  `;
  const updateMutation = `
    mutation MigrationUpdate${entity.capSingular}($id: UUID!, $data: ${entity.capSingular}UpdateInput!) {
      update${entity.capSingular}(id: $id, data: $data) { id }
    }
  `;
  for (const { record, twentyId, restore } of toUpdate) {
    try {
      if (restore) {
        await client.requestOnce("/graphql", restoreMutation, { id: twentyId });
      }
      await client.requestOnce("/graphql", updateMutation, {
        id: twentyId,
        data: { ...record.input, sourceHash: contentHash(record.input) },
      });
      if (restore) counters.restored += 1;
      else counters.updated += 1;
    } catch (error) {
      counters.failed += 1;
      counters.gaps.push(
        `${restore ? "restore" : "update"} ${entity.singular} ${record.sourceId} failed: ${
          error instanceof Error ? error.message.slice(0, 300) : String(error)
        }`,
      );
    }
  }

  return idBySourceId;
}

/**
 * Deletion mirror (R13, KTD7): soft-delete Twenty records whose sourceId no
 * longer exists live in LastMile. LastMile's CRM tables have no dead-mark
 * columns (2026-07-09 schema read), so "dead" = absent from the current source
 * id set — an id-set diff. Records without a sourceId are never candidates.
 */
export async function mirrorDeletions(options: {
  client: TwentyClient;
  entity: EntityShape;
  /** Every sourceId currently live in LastMile for this entity. */
  liveSourceIds: ReadonlySet<string>;
  /** Namespace prefixes owned by the migration for this entity, e.g. ["lead:", "opportunity:"]. */
  ownedPrefixes: readonly string[];
  dryRun: boolean;
  counters: EntityCounters;
}): Promise<void> {
  const { client, entity, liveSourceIds, ownedPrefixes, dryRun, counters } =
    options;
  const query = `
    query MigrationAll${entity.capPlural}($filter: ${entity.capSingular}FilterInput, $after: String) {
      ${entity.plural}(filter: $filter, first: ${QUERY_PAGE}, after: $after) {
        edges { node { id sourceId } cursor }
        pageInfo { hasNextPage endCursor }
      }
    }
  `;
  const staleIds: Array<{ id: string; sourceId: string }> = [];
  let after: string | null = null;
  for (;;) {
    let data: {
      [plural: string]: {
        edges: Array<{ node: { id: string; sourceId: string | null } }>;
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    };
    try {
      data = await client.requestWithRetry("/graphql", query, {
        filter: { sourceId: { is: "NOT_NULL" } },
        ...(after ? { after } : {}),
      });
    } catch (error) {
      if (isMissingSourceIdFieldError(error)) return;
      throw error;
    }
    for (const { node } of data[entity.plural].edges) {
      if (!node.sourceId) continue;
      if (!ownedPrefixes.some((prefix) => node.sourceId!.startsWith(prefix)))
        continue;
      if (!liveSourceIds.has(node.sourceId)) {
        staleIds.push({ id: node.id, sourceId: node.sourceId });
      }
    }
    if (!data[entity.plural].pageInfo.hasNextPage) break;
    after = data[entity.plural].pageInfo.endCursor;
  }

  if (dryRun) {
    for (const stale of staleIds) {
      counters.deleted += 1;
      counters.plannedMutations.push(
        `soft-delete ${entity.singular} ${stale.sourceId}`,
      );
    }
    return;
  }

  const deleteMutation = `
    mutation MigrationDelete${entity.capPlural}($filter: ${entity.capSingular}FilterInput!) {
      delete${entity.capPlural}(filter: $filter) { id }
    }
  `;
  for (const batch of chunk(staleIds, BATCH_LIMIT)) {
    try {
      await client.requestOnce("/graphql", deleteMutation, {
        filter: { id: { in: batch.map((stale) => stale.id) } },
      });
      counters.deleted += batch.length;
    } catch (error) {
      counters.failed += batch.length;
      counters.gaps.push(
        `soft-delete batch (${batch.length} ${entity.plural}) failed: ${
          error instanceof Error ? error.message.slice(0, 300) : String(error)
        }`,
      );
    }
  }
}

/**
 * Rollback mode (Risks & Rollback): soft-delete EVERY record whose sourceId
 * the migration owns, per entity — reversible via Twenty's restore. Dry-run
 * lists the exact set first (rollback rehearsal gate).
 */
export async function rollbackEntity(options: {
  client: TwentyClient;
  entity: EntityShape;
  ownedPrefixes: readonly string[];
  dryRun: boolean;
  counters: EntityCounters;
}): Promise<void> {
  await mirrorDeletions({
    client: options.client,
    entity: options.entity,
    liveSourceIds: new Set<string>(),
    ownedPrefixes: options.ownedPrefixes,
    dryRun: options.dryRun,
    counters: options.counters,
  });
}

// --- Notes (Note + NoteTarget, KTD6/U6) ----------------------------------

export async function upsertNotes(options: {
  client: TwentyClient;
  notes: MappedNote[];
  /** target sourceId → Twenty id, for opportunities and companies. */
  targetIdBySourceId: ReadonlyMap<string, string>;
  dryRun: boolean;
  counters: EntityCounters;
}): Promise<void> {
  const { client, notes, targetIdBySourceId, dryRun, counters } = options;
  const liveNotes = notes.filter((note) => !note.isDeleted);
  counters.sourceTotal += liveNotes.length;

  const resolvable = liveNotes.filter((note) => {
    if (targetIdBySourceId.has(note.targetSourceId)) return true;
    counters.gaps.push(
      `note ${note.sourceId}: target ${note.targetSourceId} not migrated`,
    );
    counters.skipped += 1;
    return false;
  });

  const mapped: MappedRecord[] = resolvable.map((note) => ({
    sourceId: note.sourceId,
    input: {
      title: note.title,
      bodyV2: { markdown: note.bodyMarkdown },
      sourceId: note.sourceId,
    },
    warnings: [],
  }));

  const noteCounters = emptyCounters();
  const noteIdBySourceId = await upsertRecords({
    client,
    entity: NOTE,
    mapped,
    dryRun,
    counters: noteCounters,
  });
  counters.created += noteCounters.created;
  counters.updated += noteCounters.updated;
  counters.restored += noteCounters.restored;
  counters.skipped += noteCounters.skipped;
  counters.failed += noteCounters.failed;
  counters.plannedMutations.push(...noteCounters.plannedMutations);
  counters.gaps.push(...noteCounters.gaps);

  // NoteTarget is ensured UNCONDITIONALLY — including for hash-skipped notes —
  // so a crash between the Note write and the NoteTarget write heals on
  // re-run (plan U6).
  for (const note of resolvable) {
    if (dryRun) continue; // note creates already planned; target ensure follows them
    const noteId = noteIdBySourceId.get(note.sourceId);
    const targetId = targetIdBySourceId.get(note.targetSourceId);
    if (!noteId || !targetId) continue;
    try {
      const existing = await client.requestWithRetry<{
        noteTargets: { edges: Array<{ node: { id: string } }> };
      }>(
        "/graphql",
        `query MigrationNoteTargets($filter: NoteTargetFilterInput) {
          noteTargets(filter: $filter, first: 1) { edges { node { id } } }
        }`,
        { filter: { noteId: { eq: noteId } } },
      );
      if (existing.noteTargets.edges.length > 0) continue;
      const targetField =
        note.targetKind === "company"
          ? "targetCompanyId"
          : "targetOpportunityId";
      await client.requestOnce(
        "/graphql",
        `mutation MigrationCreateNoteTargets($data: [NoteTargetCreateInput!]!) {
          createNoteTargets(data: $data) { id }
        }`,
        { data: [{ noteId, [targetField]: targetId }] },
      );
    } catch (error) {
      counters.failed += 1;
      counters.gaps.push(
        `noteTarget for ${note.sourceId} failed: ${
          error instanceof Error ? error.message.slice(0, 300) : String(error)
        }`,
      );
    }
  }

  // Deleted comments mirror to deleted notes.
  const deletedNoteIds = notes
    .filter((note) => note.isDeleted)
    .map((note) => note.sourceId);
  if (deletedNoteIds.length > 0) {
    const existing = await fetchExistingBySourceIds(
      client,
      NOTE,
      deletedNoteIds,
    );
    const toDelete = [...existing.values()].filter(
      (record) => !record.deletedAt,
    );
    if (dryRun) {
      for (const record of toDelete) {
        counters.deleted += 1;
        counters.plannedMutations.push(`soft-delete note ${record.sourceId}`);
      }
    } else {
      for (const batch of chunk(toDelete, BATCH_LIMIT)) {
        try {
          await client.requestOnce(
            "/graphql",
            `mutation MigrationDeleteNotes($filter: NoteFilterInput!) {
              deleteNotes(filter: $filter) { id }
            }`,
            { filter: { id: { in: batch.map((record) => record.id) } } },
          );
          counters.deleted += batch.length;
        } catch (error) {
          counters.failed += batch.length;
          counters.gaps.push(
            `soft-delete notes batch failed: ${
              error instanceof Error
                ? error.message.slice(0, 300)
                : String(error)
            }`,
          );
        }
      }
    }
  }
}

/**
 * Product lines on opportunities (multiple products per opportunity). Lines
 * whose opportunity did not migrate are skipped and reported; the rest upsert
 * by their `opportunity_item:<oppId>#<index>` sourceId, so re-runs update a
 * line in place rather than duplicating it.
 */
export async function upsertOpportunityProducts(options: {
  client: TwentyClient;
  products: MappedOpportunityProduct[];
  /** opportunity sourceId -> Twenty opportunity id. */
  opportunityIdBySourceId: ReadonlyMap<string, string>;
  dryRun: boolean;
  counters: EntityCounters;
}): Promise<void> {
  const { client, products, opportunityIdBySourceId, dryRun, counters } =
    options;

  const resolvable: MappedRecord[] = [];
  for (const product of products) {
    const opportunityId = opportunityIdBySourceId.get(
      product.opportunitySourceId,
    );
    if (!opportunityId) {
      counters.sourceTotal += 1;
      counters.skipped += 1;
      counters.gaps.push(
        `product line ${product.sourceId}: opportunity ${product.opportunitySourceId} not migrated`,
      );
      continue;
    }
    resolvable.push({
      sourceId: product.sourceId,
      input: { ...product.input, opportunityId },
      warnings: product.warnings,
    });
  }

  await upsertRecords({
    client,
    entity: OPPORTUNITY_PRODUCT,
    mapped: resolvable,
    dryRun,
    counters,
  });
}

// --- Consistency invariants (U7) ------------------------------------------

export interface InvariantViolation {
  invariant: string;
  detail: string;
}

export async function checkNoteTargetPairing(
  client: TwentyClient,
): Promise<InvariantViolation[]> {
  const violations: InvariantViolation[] = [];
  let after: string | null = null;
  for (;;) {
    const data: {
      notes: {
        edges: Array<{
          node: {
            id: string;
            sourceId: string | null;
            noteTargets: { edges: Array<{ node: { id: string } }> };
          };
        }>;
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    } = await client.requestWithRetry(
      "/graphql",
      `query MigrationNotePairing($filter: NoteFilterInput, $after: String) {
        notes(filter: $filter, first: ${QUERY_PAGE}, after: $after) {
          edges {
            node { id sourceId noteTargets { edges { node { id } } } }
            cursor
          }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { filter: { sourceId: { is: "NOT_NULL" } }, ...(after ? { after } : {}) },
    );
    for (const { node } of data.notes.edges) {
      const targetCount = node.noteTargets.edges.length;
      if (targetCount !== 1) {
        violations.push({
          invariant: "note-has-one-target",
          detail: `note ${node.sourceId ?? node.id} has ${targetCount} targets`,
        });
      }
    }
    if (!data.notes.pageInfo.hasNextPage) break;
    after = data.notes.pageInfo.endCursor;
  }
  return violations;
}
