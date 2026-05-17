import type { Client } from "@urql/core";
import { loadStageSession } from "../../cli-config.js";
import { resolveStage } from "../../lib/resolve-stage.js";
import { getGqlClient, gqlQuery } from "../../lib/gql-client.js";
import { printError, printMissingApiSessionError } from "../../ui.js";
import { InboxTenantBySlugDoc } from "./gql.js";

export interface InboxCliOptions {
  stage?: string;
  region?: string;
  tenant?: string;
}

export interface InboxCliContext {
  stage: string;
  region: string;
  client: Client;
  tenantId: string;
  tenantSlug: string;
  /** Cognito principal ID when the session is OAuth-based; null on api-key sessions. */
  principalId: string | null;
}

export async function resolveInboxContext(
  opts: InboxCliOptions,
): Promise<InboxCliContext> {
  const region = opts.region ?? "us-east-1";
  const stage = await resolveStage({ flag: opts.stage, region });
  const session = loadStageSession(stage);
  const { client, tenantSlug: ctxTenantSlug } = await getGqlClient({ stage, region });

  const flagOrEnv = opts.tenant ?? process.env.THINKWORK_TENANT;
  const principalId = session && session.kind === "cognito" ? session.principalId : null;

  if (flagOrEnv) {
    if (session?.tenantSlug === flagOrEnv && session.tenantId) {
      return {
        stage,
        region,
        client,
        tenantId: session.tenantId,
        tenantSlug: flagOrEnv,
        principalId,
      };
    }
    const data = await gqlQuery(client, InboxTenantBySlugDoc, { slug: flagOrEnv });
    if (!data.tenantBySlug) {
      printError(`Tenant "${flagOrEnv}" not found.`);
      process.exit(1);
    }
    return {
      stage,
      region,
      client,
      tenantId: data.tenantBySlug.id,
      tenantSlug: data.tenantBySlug.slug,
      principalId,
    };
  }

  if (session?.tenantId && session.tenantSlug) {
    return {
      stage,
      region,
      client,
      tenantId: session.tenantId,
      tenantSlug: session.tenantSlug,
      principalId,
    };
  }

  if (ctxTenantSlug) {
    const data = await gqlQuery(client, InboxTenantBySlugDoc, { slug: ctxTenantSlug });
    if (data.tenantBySlug) {
      return {
        stage,
        region,
        client,
        tenantId: data.tenantBySlug.id,
        tenantSlug: data.tenantBySlug.slug,
        principalId,
      };
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

export function fmtAge(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const ageMs = Date.now() - d.getTime();
  const minutes = Math.floor(ageMs / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

export function fmtRequester(
  type: string | null | undefined,
  id: string | null | undefined,
): string {
  if (!id) return "—";
  if (!type) return id;
  return `${type}:${id.slice(0, 8)}`;
}
