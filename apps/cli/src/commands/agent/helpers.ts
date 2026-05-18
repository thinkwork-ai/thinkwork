import type { Client } from "@urql/core";
import { loadStageSession } from "../../cli-config.js";
import { resolveStage } from "../../lib/resolve-stage.js";
import { getGqlClient, gqlQuery } from "../../lib/gql-client.js";
import { printError, printMissingApiSessionError } from "../../ui.js";
import { AgentTenantBySlugDoc } from "./gql.js";

export interface AgentCliOptions {
  stage?: string;
  region?: string;
  tenant?: string;
}

export interface AgentCliContext {
  stage: string;
  region: string;
  client: Client;
  tenantId: string;
  principalId: string | null;
}

export async function resolveAgentContext(opts: AgentCliOptions): Promise<AgentCliContext> {
  const region = opts.region ?? "us-east-1";
  const stage = await resolveStage({ flag: opts.stage, region });
  const session = loadStageSession(stage);
  const { client, tenantSlug: ctxTenantSlug } = await getGqlClient({ stage, region });
  const principalId = session && session.kind === "cognito" ? session.principalId : null;

  const flagOrEnv = opts.tenant ?? process.env.THINKWORK_TENANT;
  if (flagOrEnv) {
    if (session?.tenantSlug === flagOrEnv && session.tenantId) {
      return { stage, region, client, tenantId: session.tenantId, principalId };
    }
    const data = await gqlQuery(client, AgentTenantBySlugDoc, { slug: flagOrEnv });
    if (!data.tenantBySlug) {
      printError(`Tenant "${flagOrEnv}" not found.`);
      process.exit(1);
    }
    return { stage, region, client, tenantId: data.tenantBySlug.id, principalId };
  }
  if (session?.tenantId) {
    return { stage, region, client, tenantId: session.tenantId, principalId };
  }
  if (ctxTenantSlug) {
    const data = await gqlQuery(client, AgentTenantBySlugDoc, { slug: ctxTenantSlug });
    if (data.tenantBySlug) {
      return { stage, region, client, tenantId: data.tenantBySlug.id, principalId };
    }
  }
  printMissingApiSessionError(stage, session !== null);
  process.exit(1);
}

export function fmtIso(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}
