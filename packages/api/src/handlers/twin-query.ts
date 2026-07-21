import {
  ExecuteOpenCypherQueryCommand,
  NeptunedataClient,
} from "@aws-sdk/client-neptunedata";
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
  const endpoint = process.env.NEPTUNE_ENDPOINT ?? "";
  const port = process.env.NEPTUNE_PORT ?? "8182";
  if (!endpoint) throw new Error("NEPTUNE_ENDPOINT is not configured");
  return (client ??= new NeptunedataClient({
    endpoint: `https://${endpoint}:${port}`,
  }));
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
  try {
    const response = await neptune().send(
      new ExecuteOpenCypherQueryCommand({
        openCypherQuery: compiled.query,
        parameters: JSON.stringify(compiled.parameters),
      }),
    );
    const results = Array.isArray((response as { results?: unknown }).results)
      ? ((response as { results: Array<Record<string, unknown>> }).results ??
        [])
      : [];
    return { ok: true, results };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[twin-query] execution failed", {
      tenantId: event.tenantId,
      kind: event.request.kind,
      error: message,
    });
    return { ok: false, reason: "unavailable", detail: message };
  }
};
