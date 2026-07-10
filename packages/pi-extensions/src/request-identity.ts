import {
  defineExtension,
  type ThinkworkExtension,
} from "./define-extension.js";

/**
 * Request identity for cost reconciliation (THINK-245 U4).
 *
 * Hook-only extension (no tools). Two jobs:
 *
 * 1. `before_provider_request` — stamp Bedrock Converse payloads with
 *    `requestMetadata` carrying the turn/trace identifiers. Bedrock echoes
 *    requestMetadata into model-invocation log records, which lets the
 *    trace-ledger reconciler match an invocation to its turn exactly
 *    (score-90 path) instead of by ambiguous model+time.
 * 2. `after_provider_response` — collect each response's
 *    `x-amzn-requestid` header. The host sends the collected ids in the
 *    finalize payload as `bedrock_request_ids`, giving the reconciler its
 *    exact score-100 match path.
 *
 * The identity values are opaque internal UUIDs — never put user content or
 * PII in requestMetadata (it lands in AWS-side logs). Bedrock caps
 * requestMetadata at 16 entries with 256-char keys/values; two short UUID
 * entries are well inside that.
 */

export interface RequestIdentityArgs {
  /** thread_turn_id of the invocation this session run belongs to. */
  threadTurnId?: string | null;
  /** trace_id (trace run correlation id) when the host has one. */
  traceId?: string | null;
  /** Receives each Bedrock response requestId as it is observed. */
  onRequestId: (requestId: string) => void;
}

/** Bedrock Converse command inputs are the only payloads that accept
 * requestMetadata — recognize them by shape rather than provider name so
 * non-Bedrock providers (whose APIs reject unknown fields) are left alone. */
function isBedrockConversePayload(
  payload: unknown,
): payload is Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return false;
  }
  const record = payload as Record<string, unknown>;
  return typeof record.modelId === "string" && "inferenceConfig" in record;
}

export function createRequestIdentityExtension(
  args: RequestIdentityArgs,
): ThinkworkExtension {
  const metadata: Record<string, string> = {};
  if (args.threadTurnId) metadata.thread_turn_id = args.threadTurnId;
  if (args.traceId) metadata.trace_id = args.traceId;

  return defineExtension({
    name: "request-identity",
    toolNames: [],
    register(pi) {
      if (Object.keys(metadata).length > 0) {
        pi.on("before_provider_request", (event) => {
          if (!isBedrockConversePayload(event.payload)) return undefined;
          const existing =
            event.payload.requestMetadata &&
            typeof event.payload.requestMetadata === "object"
              ? (event.payload.requestMetadata as Record<string, string>)
              : {};
          return {
            ...event.payload,
            requestMetadata: { ...existing, ...metadata },
          };
        });
      }
      pi.on("after_provider_response", (event) => {
        const requestId =
          event.headers["x-amzn-requestid"] ??
          event.headers["X-Amzn-Requestid"];
        if (typeof requestId === "string" && requestId) {
          args.onRequestId(requestId);
        }
      });
    },
  });
}
