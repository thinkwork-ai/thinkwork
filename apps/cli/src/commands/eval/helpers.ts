import type { Client } from "@urql/core";
import { loadStageSession } from "../../cli-config.js";
import { resolveStage } from "../../lib/resolve-stage.js";
import { getGqlClient } from "../../lib/gql-client.js";
import { gqlQuery } from "../../lib/gql-client.js";
import { printError, printMissingApiSessionError } from "../../ui.js";
import { TenantBySlugDoc } from "./gql.js";

export interface EvalCliOptions {
  stage?: string;
  region?: string;
  tenant?: string;
}

export interface EvalCliContext {
  stage: string;
  region: string;
  client: Client;
  tenantId: string;
  tenantSlug: string;
}

export async function resolveEvalContext(opts: EvalCliOptions): Promise<EvalCliContext> {
  const region = opts.region ?? "us-east-1";
  const stage = await resolveStage({ flag: opts.stage, region });
  const session = loadStageSession(stage);
  const { client, tenantSlug: ctxTenantSlug } = await getGqlClient({ stage, region });

  const flagOrEnv = opts.tenant ?? process.env.THINKWORK_TENANT;
  if (flagOrEnv) {
    if (session?.tenantSlug === flagOrEnv && session.tenantId) {
      return { stage, region, client, tenantId: session.tenantId, tenantSlug: flagOrEnv };
    }
    const data = await gqlQuery(client, TenantBySlugDoc, { slug: flagOrEnv });
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
    };
  }

  if (session?.tenantId && session.tenantSlug) {
    return {
      stage,
      region,
      client,
      tenantId: session.tenantId,
      tenantSlug: session.tenantSlug,
    };
  }

  if (ctxTenantSlug) {
    const data = await gqlQuery(client, TenantBySlugDoc, { slug: ctxTenantSlug });
    if (data.tenantBySlug) {
      return {
        stage,
        region,
        client,
        tenantId: data.tenantBySlug.id,
        tenantSlug: data.tenantBySlug.slug,
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

export function fmtPercent(value: number | null | undefined): string {
  if (value == null) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

export function fmtUsd(value: number | null | undefined): string {
  if (value == null) return "—";
  return `$${value.toFixed(4)}`;
}

export function fmtStatus(status: string | null | undefined): string {
  return status ?? "—";
}

export function isTerminalStatus(status: string | null | undefined): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}
