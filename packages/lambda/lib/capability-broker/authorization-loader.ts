/**
 * DB-backed capability-broker authorization loader (THINK-280 execution wiring).
 *
 * The broker RE-AUTHORIZES every call from freshly reloaded state — this module
 * IS that reload. It resolves the parsed `twcap://` operation reference to the
 * current admitted contract, adapter, credential binding, grant, approval, and
 * budget facts, and returns the {@link AuthorizationSnapshot} the pure policy
 * (`authorizeAction`) decides on. It NEVER trusts the session snapshot for
 * authorization; the session is an upper bound only.
 *
 * Fail-closed throughout: any missing/drifted row yields a snapshot that the
 * policy rejects (null operation/grant/binding), never an allow.
 *
 * Sourcing (see the schema map in capability-runtime.ts):
 *   - operation + currentContractHash + adapterKind → capability_definitions
 *     (namespace,class,slug) → capability_definition_versions (definition_id,
 *     version, lifecycle='admitted'); the operation is matched out of
 *     descriptor_json.operations and its hash recomputed + cross-checked against
 *     contract_hashes_json (drift → fail closed).
 *   - binding → capability_credential_bindings for (definition_version_id,
 *     principal_mode, service_principal_id | subject_user_id).
 *   - grant → derived from the pinned operation's own effect: a governed
 *     dependency grants exactly the operation it pins (contract-hash match
 *     already forecloses effect tampering).
 *   - approval → the operation contract's approvalPolicy; `satisfied` is false
 *     because this slice has no per-call approval mechanism, so any operation
 *     whose policy is not "never" fails closed (approval_required).
 *   - budget → the mint-time session budgets; an empty budget map imposes no
 *     limit (within limits), a populated one is honored.
 */

import { and, eq, isNull, or } from "drizzle-orm";
import {
  operationContractHash,
  type AdapterKind,
  type BindingReadinessState,
  type CapabilityDescriptor,
  type OperationContract,
  type OperationEffect,
  type PrincipalMode,
  type TwcapReference,
} from "@thinkwork/capability-contracts";
import type { getDb, schema as schemaBarrel } from "@thinkwork/database-pg";
import type {
  AuthorizationLoader,
  AuthorizationSnapshot,
} from "../../capability-broker.js";
import type { BrokerSessionState } from "./sessions.js";

type Db = ReturnType<typeof getDb>;
type Schema = typeof schemaBarrel;

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

function adapterKindOf(descriptor: CapabilityDescriptor): AdapterKind | null {
  const kind = descriptor.adapter?.kind;
  return kind === "http_openapi" || kind === "platform" || kind === "mcp"
    ? kind
    : null;
}

/** The subject the binding must match for the session's principal mode. */
function bindingSubjectFilter(
  bindings: Schema["capabilityCredentialBindings"],
  session: BrokerSessionState,
) {
  // A service session's subjectId is the service principal id; user modes match
  // the subject user id. Exact match only — no cross-mode fallback (R6).
  if (session.principalMode === "service") {
    return eq(bindings.service_principal_id, session.subjectId);
  }
  return eq(bindings.subject_user_id, session.subjectId);
}

/** Empty budgets impose no limit; a populated map is honored via `exhausted`. */
function evaluateBudget(budgets: Record<string, unknown>): {
  withinLimits: boolean;
  reason?: string;
} {
  const exhausted = budgets?.exhausted;
  if (exhausted === true) {
    return { withinLimits: false, reason: "budget_exhausted" };
  }
  return { withinLimits: true };
}

const DENIED: AuthorizationSnapshot = {
  definitionVersionId: null,
  operation: null,
  currentContractHash: null,
  adapterKind: null,
  grant: null,
  binding: null,
  approval: { policy: "always", satisfied: false },
  budget: { withinLimits: false, reason: "operation_unavailable" },
};

/**
 * Build the real DB-backed loader. Closes over `getDb`/`schema` so the handler
 * injects the live pg client and tests inject a fake `db`.
 */
export function createDrizzleAuthorizationLoader(deps: {
  db: Db;
  schema: Pick<
    Schema,
    | "capabilityDefinitions"
    | "capabilityDefinitionVersions"
    | "capabilityCredentialBindings"
  >;
}): AuthorizationLoader {
  const { db, schema } = deps;
  return async ({
    session,
    operationRef,
  }: {
    session: BrokerSessionState;
    operationRef: TwcapReference;
    rawOperation: string;
  }): Promise<AuthorizationSnapshot> => {
    // 1. Resolve the capability definition by its (namespace, class, slug)
    //    identity, scoped to this tenant or platform-global.
    const [definition] = await db
      .select()
      .from(schema.capabilityDefinitions)
      .where(
        and(
          eq(schema.capabilityDefinitions.namespace, operationRef.namespace),
          eq(schema.capabilityDefinitions.class, operationRef.class),
          eq(schema.capabilityDefinitions.slug, operationRef.slug),
          or(
            eq(schema.capabilityDefinitions.tenant_id, session.tenantId),
            isNull(schema.capabilityDefinitions.tenant_id),
          ),
        ),
      )
      .limit(1);
    if (!definition) return DENIED;

    // 2. Resolve the ADMITTED version at the pinned version number.
    const versionNumber = Number(operationRef.version);
    if (!Number.isInteger(versionNumber)) return DENIED;
    const [version] = await db
      .select()
      .from(schema.capabilityDefinitionVersions)
      .where(
        and(
          eq(schema.capabilityDefinitionVersions.definition_id, definition.id),
          eq(schema.capabilityDefinitionVersions.version, versionNumber),
        ),
      )
      .limit(1);
    if (!version || version.lifecycle !== "admitted") return DENIED;

    const descriptor = coerceDescriptor(version.descriptor_json);
    if (!descriptor) return DENIED;

    // 3. Match the operation out of the signed descriptor and recompute its
    //    contract hash, cross-checked against the stored hash map. Any drift
    //    fails closed (operation stays null → policy: operation_unavailable).
    const operation: OperationContract | undefined = descriptor.operations.find(
      (o) => o.operationId === operationRef.operationId,
    );
    if (!operation) return DENIED;

    let currentContractHash: string;
    try {
      currentContractHash = operationContractHash(operation);
    } catch {
      return DENIED;
    }
    const storedHashes =
      version.contract_hashes_json &&
      typeof version.contract_hashes_json === "object"
        ? (version.contract_hashes_json as Record<string, unknown>)
        : {};
    const stored = storedHashes[operationRef.operationId];
    if (typeof stored !== "string" || stored !== currentContractHash) {
      return DENIED;
    }

    const adapterKind = adapterKindOf(descriptor);

    // 4. Resolve the EXACT credential binding for this version + principal.
    const bindings = schema.capabilityCredentialBindings;
    const [bindingRow] = await db
      .select()
      .from(bindings)
      .where(
        and(
          eq(bindings.definition_version_id, version.id),
          eq(bindings.principal_mode, session.principalMode),
          bindingSubjectFilter(bindings, session),
        ),
      )
      .limit(1);

    const binding: AuthorizationSnapshot["binding"] = bindingRow
      ? {
          id: bindingRow.id,
          readiness: bindingRow.readiness as BindingReadinessState,
          principalMode: bindingRow.principal_mode as PrincipalMode,
          subjectId:
            session.principalMode === "service"
              ? (bindingRow.service_principal_id ?? "")
              : (bindingRow.subject_user_id ?? ""),
          credentialRefs:
            bindingRow.credential_refs_json &&
            typeof bindingRow.credential_refs_json === "object"
              ? (bindingRow.credential_refs_json as Record<string, string>)
              : {},
        }
      : null;

    // 5. Grant: the governed dependency grants exactly the pinned operation's
    //    effect. Contract-hash match (step 3) already forecloses tampering with
    //    the effect, so this is not a blanket allow — a different effect implies
    //    a different contract hash, which would have failed closed above.
    const grant: { allowedEffects: OperationEffect[] } = {
      allowedEffects: [operation.effect],
    };

    // 6. Approval: honor the contract's policy. No per-call approval mechanism
    //    exists in this slice, so any non-"never" operation fails closed.
    const approval: AuthorizationSnapshot["approval"] = {
      policy: operation.approvalPolicy,
      satisfied: false,
    };

    const budget = evaluateBudget(session.budgets ?? {});

    return {
      definitionVersionId: version.id,
      operation,
      currentContractHash,
      adapterKind,
      grant,
      binding,
      approval,
      budget,
    };
  };
}
