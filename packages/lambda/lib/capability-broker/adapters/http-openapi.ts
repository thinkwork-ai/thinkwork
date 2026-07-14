/**
 * HTTP/OpenAPI capability adapter (THINK-280 U5 — R5, R7, R8, R9, R10; AE7).
 *
 * Turns an admitted `read`/effectful HTTP operation contract into exactly one
 * bounded provider request. Everything that determines the destination — method,
 * host, path, fixed query, credential placement — comes from the contract's
 * CLOSED `targetScope.resourceSelector`, never from authored input. Authored
 * input can only fill the contract-declared query parameters (validated against
 * `inputSchema`), so the adapter CANNOT be steered to an arbitrary URL, host,
 * or method.
 *
 * Guarantees:
 *   - host/path/method are contract-fixed; a resolved URL that does not match
 *     the declared host or method is refused (`adapter_error`, non-retryable);
 *   - input and the projected output are schema-validated fail-closed;
 *   - the response body is read under a hard byte cap and projected to the
 *     declared safe fields — never an unbounded inline body;
 *   - `deadlineEpochMs` drives an abort signal; a non-idempotent operation is
 *     tried exactly once (never auto-retried);
 *   - rate-limit / timeout / credential / schema failures map to typed
 *     retryability with GENERIC messages (no provider body, header, or secret),
 *     scrubbed through the routine output redactor with the resolved
 *     credentials as known secret sources.
 *
 * The bounded fetch (injectable `fetchImpl`/`sleep`, retry ladder) is modeled on
 * `packages/api/src/lib/wiki/google-places-client.ts`, extended with the
 * byte-capped read that client lacks and a deadline-derived abort.
 */

import type {
  BrokerErrorCategory,
  CanonicalJson,
  OperationContract,
} from "@thinkwork/capability-contracts";

import { createRoutineOutputRedactor } from "../../../routine-output-redactor.js";
import type {
  AdapterDispatchContext,
  AdapterDispatchOutcome,
  CapabilityAdapter,
} from "./registry.js";
import { projectToSchema, validateAgainstSchema } from "./schema-validate.js";

/** Absolute ceiling on bytes read from a provider response, regardless of contract. */
const HARD_READ_CAP_BYTES = 1024 * 1024;
/** Contract inline ceiling mirrored here so the adapter never emits an oversize body. */
const INLINE_CAP_BYTES = 64 * 1024;

/**
 * The HTTP binding encoded in `targetScope.resourceSelector` for an
 * `http_openapi` operation. Fail-closed parsed — anything malformed refuses
 * the whole dispatch.
 */
interface HttpBinding {
  method: string;
  host: string;
  /**
   * Closed-scope path template. Owner/repo are baked in; the only variable
   * segments are `{placeholder}` tokens bound by {@link pathParams} to a typed,
   * URL-encoded input value (integers only in the reference contracts), so no
   * authored input can inject an authority, extra segment, or traversal.
   */
  path: string;
  /** `{placeholder}` → authored-input key. Values are encodeURIComponent-escaped. */
  pathParams: Record<string, string>;
  /** Fixed query params always applied. */
  fixedQuery: Record<string, string>;
  /** Names of query params the authored input MAY supply (nothing else is read). */
  allowedQuery: string[];
  /**
   * Credential injection descriptor, or `null` for a credential-less PUBLIC
   * binding (e.g. an unauthenticated read-only GitHub REST endpoint). A public
   * operation admitted with no `credential` in its resourceSelector dispatches
   * with no auth header/param — never a placeholder or empty secret.
   */
  credential: {
    name: string;
    field: string;
    placement: "header" | "query";
    /** Header name (placement=header) or query key (placement=query). */
    param: string;
    /** Optional scheme prefix, e.g. "Bearer". */
    scheme?: string;
  } | null;
  /** Max bytes of the projected inline result before a durable ref/failure. */
  maxResponseBytes: number;
  onExceed: "durable" | "fail";
}

export interface DurableSink {
  /** Persist an oversized body and return an opaque platform reference. */
  put(input: {
    tenantId: string;
    operationRef: string;
    body: CanonicalJson;
  }): Promise<{ ref: string; byteLength: number }>;
}

export interface HttpOpenapiAdapterOptions {
  /** Injection seam for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Injection seam for tests. Defaults to setTimeout-backed sleep. */
  sleep?: (ms: number) => Promise<void>;
  /** Backoff ladder (ms) per retry attempt. Default [200, 500, 1000]. */
  backoffMs?: number[];
  /** Optional sink for oversized responses when the contract says `durable`. */
  durableSink?: DurableSink;
}

export function createHttpOpenapiAdapter(
  opts: HttpOpenapiAdapterOptions = {},
): CapabilityAdapter {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const backoffMs = opts.backoffMs ?? [200, 500, 1000];

  return {
    kind: "http_openapi",
    async dispatch(
      ctx: AdapterDispatchContext,
    ): Promise<AdapterDispatchOutcome> {
      // A redactor over the resolved credentials so no message can echo a secret.
      const redactor = createRoutineOutputRedactor(
        Object.values(ctx.credentials ?? {}),
      );
      const scrub = (m: string) => redactor.redact(m);

      // 1. Parse the closed-scope HTTP binding (fail-closed).
      const binding = parseHttpBinding(ctx.contract);
      if (!binding) {
        return failed(
          "adapter_error",
          scrub("operation is not a valid closed-scope HTTP binding"),
          false,
        );
      }

      // 2. Validate authored input against the contract input schema.
      const inputViolations = validateAgainstSchema(
        ctx.contract.inputSchema,
        ctx.input,
      );
      if (inputViolations.length > 0) {
        return failed(
          "invalid_request",
          scrub("input failed schema validation"),
          false,
        );
      }

      // 3. Resolve the credential handle (already resolved by the broker). A
      //    public credential-less binding skips this — no secret is required or
      //    injected.
      let secret: string | undefined;
      if (binding.credential) {
        const cred = (ctx.credentials ?? {})[binding.credential.name];
        const raw = cred ? cred[binding.credential.field] : undefined;
        if (typeof raw !== "string" || raw.length === 0) {
          return failed(
            "readiness_blocked",
            scrub("bound credential is unavailable"),
            false,
          );
        }
        secret = raw;
      }

      // 4. Build the request URL from the CONTRACT binding + allowed input query
      //    params only. Host/path/method never come from authored input; only
      //    typed, URL-encoded path params bind to declared placeholders.
      const inputMap = (ctx.input ?? {}) as Record<string, unknown>;
      let resolvedPath = binding.path;
      for (const [placeholder, inputKey] of Object.entries(
        binding.pathParams,
      )) {
        const raw = inputMap[inputKey];
        if (
          (typeof raw !== "string" && typeof raw !== "number") ||
          String(raw).length === 0
        ) {
          return failed(
            "invalid_request",
            scrub("missing bound path parameter"),
            false,
          );
        }
        resolvedPath = resolvedPath.replace(
          `{${placeholder}}`,
          encodeURIComponent(String(raw)),
        );
      }
      if (/\{[^}]+\}/.test(resolvedPath)) {
        return failed(
          "adapter_error",
          scrub("unbound path placeholder in contract"),
          false,
        );
      }
      let url: URL;
      try {
        url = new URL(`https://${binding.host}${resolvedPath}`);
      } catch {
        return failed(
          "adapter_error",
          scrub("contract host/path is invalid"),
          false,
        );
      }
      // Re-assert the resolved URL still matches the declared host — defense in
      // depth against a path that smuggles an authority.
      if (url.hostname !== binding.host) {
        return failed(
          "adapter_error",
          scrub("resolved URL host does not match the contract"),
          false,
        );
      }
      for (const [k, v] of Object.entries(binding.fixedQuery)) {
        url.searchParams.set(k, v);
      }
      for (const key of binding.allowedQuery) {
        const v = inputMap[key];
        if (v !== undefined) url.searchParams.set(key, String(v));
      }

      // 5. Credential placement (skipped entirely for a public binding).
      const headers: Record<string, string> = { Accept: "application/json" };
      if (binding.credential && secret) {
        if (binding.credential.placement === "header") {
          headers[binding.credential.param] = binding.credential.scheme
            ? `${binding.credential.scheme} ${secret}`
            : secret;
        } else {
          url.searchParams.set(binding.credential.param, secret);
        }
      }

      // 6. Idempotency governs retry: non-idempotent operations run exactly once.
      const canRetry = ctx.contract.idempotency !== "non_idempotent";
      const maxAttempts = canRetry ? backoffMs.length + 1 : 1;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const remainingMs = ctx.deadlineEpochMs - Date.now();
        if (remainingMs <= 0) {
          return failed(
            "timeout",
            scrub("provider deadline exceeded"),
            canRetry,
          );
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), remainingMs);
        let res: Response;
        try {
          res = await fetchImpl(url.toString(), {
            method: binding.method,
            headers,
            signal: controller.signal,
          });
        } catch (err) {
          clearTimeout(timer);
          if (isAbort(err)) {
            return failed(
              "timeout",
              scrub("provider request timed out"),
              canRetry,
            );
          }
          // Network/DNS/transport — retryable if idempotent.
          if (attempt < maxAttempts - 1) {
            await sleep(backoffMs[attempt] ?? 1000);
            continue;
          }
          return failed(
            "provider_error",
            scrub("provider request failed"),
            canRetry,
          );
        }
        clearTimeout(timer);

        if (res.status === 200) {
          return await handleSuccess(ctx, binding, res, scrub);
        }
        if (res.status === 401 || res.status === 403) {
          return failed(
            "readiness_blocked",
            scrub("provider rejected the credential"),
            false,
          );
        }
        if (res.status === 429) {
          if (attempt < maxAttempts - 1) {
            await sleep(backoffMs[attempt] ?? 1000);
            continue;
          }
          return failed(
            "rate_limited",
            scrub("provider rate limited the request"),
            canRetry,
          );
        }
        if (res.status >= 500) {
          if (attempt < maxAttempts - 1) {
            await sleep(backoffMs[attempt] ?? 1000);
            continue;
          }
          return failed(
            "provider_error",
            scrub("provider returned a server error"),
            canRetry,
          );
        }
        // Other 4xx — non-retryable, generic.
        return failed(
          "provider_error",
          scrub("provider rejected the request"),
          false,
        );
      }
      return failed(
        "provider_error",
        scrub("provider request exhausted retries"),
        canRetry,
      );
    },
  };

  async function handleSuccess(
    ctx: AdapterDispatchContext,
    binding: HttpBinding,
    res: Response,
    scrub: (m: string) => string,
  ): Promise<AdapterDispatchOutcome> {
    // Read under a hard byte cap so an unbounded body can never be buffered.
    let text: string;
    try {
      text = await readCapped(res, HARD_READ_CAP_BYTES);
    } catch {
      return failed(
        "adapter_error",
        scrub("response exceeded the hard read cap"),
        false,
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return failed(
        "adapter_error",
        scrub("response was not valid JSON"),
        false,
      );
    }

    // Project to ONLY the declared safe fields, then validate the projection.
    const projected = projectToSchema(ctx.contract.outputSchema, parsed);
    const outViolations = validateAgainstSchema(
      ctx.contract.outputSchema,
      projected,
    );
    if (outViolations.length > 0) {
      return failed(
        "adapter_error",
        scrub("response failed schema validation"),
        false,
      );
    }

    const bytes = Buffer.byteLength(JSON.stringify(projected), "utf8");
    const cap = Math.min(binding.maxResponseBytes, INLINE_CAP_BYTES);
    if (bytes > cap) {
      if (binding.onExceed === "durable" && opts.durableSink) {
        const stored = await opts.durableSink.put({
          tenantId: ctx.tenantId,
          operationRef: ctx.operationRef,
          body: projected,
        });
        return {
          status: "completed",
          durable: {
            kind: "s3",
            ref: stored.ref,
            contentType: "application/json",
            byteLength: stored.byteLength,
          },
        };
      }
      return failed(
        "adapter_error",
        scrub(
          "projected result exceeded the inline cap without a durable sink",
        ),
        false,
      );
    }
    return { status: "completed", data: projected };
  }
}

function failed(
  category: BrokerErrorCategory,
  message: string,
  retryable: boolean,
): AdapterDispatchOutcome {
  return { status: "failed", category, message, retryable };
}

function isAbort(err: unknown): boolean {
  return (
    !!err &&
    typeof err === "object" &&
    (err as { name?: string }).name === "AbortError"
  );
}

/** Read a response body as UTF-8, throwing once accumulated bytes exceed `cap`. */
async function readCapped(res: Response, cap: number): Promise<string> {
  const body = res.body;
  if (!body) {
    const t = await res.text();
    if (Buffer.byteLength(t, "utf8") > cap) throw new Error("over cap");
    return t;
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > cap) {
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
        throw new Error("over cap");
      }
      chunks.push(value);
    }
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
}

/** Fail-closed parse of an operation's closed-scope HTTP binding. */
function parseHttpBinding(contract: OperationContract): HttpBinding | null {
  if (contract.targetScope.kind !== "closed") return null;
  const sel = contract.targetScope.resourceSelector as unknown;
  if (!sel || typeof sel !== "object" || Array.isArray(sel)) return null;
  const s = sel as Record<string, unknown>;

  const method = s.method;
  const host = s.host;
  const path = s.path;
  if (typeof method !== "string" || method.length === 0) return null;
  if (typeof host !== "string" || host.length === 0) return null;
  if (typeof path !== "string" || !path.startsWith("/")) return null;

  const pathParams: Record<string, string> = {};
  if (s.pathParams !== undefined) {
    if (
      typeof s.pathParams !== "object" ||
      s.pathParams === null ||
      Array.isArray(s.pathParams)
    ) {
      return null;
    }
    for (const [k, v] of Object.entries(
      s.pathParams as Record<string, unknown>,
    )) {
      if (typeof v !== "string") return null;
      pathParams[k] = v;
    }
  }

  const fixedQuery: Record<string, string> = {};
  if (s.fixedQuery !== undefined) {
    if (
      typeof s.fixedQuery !== "object" ||
      s.fixedQuery === null ||
      Array.isArray(s.fixedQuery)
    ) {
      return null;
    }
    for (const [k, v] of Object.entries(
      s.fixedQuery as Record<string, unknown>,
    )) {
      if (typeof v !== "string") return null;
      fixedQuery[k] = v;
    }
  }

  const allowedQuery: string[] = [];
  if (s.allowedQuery !== undefined) {
    if (!Array.isArray(s.allowedQuery)) return null;
    for (const q of s.allowedQuery) {
      if (typeof q !== "string") return null;
      allowedQuery.push(q);
    }
  }

  // Credential is OPTIONAL: absent → a public, credential-less binding. Present
  // → fully validated (a partial credential descriptor is fail-closed, never a
  // silent public downgrade).
  let credential: HttpBinding["credential"] = null;
  if (s.credential !== undefined) {
    const c = s.credential as Record<string, unknown> | undefined;
    if (!c || typeof c !== "object" || Array.isArray(c)) return null;
    const placement = c.placement;
    const name = c.name;
    const field = c.field;
    const param = c.param;
    if (placement !== "header" && placement !== "query") return null;
    if (
      typeof name !== "string" ||
      typeof field !== "string" ||
      typeof param !== "string"
    ) {
      return null;
    }
    credential = {
      name,
      field,
      placement,
      param,
      scheme: typeof c.scheme === "string" ? c.scheme : undefined,
    };
  }

  const maxResponseBytes =
    typeof s.maxResponseBytes === "number" && s.maxResponseBytes > 0
      ? s.maxResponseBytes
      : INLINE_CAP_BYTES;
  const onExceed = s.onExceed === "durable" ? "durable" : "fail";

  return {
    method: method.toUpperCase(),
    host,
    path,
    pathParams,
    fixedQuery,
    allowedQuery,
    credential,
    maxResponseBytes,
    onExceed,
  };
}
