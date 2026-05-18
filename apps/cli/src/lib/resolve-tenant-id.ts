/**
 * Shared "resolve a tenant ID for a GraphQL call" helper used by Phase 4+5
 * commands that all follow the same pattern. Earlier phases inlined this
 * per-command; consolidated here to reduce duplication.
 */

import type { Client } from "@urql/core";
import { graphql } from "../gql/index.js";
import { loadStageSession } from "../cli-config.js";
import { resolveStage } from "./resolve-stage.js";
import { getGqlClient, gqlQuery } from "./gql-client.js";
import { printError, printMissingApiSessionError } from "../ui.js";

const TenantBySlugForCmdDoc = graphql(`
  query CliCmdTenantBySlug($slug: String!) {
    tenantBySlug(slug: $slug) {
      id
    }
  }
`);

export interface TenantCliOptions {
  stage?: string;
  region?: string;
  tenant?: string;
}

export interface TenantCliContext {
  stage: string;
  region: string;
  client: Client;
  tenantId: string;
}

export async function resolveTenantContext(
  opts: TenantCliOptions,
): Promise<TenantCliContext> {
  const region = opts.region ?? "us-east-1";
  const stage = await resolveStage({ flag: opts.stage, region });
  const session = loadStageSession(stage);
  const { client, tenantSlug: ctxSlug } = await getGqlClient({ stage, region });

  const flagOrEnv = opts.tenant ?? process.env.THINKWORK_TENANT;
  if (flagOrEnv) {
    if (session?.tenantSlug === flagOrEnv && session.tenantId) {
      return { stage, region, client, tenantId: session.tenantId };
    }
    const data = await gqlQuery(client, TenantBySlugForCmdDoc, { slug: flagOrEnv });
    if (!data.tenantBySlug) {
      printError(`Tenant "${flagOrEnv}" not found.`);
      process.exit(1);
    }
    return { stage, region, client, tenantId: data.tenantBySlug.id };
  }
  if (session?.tenantId) {
    return { stage, region, client, tenantId: session.tenantId };
  }
  if (ctxSlug) {
    const data = await gqlQuery(client, TenantBySlugForCmdDoc, { slug: ctxSlug });
    if (data.tenantBySlug) {
      return { stage, region, client, tenantId: data.tenantBySlug.id };
    }
  }
  printMissingApiSessionError(stage, session !== null);
  process.exit(1);
}
