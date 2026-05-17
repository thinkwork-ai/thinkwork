import type { Client } from "@urql/core";
import { loadStageSession } from "../../cli-config.js";
import { resolveStage } from "../../lib/resolve-stage.js";
import { getGqlClient, gqlQuery } from "../../lib/gql-client.js";
import { printMissingApiSessionError } from "../../ui.js";
import { printError } from "../../ui.js";
import { ThreadTenantBySlugDoc } from "./gql.js";

export interface ThreadCliOptions {
  stage?: string;
  region?: string;
  tenant?: string;
}

export interface ThreadCliContext {
  stage: string;
  region: string;
  client: Client;
  tenantId: string;
  tenantSlug: string;
  /** Cognito principal ID when the session is OAuth-based; null on api-key sessions. */
  principalId: string | null;
}

export async function resolveThreadContext(
  opts: ThreadCliOptions,
): Promise<ThreadCliContext> {
  const region = opts.region ?? "us-east-1";
  const stage = await resolveStage({ flag: opts.stage, region });
  const session = loadStageSession(stage);
  const { client, tenantSlug: ctxTenantSlug } = await getGqlClient({ stage, region });

  const flagOrEnv = opts.tenant ?? process.env.THINKWORK_TENANT;
  const principalId =
    session && session.kind === "cognito" ? session.principalId : null;

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
    const data = await gqlQuery(client, ThreadTenantBySlugDoc, { slug: flagOrEnv });
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
    const data = await gqlQuery(client, ThreadTenantBySlugDoc, { slug: ctxTenantSlug });
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

export function fmtAssignee(
  assigneeType: string | null | undefined,
  assigneeId: string | null | undefined,
): string {
  if (!assigneeId) return "—";
  if (!assigneeType) return assigneeId;
  return `${assigneeType}:${assigneeId}`;
}

/**
 * `me` is allowed as an --assignee value. Resolve it from the session's
 * Cognito principal ID at call time.
 */
export function resolveAssigneeFilter(
  raw: string | undefined,
  principalId: string | null,
): string | undefined {
  if (!raw) return undefined;
  if (raw !== "me") return raw;
  if (!principalId) {
    printError(
      "--assignee me requires a Cognito session. Run `thinkwork login --stage <s>` (api-key sessions have no user identity).",
    );
    process.exit(1);
  }
  return principalId;
}

/**
 * Accept either a thread ID (alphanumeric with possible prefix) or a numeric
 * issue-style number. Returns one of two shapes the caller can dispatch on.
 */
export function parseIdOrNumber(
  raw: string,
): { kind: "id"; id: string } | { kind: "number"; number: number } {
  if (/^\d+$/.test(raw)) {
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n <= 0) {
      printError(`Invalid thread number "${raw}". Expected a positive integer.`);
      process.exit(1);
    }
    return { kind: "number", number: n };
  }
  return { kind: "id", id: raw };
}
