/**
 * Capability broker adapter registry (THINK-280 U3, U5).
 *
 * The registry is the ONLY seam through which a permitted call reaches a
 * provider. In the U3 slice it shipped EMPTY. U5 adds the concrete
 * `http_openapi` and `platform` adapters and a {@link buildCapabilityAdapterRegistry}
 * the broker handler calls. The registry stays inert in production because the
 * broker's authorization loader still denies every request until a later unit
 * wires it — adapters are exercised via injected deps in tests.
 *
 * MCP is DEFERRED: {@link createAdapterRegistry} accepts a future `mcp` adapter
 * registration, but no `mcp` adapter is implemented in this unit. It ships with
 * the first MCP-backed Connection admission, preserving tool-level errors,
 * structured content, and server tool allowlists — without making MCP the
 * common internal model.
 */

import type {
  AdapterKind,
  BrokerErrorCategory,
  CanonicalJson,
  DurableResultReference,
  OperationContract,
  PrincipalMode,
} from "@thinkwork/capability-contracts";

import type { ResolvedCredential } from "../credential-resolver.js";
import { createHttpOpenapiAdapter } from "./http-openapi.js";
import {
  createPlatformAdapter,
  type PlatformArtifactWriter,
} from "./platform.js";

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
   * secret material. Retained for EVIDENCE (the broker records which references
   * a call used) and correlation; the adapter never resolves a reference from
   * this map.
   */
  credentialRefs: Record<string, string>;
  /**
   * Already-resolved credential handles, keyed by the SAME logical name as
   * {@link credentialRefs}. The broker resolves references through the
   * credential-resolution seam BEFORE dispatch and passes only these handles;
   * the adapter never sees or resolves a vault reference. Resolved material
   * never enters the evidence row.
   */
  credentials: Record<string, ResolvedCredential>;
  /** Broker-side provenance for attributing durable side effects. */
  provenance: {
    /** Source Routine execution row id, if any. */
    routineExecutionId: string | null;
    /** Source thread turn id, if any. */
    threadTurnId: string | null;
    /** Durable broker evidence (call) row id for this dispatch. */
    brokerCallId: string;
  };
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

export interface BuildAdapterRegistryDeps {
  /** Narrow, DB-backed Artifact writer for the platform adapter. */
  artifactWriter: PlatformArtifactWriter;
}

/**
 * The production registry the broker handler installs: the `http_openapi` and
 * `platform` adapters. MCP is intentionally absent (deferred to the first
 * MCP-backed Connection). Callers pass the DB-backed platform artifact writer;
 * the HTTP adapter uses global fetch.
 */
export function buildCapabilityAdapterRegistry(
  deps: BuildAdapterRegistryDeps,
): AdapterRegistry {
  return createAdapterRegistry([
    createHttpOpenapiAdapter(),
    createPlatformAdapter({ artifactWriter: deps.artifactWriter }),
    // NOTE: no `mcp` adapter — deferred to the unit that first admits an
    // MCP-backed Connection. `createAdapterRegistry` already accepts one.
  ]);
}
