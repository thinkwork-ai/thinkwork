#!/usr/bin/env npx tsx
/**
 * Hard-delete everything the LastMile import created in TEI's Twenty, so the
 * task-first import can start from a clean workspace.
 *
 * Two disjoint sets are destroyed:
 *   1. Records carrying a migration `sourceId` (companies, people,
 *      opportunities, opportunityProducts, notes, attachments).
 *   2. Companies with NO sourceId whose `createdBy.source` is WORKFLOW — the
 *      domain-named companies ("cox.net") that Twenty's stock
 *      "Create company when adding a new person" workflow invented on every
 *      person insert, mislinking 21,989 of 24,028 migrated people.
 *
 * `destroy*` is permanent (unlike `delete*`, which soft-deletes). Nothing else
 * in the workspace is touched: records without a sourceId that were not
 * workflow-created are never candidates, and neither are workspace members.
 *
 * Usage:
 *   npx tsx scripts/purge-lastmile-import.ts            # dry-run: counts only
 *   npx tsx scripts/purge-lastmile-import.ts --apply    # destroy
 */

import process from "node:process";

import {
  COMPANY,
  NOTE,
  OPPORTUNITY,
  OPPORTUNITY_PRODUCT,
  PERSON,
  type EntityShape,
} from "./lib/load-records";
import { chunk, TwentyClient, normalizeBaseUrl } from "./lib/twenty-client";

const ATTACHMENT: EntityShape = {
  singular: "attachment",
  plural: "attachments",
  capSingular: "Attachment",
  capPlural: "Attachments",
};

/** Children before parents: relations block a parent destroy otherwise. */
const SOURCE_ID_ENTITIES: EntityShape[] = [
  ATTACHMENT,
  NOTE,
  OPPORTUNITY_PRODUCT,
  OPPORTUNITY,
  PERSON,
  COMPANY,
];

const PAGE = 100;
/** Twenty caps a mutation's affected records (clientConfig: 100). */
const DESTROY_BATCH = 60;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function log(message: string): void {
  process.stderr.write(`${message}\n`);
}

async function collectIds(
  client: TwentyClient,
  entity: EntityShape,
  filter: Record<string, unknown>,
  extraNodeFields = "",
): Promise<string[]> {
  const ids: string[] = [];
  let after: string | null = null;
  for (;;) {
    const data: {
      [plural: string]: {
        edges: Array<{ node: { id: string } }>;
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    } = await client.requestWithRetry(
      "/graphql",
      `query PurgeList${entity.capPlural}($filter: ${entity.capSingular}FilterInput, $after: String) {
        ${entity.plural}(filter: $filter, first: ${PAGE}, after: $after) {
          edges { node { id ${extraNodeFields} } cursor }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { filter, ...(after ? { after } : {}) },
    );
    ids.push(...data[entity.plural].edges.map((edge) => edge.node.id));
    if (!data[entity.plural].pageInfo.hasNextPage) break;
    after = data[entity.plural].pageInfo.endCursor;
  }
  return ids;
}

async function destroyIds(
  client: TwentyClient,
  entity: EntityShape,
  ids: string[],
): Promise<{ destroyed: number; failed: string[] }> {
  let destroyed = 0;
  const failed: string[] = [];
  for (const batch of chunk(ids, DESTROY_BATCH)) {
    try {
      await client.requestOnce(
        "/graphql",
        `mutation Purge${entity.capPlural}($filter: ${entity.capSingular}FilterInput!) {
          destroy${entity.capPlural}(filter: $filter) { id }
        }`,
        { filter: { id: { in: batch } } },
      );
      destroyed += batch.length;
    } catch (error) {
      failed.push(
        error instanceof Error ? error.message.slice(0, 200) : String(error),
      );
    }
  }
  return { destroyed, failed };
}

async function main(): Promise<void> {
  const apply = process.argv.slice(2).includes("--apply");
  const client = new TwentyClient({
    baseUrl: normalizeBaseUrl(requireEnv("TWENTY_PUBLIC_URL")),
    authToken: requireEnv("TWENTY_API_KEY"),
  });

  const report: Record<string, unknown> = { mode: apply ? "apply" : "dry-run" };

  for (const entity of SOURCE_ID_ENTITIES) {
    log(`scanning ${entity.plural} with a sourceId...`);
    let ids: string[];
    try {
      ids = await collectIds(client, entity, { sourceId: { is: "NOT_NULL" } });
    } catch (error) {
      // opportunityProduct may not exist yet on this workspace.
      report[entity.plural] = {
        skipped:
          error instanceof Error ? error.message.slice(0, 120) : "unknown",
      };
      continue;
    }
    if (!apply) {
      report[entity.plural] = { wouldDestroy: ids.length };
      continue;
    }
    const result = await destroyIds(client, entity, ids);
    report[entity.plural] = result;
    log(`destroyed ${result.destroyed} ${entity.plural}`);
  }

  // Workflow-created domain companies: no sourceId, createdBy.source WORKFLOW.
  log("scanning workflow-created companies (no sourceId)...");
  const workflowCompanies = await collectIds(
    client,
    COMPANY,
    { sourceId: { is: "NULL" }, createdBy: { source: { eq: "WORKFLOW" } } },
    "name",
  );
  if (!apply) {
    report.workflowCompanies = { wouldDestroy: workflowCompanies.length };
  } else {
    const result = await destroyIds(client, COMPANY, workflowCompanies);
    report.workflowCompanies = result;
    log(`destroyed ${result.destroyed} workflow-created companies`);
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
