/**
 * Server-authoritative idempotency for admin-skill mutations.
 *
 * Unit 4 of the thinkwork-admin skill plan. The thinkwork-admin Python
 * skill wraps ~15 onboarding mutations; the stamp-out-an-enterprise
 * recipe calls them in sequence. A transient failure mid-recipe should
 * be safely retryable by replaying the same steps without creating
 * duplicate tenants / agents / teams.
 *
 * Python passes raw inputs + an optional recipe-step `idempotencyKey`
 * string. Canonicalization + hashing are server-side only — there is
 * no cross-language hash-parity to maintain.
 *
 * Usage from a mutation resolver:
 *
 *   const loaded = await startOrLoadIdempotentMutation({
 *     tenantId, invokerUserId, mutationName: "createAgent",
 *     inputs: resolvedInputs, clientKey: args.idempotencyKey,
 *   });
 *   if (!loaded.isNew) {
 *     if (loaded.status === "succeeded") return loaded.resultJson;
 *     if (loaded.status === "failed") throw new ...(loaded.failureReason);
 *     // pending → in-flight; Unit 8 wrapper surfaces a retry-later shape.
 *     throw new ...("mutation in-flight, retry later");
 *   }
 *   try {
 *     const result = await ...perform the write...;
 *     await completeIdempotentMutation(loaded.id, result);
 *     return result;
 *   } catch (err) {
 *     await failIdempotentMutation(loaded.id, String(err));
 *     throw err;
 *   }
 */

import {
  db as defaultDb,
  eq,
  and,
  mutationIdempotency,
  hashResolvedInputs,
} from "../graphql/utils.js";

type DbOrTx = { select: typeof defaultDb.select };

export type MutationIdempotencyStatus = "pending" | "succeeded" | "failed";

export interface IdempotencyLoadNew {
  isNew: true;
  id: string;
  idempotencyKey: string;
  resolvedInputsHash: string;
}

export interface IdempotencyLoadExisting {
  isNew: false;
  id: string;
  status: MutationIdempotencyStatus;
  resultJson: unknown;
  failureReason: string | null;
}

export type IdempotencyLoadResult =
  | IdempotencyLoadNew
  | IdempotencyLoadExisting;

/**
 * Insert a new mutation_idempotency row or return the existing state for
 * a prior call with the same (tenant, invoker, mutation, key) composite.
 *
 * - `inputs` is canonicalized and hashed server-side. The hash is stored
 *   on every row (for audit/debug) regardless of whether the caller
 *   supplied its own key.
 * - When `clientKey` is omitted, the hash itself becomes the
 *   idempotency_key — so identical-input retries without a recipe-step
 *   key still deduplicate.
 * - When `clientKey` is supplied, it is used as the idempotency_key
 *   directly; the caller has opted into recipe-step-level dedup and is
 *   responsible for key uniqueness within the recipe.
 */
export async function startOrLoadIdempotentMutation(params: {
  tenantId: string;
  invokerUserId: string;
  mutationName: string;
  inputs: Record<string, unknown>;
  clientKey?: string | null;
  dbOrTx?: DbOrTx;
}): Promise<IdempotencyLoadResult> {
  const {
    tenantId,
    invokerUserId,
    mutationName,
    inputs,
    clientKey,
    dbOrTx = defaultDb,
  } = params;

  const resolvedInputsHash = hashResolvedInputs(inputs);
  const idempotencyKey =
    clientKey && clientKey.length > 0 ? clientKey : resolvedInputsHash;

  // FULL unique index means the ON CONFLICT target is straightforward —
  // no `where` clause needed (contrast with skill_runs' partial index,
  // which triggers Postgres 42P10 unless the ON CONFLICT predicate
  // matches the partial-index predicate).
  const inserted = await (dbOrTx as typeof defaultDb)
    .insert(mutationIdempotency)
    .values({
      tenant_id: tenantId,
      invoker_user_id: invokerUserId,
      mutation_name: mutationName,
      idempotency_key: idempotencyKey,
      resolved_inputs_hash: resolvedInputsHash,
      status: "pending",
    })
    .onConflictDoNothing({
      target: [
        mutationIdempotency.tenant_id,
        mutationIdempotency.invoker_user_id,
        mutationIdempotency.mutation_name,
        mutationIdempotency.idempotency_key,
      ],
    })
    .returning();

  if (inserted[0]) {
    return {
      isNew: true,
      id: inserted[0].id,
      idempotencyKey,
      resolvedInputsHash,
    };
  }

  // Conflict — load the existing row.
  const [existing] = await dbOrTx
    .select({
      id: mutationIdempotency.id,
      status: mutationIdempotency.status,
      result_json: mutationIdempotency.result_json,
      failure_reason: mutationIdempotency.failure_reason,
    })
    .from(mutationIdempotency)
    .where(
      and(
        eq(mutationIdempotency.tenant_id, tenantId),
        eq(mutationIdempotency.invoker_user_id, invokerUserId),
        eq(mutationIdempotency.mutation_name, mutationName),
        eq(mutationIdempotency.idempotency_key, idempotencyKey),
      ),
    );

  if (!existing) {
    // Race: the row we collided with was deleted between our insert
    // attempt and this select. Vanishingly unlikely without a cleanup
    // job (deferred to v1.1), but fail loud rather than silently
    // double-execute.
    throw new Error(
      "mutation_idempotency: conflict raised but no matching row found",
    );
  }

  return {
    isNew: false,
    id: existing.id,
    status: existing.status as MutationIdempotencyStatus,
    resultJson: existing.result_json ?? null,
    failureReason: existing.failure_reason,
  };
}

export async function completeIdempotentMutation(
  id: string,
  result: unknown,
  dbOrTx: DbOrTx = defaultDb,
): Promise<void> {
  await (dbOrTx as typeof defaultDb)
    .update(mutationIdempotency)
    .set({
      status: "succeeded",
      result_json: result as object,
      completed_at: new Date(),
    })
    .where(eq(mutationIdempotency.id, id));
}

export async function failIdempotentMutation(
  id: string,
  failureReason: string,
  dbOrTx: DbOrTx = defaultDb,
): Promise<void> {
  await (dbOrTx as typeof defaultDb)
    .update(mutationIdempotency)
    .set({
      status: "failed",
      failure_reason: failureReason.slice(0, 2000),
      completed_at: new Date(),
    })
    .where(eq(mutationIdempotency.id, id));
}

/**
 * Higher-level wrapper used by resolvers. Encapsulates the full flow:
 *
 *   1. Skip idempotency entirely when `tenantId` or `invokerUserId` is
 *      unresolvable — pre-Unit-1 callers, or cognito users whose JWT
 *      hasn't been bootstrapped. In that case `runWithIdempotency` just
 *      calls `fn()` and returns the result. Preserves existing admin SPA
 *      / CLI flows during the migration.
 *   2. Insert-or-load via `startOrLoadIdempotentMutation`. On `isNew=true`,
 *      run `fn()`, commit via `completeIdempotentMutation` on success,
 *      or `failIdempotentMutation` + rethrow on failure.
 *   3. On `isNew=false`:
 *        - `succeeded` → return the stored `resultJson` (typed by the caller).
 *        - `failed` → throw the stored `failureReason` as a fresh error so
 *          the caller sees the original failure class.
 *        - `pending` → throw a specific "in-flight" error so the admin
 *          skill can surface a retry-later refusal shape.
 *
 * `resultCoerce` lets the caller narrow the `unknown` result_json back
 * to its resolver's return type. Defaults to a pass-through cast.
 */
export class MutationInFlightError extends Error {
  constructor(public readonly idempotencyKey: string) {
    super(
      `mutation in-flight for idempotency key ${idempotencyKey} — retry shortly`,
    );
    this.name = "MutationInFlightError";
  }
}

export async function runWithIdempotency<T>(params: {
  tenantId: string | null;
  invokerUserId: string | null;
  mutationName: string;
  inputs: Record<string, unknown>;
  clientKey?: string | null;
  fn: () => Promise<T>;
  resultCoerce?: (raw: unknown) => T;
}): Promise<T> {
  const {
    tenantId,
    invokerUserId,
    mutationName,
    inputs,
    clientKey,
    fn,
    resultCoerce = (raw) => raw as T,
  } = params;

  // Skip idempotency when we can't identify the (tenant, invoker) pair.
  // Happens for non-apikey callers where resolveCallerUserId returns
  // null (unusual but possible during auth bootstrapping) — and we
  // never want to block the write on a missing invoker id.
  if (!tenantId || !invokerUserId) {
    return fn();
  }

  const loaded = await startOrLoadIdempotentMutation({
    tenantId,
    invokerUserId,
    mutationName,
    inputs,
    clientKey,
  });

  if (!loaded.isNew) {
    if (loaded.status === "succeeded") {
      return resultCoerce(loaded.resultJson);
    }
    if (loaded.status === "failed") {
      throw new Error(loaded.failureReason ?? "prior attempt failed");
    }
    // pending — rare without a cleanup job, but surfaces loudly so the
    // admin skill can emit retry_later.
    throw new MutationInFlightError(clientKey ?? loaded.id);
  }

  try {
    const result = await fn();
    await completeIdempotentMutation(loaded.id, result);
    return result;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await failIdempotentMutation(loaded.id, reason);
    throw err;
  }
}
