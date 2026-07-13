/**
 * Capability broker adapter registry (THINK-280 U3) — INERT.
 *
 * The registry is the ONLY seam through which a permitted call reaches a
 * provider. In this slice it ships EMPTY: no live adapter is registered, so a
 * fully authorized call to an uninstalled adapter returns typed
 * `failed/unavailable_adapter` evidence with no side effect. U5 implements
 * concrete adapters against the {@link CapabilityAdapter} interface below and
 * registers them via {@link createAdapterRegistry}; nothing else in the broker
 * changes when it does.
 */

import type {
  AdapterKind,
  BrokerErrorCategory,
  CanonicalJson,
  DurableResultReference,
  OperationContract,
  PrincipalMode,
} from "@thinkwork/capability-contracts";

/** Everything an adapter needs to dispatch one provider operation. */
export interface AdapterDispatchContext {
  tenantId: string;
  /** String form of the twcap operation reference. */
  operationRef: string;
  /** The signed operation contract (effect, schemas, target scope, …). */
  contract: OperationContract;
  /** Validated request input (already canonicalizable). */
  input: CanonicalJson;
  principal: { mode: PrincipalMode; subjectId: string };
  /**
   * Vault references ONLY (secret-manager/tenant-credential ids) — never
   * secret material. The broker resolves the real secret behind the reference
   * inside the adapter boundary, out of this context. Empty in the inert slice.
   */
  credentialRefs: Record<string, string>;
  /** Wall-clock budget for the provider call, epoch milliseconds. */
  deadlineEpochMs: number;
}

/**
 * Normalized adapter outcome. `completed` returns validated inline data OR a
 * durable reference (never both); `accepted` identifies how the trusted
 * runtime polls/cancels; `failed` carries a typed category. An adapter never
 * throws to the broker — it returns one of these.
 */
export type AdapterDispatchOutcome =
  | {
      status: "completed";
      data?: CanonicalJson;
      durable?: DurableResultReference;
    }
  | { status: "accepted"; pollToken: string; cancellable: boolean }
  | {
      status: "failed";
      category: BrokerErrorCategory;
      message: string;
      retryable: boolean;
    };

export interface CapabilityAdapter {
  readonly kind: AdapterKind;
  /**
   * Dispatch one operation. MUST NOT throw for provider/validation errors —
   * return a `failed` outcome. MUST NOT produce a side effect when it cannot
   * complete cleanly.
   */
  dispatch(ctx: AdapterDispatchContext): Promise<AdapterDispatchOutcome>;
}

export interface AdapterRegistry {
  lookup(kind: AdapterKind): CapabilityAdapter | undefined;
}

/** The shipped registry: intentionally empty. No provider dispatch is possible. */
export function createEmptyAdapterRegistry(): AdapterRegistry {
  return { lookup: () => undefined };
}

/** Build a registry from concrete adapters (U5+ and tests). */
export function createAdapterRegistry(
  adapters: readonly CapabilityAdapter[],
): AdapterRegistry {
  const byKind = new Map<AdapterKind, CapabilityAdapter>();
  for (const adapter of adapters) {
    if (byKind.has(adapter.kind)) {
      throw new Error(
        `capability-broker: duplicate adapter for kind ${adapter.kind}`,
      );
    }
    byKind.set(adapter.kind, adapter);
  }
  return { lookup: (kind) => byKind.get(kind) };
}
