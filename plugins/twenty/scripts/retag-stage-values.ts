#!/usr/bin/env npx tsx
/**
 * One-off: strip the `LM_` prefix from opportunity stage VALUES, and remove the
 * stage options no record uses.
 *
 * The first import wrote values like `LM_10_PROSPECT`. Labels were always clean
 * ("10-Prospect"), but the raw value surfaces in the API, in filters, and in
 * generated reports. It also left 8 options behind from an abandoned model.
 *
 * Order matters. Deleting an option while records still reference its value
 * strands those records on a value the field no longer offers, so this runs in
 * three phases:
 *
 *   1. ADD    — write options = existing ∪ clean values. Both old and new exist.
 *   2. RETAG  — move every record from its LM_ value to the clean one.
 *   3. PRUNE  — write options = final set, dropping LM_* and the 8 orphans.
 *
 * A crash between phases is safe: phase 1 is idempotent, phase 2 re-runs over
 * whatever is left, and phase 3 refuses to drop a value that still has records.
 *
 * CUSTOMER is never dropped — the ThinkWork workflow triggers on it.
 *
 * Usage:
 *   npx tsx scripts/retag-stage-values.ts           # dry-run: show the plan
 *   npx tsx scripts/retag-stage-values.ts --apply
 */

import process from "node:process";

import {
  LEGACY_STAGE_VALUE_MAP,
  MIGRATION_STAGE_OPTIONS,
  OBSOLETE_STAGE_VALUES,
} from "./lib/mappers";
import { chunk, TwentyClient, normalizeBaseUrl } from "./lib/twenty-client";

interface StageOption {
  id?: string;
  label: string;
  value: string;
  color: string;
  position: number;
}

const UPDATE_BATCH = 60;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function log(message: string): void {
  process.stderr.write(`${message}\n`);
}

async function readStageField(
  client: TwentyClient,
): Promise<{ id: string; options: StageOption[] }> {
  const data = await client.requestWithRetry<{
    objects: {
      edges: Array<{
        node: {
          nameSingular: string;
          fields: {
            edges: Array<{
              node: { id: string; name: string; options: StageOption[] | null };
            }>;
          };
        };
      }>;
    };
  }>(
    "/metadata",
    `query RetagStageField {
      objects(paging: { first: 1000 }) {
        edges { node { nameSingular fields(paging: { first: 1000 }) { edges { node { id name options } } } } }
      }
    }`,
  );
  const opportunity = data.objects.edges.find(
    (edge) => edge.node.nameSingular === "opportunity",
  );
  const stage = opportunity?.node.fields.edges.find(
    (edge) => edge.node.name === "stage",
  )?.node;
  if (!stage?.options) throw new Error("opportunity.stage field not found.");
  return { id: stage.id, options: stage.options };
}

async function writeOptions(
  client: TwentyClient,
  fieldId: string,
  options: StageOption[],
): Promise<void> {
  await client.requestOnce(
    "/metadata",
    `mutation RetagWriteOptions($input: UpdateOneFieldMetadataInput!) {
      updateOneField(input: $input) { id }
    }`,
    { input: { id: fieldId, update: { options } } },
  );
}

/**
 * Confirm a freshly-added option value is actually live before any record is
 * moved onto it. Twenty accepts the metadata write immediately, but the
 * underlying Postgres enum lags — and a record written to a not-yet-live value
 * is silently coerced to the field's default rather than rejected. That cost
 * 1,510 opportunities their stage on 2026-07-10; they were rebuilt from
 * LastMile, but the write must never be attempted blind again.
 */
async function waitForOptionsLive(
  client: TwentyClient,
  values: readonly string[],
  attempts = 10,
): Promise<void> {
  for (const value of values) {
    let live = false;
    for (let attempt = 0; attempt < attempts && !live; attempt += 1) {
      try {
        await client.requestWithRetry(
          "/graphql",
          `query RetagProbe($filter: OpportunityFilterInput) {
            opportunities(filter: $filter, first: 1) { edges { node { id } } }
          }`,
          { filter: { stage: { eq: value } } },
        );
        live = true;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
    }
    if (!live) {
      throw new Error(
        `Stage option "${value}" never became queryable; refusing to retag records onto it.`,
      );
    }
  }
}

/** Count records per stage value so PRUNE can refuse to strand any. */
async function countByStage(
  client: TwentyClient,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  let after: string | null = null;
  for (;;) {
    const data: {
      opportunities: {
        edges: Array<{ node: { id: string; stage: string | null } }>;
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    } = await client.requestWithRetry(
      "/graphql",
      `query RetagCount($after: String) {
        opportunities(first: 100, after: $after) {
          edges { node { id stage } cursor }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      after ? { after } : {},
    );
    for (const { node } of data.opportunities.edges) {
      const key = node.stage ?? "NULL";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    if (!data.opportunities.pageInfo.hasNextPage) break;
    after = data.opportunities.pageInfo.endCursor;
  }
  return counts;
}

async function idsForStage(
  client: TwentyClient,
  stage: string,
): Promise<string[]> {
  const ids: string[] = [];
  let after: string | null = null;
  for (;;) {
    const data: {
      opportunities: {
        edges: Array<{ node: { id: string } }>;
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    } = await client.requestWithRetry(
      "/graphql",
      `query RetagIds($filter: OpportunityFilterInput, $after: String) {
        opportunities(filter: $filter, first: 100, after: $after) {
          edges { node { id } cursor }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { filter: { stage: { eq: stage } }, ...(after ? { after } : {}) },
    );
    ids.push(...data.opportunities.edges.map((edge) => edge.node.id));
    if (!data.opportunities.pageInfo.hasNextPage) break;
    after = data.opportunities.pageInfo.endCursor;
  }
  return ids;
}

async function main(): Promise<void> {
  const apply = process.argv.slice(2).includes("--apply");
  const client = new TwentyClient({
    baseUrl: normalizeBaseUrl(requireEnv("TWENTY_PUBLIC_URL")),
    authToken: requireEnv("TWENTY_API_KEY"),
  });

  const { id: fieldId, options } = await readStageField(client);
  const before = await countByStage(client);
  const report: Record<string, unknown> = {
    mode: apply ? "apply" : "dry-run",
    stageCountsBefore: Object.fromEntries(before),
  };

  const cleanValues = new Set(MIGRATION_STAGE_OPTIONS.map((o) => o.value));
  const retagged = Object.entries(LEGACY_STAGE_VALUE_MAP).filter(
    ([from]) => (before.get(from) ?? 0) > 0,
  );
  report.willRetag = Object.fromEntries(
    retagged.map(([from, to]) => [from, `${to} (${before.get(from)} records)`]),
  );

  // --- Phase 1: ADD -------------------------------------------------------
  const existingValues = new Set(options.map((option) => option.value));
  const additions = MIGRATION_STAGE_OPTIONS.filter(
    (option) => !existingValues.has(option.value),
  );
  const migrationByValue = new Map(
    MIGRATION_STAGE_OPTIONS.map((option) => [option.value, option]),
  );
  // A reused option (NEW, PROSPECT, WON, LOST, FORMULATE_OFFER) must take
  // LastMile's label and colour, or the picker shows "Won" where the source
  // says "60-Won".
  const relabelled: string[] = [];
  const phase1: StageOption[] = [
    ...options.map((option, index) => {
      const replacement = migrationByValue.get(option.value);
      if (!replacement) return { ...option, position: index };
      if (option.label !== replacement.label) relabelled.push(option.value);
      return {
        ...option,
        label: replacement.label,
        color: replacement.color,
        position: index,
      };
    }),
    ...additions.map((option, index) => ({
      label: option.label,
      value: option.value,
      color: option.color,
      position: options.length + index,
    })),
  ];
  report.phase1Add = additions.map((option) => option.value);
  report.phase1Relabel = relabelled;

  if (apply && (additions.length > 0 || relabelled.length > 0)) {
    log(
      `phase 1: adding ${additions.length} options, relabelling ${relabelled.length}...`,
    );
    await writeOptions(client, fieldId, phase1);
    // The enum lags the metadata write; moving records onto a value that is not
    // yet live silently coerces them to the default.
    log("phase 1: waiting for new options to go live...");
    await waitForOptionsLive(
      client,
      additions.map((option) => option.value),
    );
  }

  // --- Phase 2: RETAG -----------------------------------------------------
  const moved: Record<string, number> = {};
  if (apply) {
    for (const [from, to] of retagged) {
      const ids = await idsForStage(client, from);
      log(`phase 2: ${from} -> ${to} (${ids.length} records)`);
      for (const batch of chunk(ids, UPDATE_BATCH)) {
        await client.requestOnce(
          "/graphql",
          `mutation RetagMove($filter: OpportunityFilterInput!, $data: OpportunityUpdateInput!) {
            updateOpportunities(filter: $filter, data: $data) { id }
          }`,
          { filter: { id: { in: batch } }, data: { stage: to } },
        );
      }
      moved[from] = ids.length;
    }
  }
  report.phase2Moved = apply ? moved : "(dry-run)";

  // --- Phase 3: PRUNE -----------------------------------------------------
  const after = apply ? await countByStage(client) : before;

  // Every record must have landed on the value we aimed it at. Verify BEFORE
  // pruning, because pruning is the destructive step and a silent coercion
  // would otherwise be locked in.
  if (apply) {
    const expected = new Map<string, number>();
    for (const [from, to] of Object.entries(LEGACY_STAGE_VALUE_MAP)) {
      const n = before.get(from) ?? 0;
      if (n > 0) expected.set(to, (expected.get(to) ?? 0) + n);
    }
    const drift = [...expected.entries()].filter(
      ([value, count]) => (after.get(value) ?? 0) !== count,
    );
    if (drift.length > 0) {
      throw new Error(
        "Retag did not land as planned — refusing to prune. " +
          drift
            .map(
              ([value, want]) =>
                `${value}: expected ${want}, found ${after.get(value) ?? 0}`,
            )
            .join("; ") +
          ". Re-run migrate-lastmile.ts --apply to rebuild stages from LastMile.",
      );
    }
  }
  const dropCandidates = [
    ...Object.keys(LEGACY_STAGE_VALUE_MAP),
    ...OBSOLETE_STAGE_VALUES,
  ];
  const stillUsed = dropCandidates.filter(
    (value) => (after.get(value) ?? 0) > 0,
  );
  if (stillUsed.length > 0 && apply) {
    throw new Error(
      `Refusing to prune stage options still referenced by records: ${stillUsed.join(", ")}`,
    );
  }
  const keep = phase1.filter(
    (option) =>
      !dropCandidates.includes(option.value) || cleanValues.has(option.value),
  );
  report.phase3Prune = dropCandidates.filter(
    (value) => !cleanValues.has(value) && existingValues.has(value),
  );
  report.finalOptions = keep.map((option) => option.value);

  if (apply) {
    log(
      `phase 3: pruning ${(report.phase3Prune as string[]).length} options...`,
    );
    await writeOptions(
      client,
      fieldId,
      keep.map((option, index) => ({ ...option, position: index })),
    );
    report.stageCountsAfter = Object.fromEntries(await countByStage(client));
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
