/**
 * refreshCanvasData (Living Artifacts THINK-145 U6, R6/R8).
 *
 * User-triggered headless data-refresh: re-execute the saved tool calls behind
 * a canvas's bound widgets and update their freshness, WITHOUT an agent turn.
 * Refresh is a read-side freshness action — ANY space member (or draft-thread
 * participant) may trigger it, so access is gated with `assertCanvasAccess`
 * read, not the member-or-above WRITE gate (a viewer can ask for fresh data;
 * the R9 per-user-OAuth exclusion still applies inside the Lambda).
 *
 * Wire: invoke the `canvas-refresh` Lambda with `InvocationType:
 * "RequestResponse"` (never fire-and-forget — the caller must see accept/reject
 * and per-binding outcomes). The function name follows the established
 * `thinkwork-${STAGE}-api-canvas-refresh` convention; the ARN is built at
 * runtime from STAGE + region + account (graphql-http's env is at the 4 KB
 * ceiling, so no new env var).
 */

import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import { db, eq, artifacts } from "../../utils.js";
import { requireTenantMember } from "../core/authz.js";
import { assertCanvasAccess } from "../../../lib/artifacts/canvas-access.js";

interface RefreshCanvasDataArgs {
  artifactId: string;
  partId?: string | null;
}

interface LambdaBindingResult {
  bindingId: string;
  partId: string;
  elementId: string;
  outcome: string;
  quality: string;
  reason: string | null;
}

interface LambdaResultPayload {
  ok: boolean;
  artifactId: string;
  error?: string;
  bindings?: LambdaBindingResult[];
}

interface RefreshResult {
  artifactId: string;
  dispatched: boolean;
  errorMessage: string | null;
  bindings: Array<{
    bindingId: string;
    partId: string;
    elementId: string;
    outcome: string;
    quality: string;
    reason: string | null;
  }>;
}

export const refreshCanvasData = async (
  _parent: unknown,
  args: RefreshCanvasDataArgs,
  ctx: GraphQLContext,
): Promise<RefreshResult> => {
  const artifactId = requiredString(args.artifactId, "artifactId");
  const partId = args.partId?.trim() || undefined;

  const [row] = await db
    .select()
    .from(artifacts)
    .where(eq(artifacts.id, artifactId));
  if (!row) {
    throw new GraphQLError("Canvas artifact not found", {
      extensions: { code: "NOT_FOUND" },
    });
  }
  await requireTenantMember(ctx, row.tenant_id);
  // Read-side gate: refresh is a freshness action any member may take.
  await assertCanvasAccess(ctx, row, "read");

  const stage = process.env.STAGE;
  const region = process.env.AWS_REGION || "us-east-1";
  const accountId = process.env.AWS_ACCOUNT_ID;
  if (!stage || !accountId) {
    throw new GraphQLError(
      "Cannot dispatch refresh: STAGE and AWS_ACCOUNT_ID env vars are required on graphql-http.",
      { extensions: { code: "INTERNAL_SERVER_ERROR" } },
    );
  }
  const functionArn = `arn:aws:lambda:${region}:${accountId}:function:thinkwork-${stage}-api-canvas-refresh`;

  const payload = {
    tenantId: row.tenant_id,
    artifactId,
    partId,
    trigger: "user" as const,
  };

  const { LambdaClient, InvokeCommand } = await import("@aws-sdk/client-lambda");
  const lambda = new LambdaClient({});
  const res = await lambda.send(
    new InvokeCommand({
      FunctionName: functionArn,
      InvocationType: "RequestResponse",
      Payload: new TextEncoder().encode(JSON.stringify(payload)),
    }),
  );

  if (res.FunctionError) {
    const detail = res.Payload
      ? new TextDecoder().decode(res.Payload).slice(0, 500)
      : res.FunctionError;
    return {
      artifactId,
      dispatched: false,
      errorMessage: `Refresh Lambda error: ${detail}`,
      bindings: [],
    };
  }

  let parsed: LambdaResultPayload | null = null;
  if (res.Payload) {
    try {
      parsed = JSON.parse(
        new TextDecoder().decode(res.Payload),
      ) as LambdaResultPayload;
    } catch {
      parsed = null;
    }
  }

  if (!parsed || parsed.ok !== true) {
    return {
      artifactId,
      dispatched: false,
      errorMessage: parsed?.error ?? "Refresh returned no result",
      bindings: [],
    };
  }

  return {
    artifactId,
    dispatched: true,
    errorMessage: null,
    bindings: (parsed.bindings ?? []).map((b) => ({
      bindingId: b.bindingId,
      partId: b.partId,
      elementId: b.elementId,
      // GraphQL enums are SCREAMING_CASE; the Lambda emits lowercase.
      outcome: b.outcome.toUpperCase(),
      quality: b.quality.toUpperCase(),
      reason: b.reason,
    })),
  };
};

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new GraphQLError(`refreshCanvasData ${field} is required`, {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  return value.trim();
}
