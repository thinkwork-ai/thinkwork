/**
 * Canonical operation-identity composer (THINK-280 U8).
 *
 * ONE function projects a signed capability definition version into the
 * operation identity + safe annotations every surface must agree on. The
 * Inspector, the internal working search, the external MCP search facade, and
 * the broker/Routine/execution/Artifact evidence all reference the SAME
 * `{ twcap, contractHash }` for a given (definition version, operationId).
 *
 * The parity assertion (`assertOperationIdentityParity`) follows one operation
 * identity through every surface and fails on any projection drift — a single
 * source of truth for "the platform never disagrees with itself about what an
 * operation is".
 *
 * This module derives everything from the signed descriptor via
 * `@thinkwork/capability-contracts`. It never queries a second registry and
 * never reinterprets the contract taxonomy.
 */

import {
  formatTwcapRef,
  operationContractHash,
  operationExecutabilityViolations,
  type CapabilityDescriptor,
  type OperationContract,
} from "@thinkwork/capability-contracts";

const LOG_PREFIX = "[capability-operation-identity]";

/** Minimal identity of a logical capability definition (twcap segments). */
export interface DefinitionIdentityInput {
  namespace: string;
  class: string;
  slug: string;
}

/** The stored version row fields the composer reads (structurally typed). */
export interface DefinitionVersionInput {
  id: string;
  version: number;
  descriptor_json: unknown;
  contract_hashes_json: unknown;
}

/**
 * The exact identity + safe annotations one operation projects. Every surface
 * that names this operation MUST reproduce `twcap` and `contractHash`
 * byte-for-byte; the annotation fields are the permitted read-only summary
 * (never credential refs, never private provenance).
 */
export interface CanonicalOperationIdentity {
  operationId: string;
  /** Exact portable twcap://... reference — the parity anchor. */
  twcap: string;
  /** sha256 hex of the signed operation contract — the second parity anchor. */
  contractHash: string;
  definitionVersionId: string;
  version: number;
  namespace: string;
  class: string;
  slug: string;
  // ── Safe annotations (effect / principal / data / budget) ──
  effect: OperationContract["effect"];
  principalModes: OperationContract["principalModes"];
  approvalPolicy: OperationContract["approvalPolicy"];
  reversibility: OperationContract["reversibility"];
  idempotency: OperationContract["idempotency"];
  inputDataClass: OperationContract["inputDataClass"];
  outputDataClass: OperationContract["outputDataClass"];
  costClass: OperationContract["costClass"];
  latencyClass: OperationContract["latencyClass"];
  outputClass: OperationContract["outputClass"];
  /** False when a security-relevant annotation withholds automated execution. */
  executable: boolean;
  withheldReasons: string[];
  summary: string;
}

function coerceDescriptor(value: unknown): CapabilityDescriptor | null {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !Array.isArray((value as CapabilityDescriptor).operations)
  ) {
    return null;
  }
  return value as CapabilityDescriptor;
}

/**
 * Project every operation of an admitted version into its canonical identity.
 *
 * The stored `contract_hashes_json` map is authoritative for the searchable
 * projection, but each hash is CROSS-CHECKED against a fresh
 * `operationContractHash(op)` recomputation — a mismatch means the stored
 * projection drifted from the signed contract, so that operation is dropped
 * (fail closed) with a server-side log rather than emitting a wrong identity.
 * One malformed operation never takes down the whole version.
 */
export function projectOperationIdentities(
  identity: DefinitionIdentityInput,
  row: DefinitionVersionInput,
): CanonicalOperationIdentity[] {
  const descriptor = coerceDescriptor(row.descriptor_json);
  if (!descriptor) {
    console.warn(
      `${LOG_PREFIX} version ${row.id}: descriptor_json is not a descriptor`,
    );
    return [];
  }
  const hashes =
    row.contract_hashes_json && typeof row.contract_hashes_json === "object"
      ? (row.contract_hashes_json as Record<string, unknown>)
      : {};

  const out: CanonicalOperationIdentity[] = [];
  for (const op of descriptor.operations) {
    try {
      const stored = hashes[op.operationId];
      const recomputed = operationContractHash(op);
      if (typeof stored !== "string" || stored !== recomputed) {
        console.warn(
          `${LOG_PREFIX} version ${row.id} op '${op.operationId}': contract-hash drift (stored=${
            typeof stored === "string" ? stored.slice(0, 12) : "<missing>"
          }, signed=${recomputed.slice(0, 12)}) — dropped`,
        );
        continue;
      }
      const withheldReasons = operationExecutabilityViolations(op);
      out.push({
        operationId: op.operationId,
        twcap: formatTwcapRef({
          namespace: identity.namespace,
          class: identity.class,
          slug: identity.slug,
          version: String(row.version),
          operationId: op.operationId,
          contractHash: recomputed,
        }),
        contractHash: recomputed,
        definitionVersionId: row.id,
        version: row.version,
        namespace: identity.namespace,
        class: identity.class,
        slug: identity.slug,
        effect: op.effect,
        principalModes: [...op.principalModes],
        approvalPolicy: op.approvalPolicy,
        reversibility: op.reversibility,
        idempotency: op.idempotency,
        inputDataClass: op.inputDataClass,
        outputDataClass: op.outputDataClass,
        costClass: op.costClass,
        latencyClass: op.latencyClass,
        outputClass: op.outputClass,
        executable: withheldReasons.length === 0,
        withheldReasons,
        summary: op.summary,
      });
    } catch (err) {
      console.warn(
        `${LOG_PREFIX} version ${row.id} op '${op.operationId}': ${
          err instanceof Error ? err.message : String(err)
        } — dropped`,
      );
    }
  }
  return out;
}

/**
 * Resolve exactly one operation identity from a version, or null if the
 * operation is absent / drifted. The single lookup all surfaces route through.
 */
export function projectOperationIdentity(
  identity: DefinitionIdentityInput,
  row: DefinitionVersionInput,
  operationId: string,
): CanonicalOperationIdentity | null {
  return (
    projectOperationIdentities(identity, row).find(
      (op) => op.operationId === operationId,
    ) ?? null
  );
}

// ---------------------------------------------------------------------------
// Parity assertion — one identity, seven surfaces
// ---------------------------------------------------------------------------

/**
 * The seven surfaces that must agree on an operation's identity (R2/R16):
 *   1. inspector            — capabilityInspector projected operation item
 *   2. internalSearch       — capability-control-service capability_search
 *   3. brokerEvidence       — capability_broker_calls.{operation_ref,contract_hash}
 *   4. routineDependency    — Routine proposal dependency reference
 *   5. executionDetail      — headless executor evidence
 *   6. artifactLineage      — Artifact lineage capability reference
 *   7. externalSearch       — /mcp/capabilities search result
 *
 * Each surface contributes just its `{ twcap, contractHash }`.
 */
export const PARITY_SURFACES = [
  "inspector",
  "internalSearch",
  "brokerEvidence",
  "routineDependency",
  "executionDetail",
  "artifactLineage",
  "externalSearch",
] as const;
export type ParitySurface = (typeof PARITY_SURFACES)[number];

export interface SurfaceOperationReference {
  twcap: string;
  contractHash: string;
}

export type ParitySurfaceInputs = Partial<
  Record<ParitySurface, SurfaceOperationReference | null | undefined>
>;

export interface ParityResult {
  ok: boolean;
  /** The canonical reference every present surface was compared against. */
  canonical: SurfaceOperationReference;
  /** Surfaces that were provided and matched. */
  agreed: ParitySurface[];
  /** Surfaces that were provided but drifted, with what they emitted. */
  drift: Array<{
    surface: ParitySurface;
    got: SurfaceOperationReference;
    reason: "twcap_mismatch" | "contract_hash_mismatch" | "both_mismatch";
  }>;
  /** Surfaces not supplied (absent, not a failure — recorded for coverage). */
  missing: ParitySurface[];
}

/**
 * Compare each supplied surface reference against the canonical identity.
 * Pure + throw-free so callers (tests and, later, a live tracer probe) can
 * report structured drift.
 */
export function checkOperationIdentityParity(
  canonical: SurfaceOperationReference,
  surfaces: ParitySurfaceInputs,
): ParityResult {
  const agreed: ParitySurface[] = [];
  const drift: ParityResult["drift"] = [];
  const missing: ParitySurface[] = [];

  for (const surface of PARITY_SURFACES) {
    const got = surfaces[surface];
    if (!got) {
      missing.push(surface);
      continue;
    }
    const twcapOk = got.twcap === canonical.twcap;
    const hashOk = got.contractHash === canonical.contractHash;
    if (twcapOk && hashOk) {
      agreed.push(surface);
    } else {
      drift.push({
        surface,
        got: { twcap: got.twcap, contractHash: got.contractHash },
        reason:
          !twcapOk && !hashOk
            ? "both_mismatch"
            : !twcapOk
              ? "twcap_mismatch"
              : "contract_hash_mismatch",
      });
    }
  }

  return {
    ok: drift.length === 0,
    canonical: {
      twcap: canonical.twcap,
      contractHash: canonical.contractHash,
    },
    agreed,
    drift,
    missing,
  };
}

/**
 * Throwing form — the assertion a parity test/tracer calls. Fails loudly on
 * ANY drift, naming the surface and the diverging value.
 */
export function assertOperationIdentityParity(
  canonical: SurfaceOperationReference,
  surfaces: ParitySurfaceInputs,
): ParityResult {
  const result = checkOperationIdentityParity(canonical, surfaces);
  if (!result.ok) {
    const detail = result.drift
      .map(
        (d) =>
          `${d.surface}: ${d.reason} (got twcap=${d.got.twcap} contract=${d.got.contractHash})`,
      )
      .join("; ");
    throw new Error(
      `capability operation-identity parity drift for ${canonical.twcap}: ${detail}`,
    );
  }
  return result;
}
