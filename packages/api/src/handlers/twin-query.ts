import {
  ExecuteOpenCypherQueryCommand,
  NeptunedataClient,
} from "@aws-sdk/client-neptunedata";
import { getConfig } from "@thinkwork/runtime-config";
import {
  compileTwinQuery,
  TwinCompileError,
  type TwinRequest,
} from "../lib/twin/query-compiler.js";

/**
 * Twin graph-query Lambda (Company Brain U6 / KTD-6) — the ONLY read path
 * to Neptune on the product side. VPC-attached (neptune-client SG); reader
 * IAM. Accepts TYPED requests only — compilation happens here, inside the
 * boundary, so no caller (including a compromised one) can submit query
 * text. Kept a separate handler from graphql-http (the plan's default —
 * graphql-http stays outside the VPC unless analyst egress is armed).
 */
export interface TwinQueryEvent {
  tenantId?: string;
  request?: TwinRequest;
}

let client: NeptunedataClient | null = null;

function neptune(): NeptunedataClient {
  const endpoint = getConfig("NEPTUNE_ENDPOINT") ?? "";
  const port = process.env.NEPTUNE_PORT ?? "8182";
  if (!endpoint) throw new Error("NEPTUNE_ENDPOINT is not configured");
  return (client ??= new NeptunedataClient({
    endpoint: `https://${endpoint}:${port}`,
  }));
}

/** Raw-console result cap and per-query time budget (THINK-327 U5). */
export const RAW_RESULT_CAP = 100;
export const RAW_TIMEOUT_MS = 10_000;

/** A Neptune graph value (node/relationship) — anything carrying a `~id`. */
function graphElementId(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const id = (value as Record<string, unknown>)["~id"];
  return typeof id === "string" ? id : null;
}

export interface RawPostFilterResult {
  rows: unknown[];
  redactedCount: number;
  unfenced: boolean;
}

/**
 * Tenant fence for raw results (KTD-5): walk every value RECURSIVELY —
 * lists (collect(...)), map projections, and path-shaped arrays included —
 * and drop + count any node/relationship whose `~id` lacks the caller's
 * `t#<tenant>#` prefix. Scalars can't be attributed to a tenant, so they
 * pass through and flip `unfenced` — the caller renders the caveat.
 */
export function postFilterRawResults(
  results: Array<Record<string, unknown>>,
  tenantId: string,
): RawPostFilterResult {
  const prefix = `t#${tenantId}#`;
  let redactedCount = 0;
  let unfenced = false;

  const walk = (value: unknown): { keep: boolean; value: unknown } => {
    const elementId = graphElementId(value);
    if (elementId !== null) {
      if (!elementId.startsWith(prefix)) {
        redactedCount += 1;
        return { keep: false, value: undefined };
      }
      return { keep: true, value };
    }
    if (Array.isArray(value)) {
      return {
        keep: true,
        value: value.flatMap((item) => {
          const walked = walk(item);
          return walked.keep ? [walked.value] : [];
        }),
      };
    }
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) {
        const walked = walk(item);
        // A redacted element inside a map projection leaves the key out
        // rather than nulling it — absence is unambiguous.
        if (walked.keep) out[key] = walked.value;
      }
      return { keep: true, value: out };
    }
    // Scalar projection — passes the fence unattributed.
    if (value !== null && value !== undefined) unfenced = true;
    return { keep: true, value };
  };

  const rows = results.flatMap((row) => {
    const out: Record<string, unknown> = {};
    for (const [column, item] of Object.entries(row)) {
      const walked = walk(item);
      if (walked.keep) out[column] = walked.value;
    }
    return Object.keys(out).length > 0 ? [out] : [];
  });

  return { rows, redactedCount, unfenced };
}

export const handler = async (event: TwinQueryEvent = {}) => {
  if (!event.tenantId || !event.request || typeof event.request !== "object") {
    return { ok: false, reason: "invalid_request", detail: "missing fields" };
  }
  let compiled;
  try {
    compiled = compileTwinQuery(event.request, { tenantId: event.tenantId });
  } catch (err) {
    return {
      ok: false,
      reason: "invalid_request",
      detail: err instanceof TwinCompileError ? err.message : "compile_failed",
    };
  }
  const isRaw = event.request.kind === "raw";
  try {
    // Raw console queries get a hard time budget so a pathological scan
    // returns a typed `unavailable` instead of hanging the console.
    const abort = isRaw ? new AbortController() : null;
    const timer = abort
      ? setTimeout(() => abort.abort(), RAW_TIMEOUT_MS)
      : null;
    let response;
    try {
      response = await neptune().send(
        new ExecuteOpenCypherQueryCommand({
          openCypherQuery: compiled.query,
          parameters: JSON.stringify(compiled.parameters),
        }),
        abort ? { abortSignal: abort.signal } : undefined,
      );
    } finally {
      if (timer) clearTimeout(timer);
    }
    const results = Array.isArray((response as { results?: unknown }).results)
      ? ((response as { results: Array<Record<string, unknown>> }).results ??
        [])
      : [];
    if (!isRaw) {
      return { ok: true, results };
    }
    const truncated = results.length > RAW_RESULT_CAP;
    const filtered = postFilterRawResults(
      truncated ? results.slice(0, RAW_RESULT_CAP) : results,
      event.tenantId,
    );
    return {
      ok: true,
      results: filtered.rows,
      redactedCount: filtered.redactedCount,
      unfenced: filtered.unfenced,
      truncated,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[twin-query] execution failed", {
      tenantId: event.tenantId,
      kind: event.request.kind,
      error: message,
    });
    return {
      ok: false,
      reason: "unavailable",
      detail:
        isRaw && message.toLowerCase().includes("abort") ? "timeout" : message,
    };
  }
};
