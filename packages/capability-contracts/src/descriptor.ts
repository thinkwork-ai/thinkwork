import {
  type CanonicalJson,
  canonicalSha256Hex,
  canonicalize,
} from "./canonical";

/**
 * Language-neutral capability descriptor contracts (THINK-280 U1).
 *
 * This module is shared by the API control plane, the capability broker, the
 * Pi host, Python SDK fixture generation, and the external MCP search facade.
 * It must stay free of DB, AWS, Pi, and transport dependencies.
 *
 * Validators are hand-rolled fail-closed parsers (repo convention — see
 * packages/api/src/lib/capabilities/definition-schemas.ts): anything missing,
 * unknown, or malformed is a violation, never a default.
 */

export const OPERATION_EFFECTS = [
  "none",
  "read",
  "create",
  "update",
  "delete",
  "execute",
] as const;
export type OperationEffect = (typeof OPERATION_EFFECTS)[number];

export const PRINCIPAL_MODES = ["requester", "agent_owner", "service"] as const;
export type PrincipalMode = (typeof PRINCIPAL_MODES)[number];

export const DATA_CLASSES = [
  "public",
  "internal",
  "confidential",
  "restricted",
  "credential",
] as const;
export type DataClass = (typeof DATA_CLASSES)[number];

export const COST_CLASSES = [
  "free",
  "low",
  "medium",
  "high",
  "unknown",
] as const;
export type CostClass = (typeof COST_CLASSES)[number];

export const LATENCY_CLASSES = [
  "interactive",
  "long_running",
  "asynchronous",
  "unknown",
] as const;
export type LatencyClass = (typeof LATENCY_CLASSES)[number];

export const OUTPUT_CLASSES = [
  "inline",
  "artifact",
  "stream",
  "unknown",
] as const;
export type OutputClass = (typeof OUTPUT_CLASSES)[number];

export const APPROVAL_POLICIES = ["never", "once", "always"] as const;
export type ApprovalPolicy = (typeof APPROVAL_POLICIES)[number];

export const REVERSIBILITY_CLASSES = [
  "reversible",
  "compensable",
  "irreversible",
] as const;
export type ReversibilityClass = (typeof REVERSIBILITY_CLASSES)[number];

export const IDEMPOTENCY_CLASSES = [
  "idempotent",
  "conditionally_idempotent",
  "non_idempotent",
] as const;
export type IdempotencyClass = (typeof IDEMPOTENCY_CLASSES)[number];

export const BINDING_READINESS_STATES = [
  "pending_setup",
  "verifying",
  "ready",
  "degraded",
  "revoked",
] as const;
export type BindingReadinessState = (typeof BINDING_READINESS_STATES)[number];

export type TargetScope =
  | { kind: "closed"; resourceSelector: CanonicalJson }
  | { kind: "open_world" };

export interface OperationContract {
  /** Provider-native operation identifier, unique within the definition version. */
  operationId: string;
  summary: string;
  effect: OperationEffect;
  targetScope: TargetScope;
  reversibility: ReversibilityClass;
  /** Required when reversibility is `compensable`: how the effect is compensated. */
  compensation?: string;
  idempotency: IdempotencyClass;
  principalModes: PrincipalMode[];
  approvalPolicy: ApprovalPolicy;
  inputSchema: CanonicalJson;
  outputSchema: CanonicalJson;
  inputDataClass: DataClass;
  outputDataClass: DataClass;
  costClass: CostClass;
  latencyClass: LatencyClass;
  outputClass: OutputClass;
}

export const ADAPTER_KINDS = ["http_openapi", "platform", "mcp"] as const;
export type AdapterKind = (typeof ADAPTER_KINDS)[number];

export interface DescriptorProvenance {
  /** Official provider source URLs backing the definition's material claims. */
  sourceUrls: string[];
  /** Opaque references to stored research/admission evidence rows. */
  evidenceRefs: string[];
  admittedBy?: string;
  admittedAt?: string;
}

/**
 * Immutable definition layer: identity, version, provenance, adapter and
 * binding requirements, and the signed operation contracts. Grants,
 * readiness, and principal selection live in the invocation projection and
 * are deliberately excluded so the descriptor fingerprint never moves when
 * runtime state does.
 */
export interface CapabilityDescriptor {
  namespace: string;
  class: string;
  slug: string;
  version: string;
  adapter: { kind: AdapterKind; config: CanonicalJson };
  bindingRequirements: {
    /** Credential kinds the binding must supply (vault references only). */
    credentialKinds: string[];
    principalModes: PrincipalMode[];
  };
  provenance: DescriptorProvenance;
  operations: OperationContract[];
}

export class CapabilityContractError extends Error {
  readonly violations: string[];
  constructor(violations: string[]) {
    super(violations.join("; "));
    this.name = "CapabilityContractError";
    this.violations = violations;
  }
}

const SEGMENT_RE = /^[a-z0-9][a-z0-9-]{0,127}$/;
const VERSION_RE = /^[0-9]+$/;
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

function isEnum<T extends readonly string[]>(
  values: T,
  v: unknown,
): v is T[number] {
  return typeof v === "string" && (values as readonly string[]).includes(v);
}

/**
 * Return every reason an operation contract is not eligible for automated
 * execution. An empty array means executable. Missing or `unknown`
 * security-relevant annotations withhold the operation (fail closed); a
 * `credential` output classification is always withheld in v1.
 */
export function operationExecutabilityViolations(
  op: OperationContract,
): string[] {
  const violations: string[] = [];
  if (op.costClass === "unknown") violations.push("costClass is unknown");
  if (op.latencyClass === "unknown") violations.push("latencyClass is unknown");
  if (op.outputClass === "unknown") violations.push("outputClass is unknown");
  if (
    op.outputDataClass === "credential" ||
    op.inputDataClass === "credential"
  ) {
    violations.push("credential data classification is not executable in v1");
  }
  if (op.principalModes.length === 0)
    violations.push("no accepted principal modes");
  if (op.reversibility === "compensable" && !op.compensation) {
    violations.push("compensable operation missing compensation");
  }
  return violations;
}

function validateOperation(
  op: unknown,
  path: string,
  violations: string[],
): void {
  if (typeof op !== "object" || op === null || Array.isArray(op)) {
    violations.push(`${path}: not an object`);
    return;
  }
  const o = op as Record<string, unknown>;
  if (
    typeof o.operationId !== "string" ||
    o.operationId.length === 0 ||
    o.operationId.length > 256
  ) {
    violations.push(`${path}.operationId: missing or invalid`);
  }
  if (typeof o.summary !== "string")
    violations.push(`${path}.summary: missing`);
  if (!isEnum(OPERATION_EFFECTS, o.effect))
    violations.push(`${path}.effect: invalid`);
  const scope = o.targetScope as Record<string, unknown> | undefined;
  if (!scope || (scope.kind !== "closed" && scope.kind !== "open_world")) {
    violations.push(`${path}.targetScope.kind: invalid`);
  } else if (scope.kind === "closed" && scope.resourceSelector === undefined) {
    violations.push(
      `${path}.targetScope.resourceSelector: required for closed scope`,
    );
  }
  if (!isEnum(REVERSIBILITY_CLASSES, o.reversibility)) {
    violations.push(`${path}.reversibility: invalid`);
  }
  if (!isEnum(IDEMPOTENCY_CLASSES, o.idempotency))
    violations.push(`${path}.idempotency: invalid`);
  if (
    !Array.isArray(o.principalModes) ||
    o.principalModes.some((m) => !isEnum(PRINCIPAL_MODES, m)) ||
    new Set(o.principalModes).size !== o.principalModes.length
  ) {
    violations.push(`${path}.principalModes: invalid`);
  }
  if (!isEnum(APPROVAL_POLICIES, o.approvalPolicy))
    violations.push(`${path}.approvalPolicy: invalid`);
  if (o.inputSchema === undefined)
    violations.push(`${path}.inputSchema: missing`);
  if (o.outputSchema === undefined)
    violations.push(`${path}.outputSchema: missing`);
  if (!isEnum(DATA_CLASSES, o.inputDataClass))
    violations.push(`${path}.inputDataClass: invalid`);
  if (!isEnum(DATA_CLASSES, o.outputDataClass))
    violations.push(`${path}.outputDataClass: invalid`);
  if (!isEnum(COST_CLASSES, o.costClass))
    violations.push(`${path}.costClass: invalid`);
  if (!isEnum(LATENCY_CLASSES, o.latencyClass))
    violations.push(`${path}.latencyClass: invalid`);
  if (!isEnum(OUTPUT_CLASSES, o.outputClass))
    violations.push(`${path}.outputClass: invalid`);
}

/** Fail-closed structural validation. Throws CapabilityContractError listing every violation. */
export function assertValidDescriptor(
  value: unknown,
): asserts value is CapabilityDescriptor {
  const violations: string[] = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CapabilityContractError(["descriptor: not an object"]);
  }
  const d = value as Record<string, unknown>;
  for (const field of ["namespace", "class", "slug"] as const) {
    if (typeof d[field] !== "string" || !SEGMENT_RE.test(d[field] as string)) {
      violations.push(`${field}: must match ${SEGMENT_RE}`);
    }
  }
  if (typeof d.version !== "string" || !VERSION_RE.test(d.version)) {
    violations.push("version: must be a decimal string");
  }
  const adapter = d.adapter as Record<string, unknown> | undefined;
  if (
    !adapter ||
    !isEnum(ADAPTER_KINDS, adapter.kind) ||
    adapter.config === undefined
  ) {
    violations.push("adapter: invalid");
  }
  const binding = d.bindingRequirements as Record<string, unknown> | undefined;
  if (
    !binding ||
    !Array.isArray(binding.credentialKinds) ||
    binding.credentialKinds.some((k) => typeof k !== "string") ||
    !Array.isArray(binding.principalModes) ||
    binding.principalModes.some((m) => !isEnum(PRINCIPAL_MODES, m))
  ) {
    violations.push("bindingRequirements: invalid");
  }
  const prov = d.provenance as Record<string, unknown> | undefined;
  if (
    !prov ||
    !Array.isArray(prov.sourceUrls) ||
    prov.sourceUrls.some((u) => typeof u !== "string") ||
    !Array.isArray(prov.evidenceRefs) ||
    prov.evidenceRefs.some((r) => typeof r !== "string")
  ) {
    violations.push("provenance: invalid");
  }
  if (!Array.isArray(d.operations) || d.operations.length === 0) {
    violations.push("operations: must be a non-empty array");
  } else {
    d.operations.forEach((op, i) =>
      validateOperation(op, `operations[${i}]`, violations),
    );
    const ids = (d.operations as Array<{ operationId?: unknown }>).map(
      (o) => o.operationId,
    );
    if (new Set(ids).size !== ids.length)
      violations.push("operations: duplicate operationId");
  }
  if (violations.length > 0) throw new CapabilityContractError(violations);
}

/**
 * Contract hash covers exactly the signed operation contract — nothing from
 * the surrounding definition, grants, or readiness.
 */
export function operationContractHash(op: OperationContract): string {
  return canonicalSha256Hex(op as unknown as CanonicalJson);
}

/**
 * Descriptor fingerprint over the immutable definition layer. Grants and
 * readiness are not part of CapabilityDescriptor by construction, so the
 * fingerprint is stable across runtime-state changes.
 */
export function descriptorFingerprint(
  descriptor: CapabilityDescriptor,
): string {
  return canonicalSha256Hex(descriptor as unknown as CanonicalJson);
}

/** Canonical bytes of a descriptor — the exact payload a signature covers. */
export function descriptorCanonicalBytes(
  descriptor: CapabilityDescriptor,
): string {
  return canonicalize(descriptor as unknown as CanonicalJson);
}

export interface TwcapReference {
  namespace: string;
  class: string;
  slug: string;
  version: string;
  operationId: string;
  contractHash: string;
}

/**
 * Portable opaque operation reference:
 * `twcap://<namespace>/<class>/<slug>/versions/<version>/operations/<percent-encoded-id>?contract=sha256:<hex>`
 * Structured fields remain authoritative; this form is for code and evidence.
 */
export function formatTwcapRef(ref: TwcapReference): string {
  const violations: string[] = [];
  for (const field of ["namespace", "class", "slug"] as const) {
    if (!SEGMENT_RE.test(ref[field]))
      violations.push(`${field}: must match ${SEGMENT_RE}`);
  }
  if (!VERSION_RE.test(ref.version))
    violations.push("version: must be a decimal string");
  if (ref.operationId.length === 0) violations.push("operationId: empty");
  if (!SHA256_HEX_RE.test(ref.contractHash))
    violations.push("contractHash: not sha256 hex");
  if (violations.length > 0) throw new CapabilityContractError(violations);
  return (
    `twcap://${ref.namespace}/${ref.class}/${ref.slug}` +
    `/versions/${ref.version}/operations/${encodeURIComponent(ref.operationId)}` +
    `?contract=sha256:${ref.contractHash}`
  );
}

/** Fail-closed parse of a twcap operation reference. */
export function parseTwcapRef(value: string): TwcapReference {
  const violations: string[] = [];
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CapabilityContractError(["twcap: not a URL"]);
  }
  if (url.protocol !== "twcap:") violations.push("twcap: wrong scheme");
  const namespace = url.hostname;
  const segments = url.pathname.split("/").filter((s) => s.length > 0);
  if (
    segments.length !== 6 ||
    segments[2] !== "versions" ||
    segments[4] !== "operations"
  ) {
    throw new CapabilityContractError([
      "twcap: path must be /<class>/<slug>/versions/<version>/operations/<id>",
    ]);
  }
  const [cls, slug, , version, , encodedOp] = segments as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  if (!SEGMENT_RE.test(namespace)) violations.push("twcap: invalid namespace");
  if (!SEGMENT_RE.test(cls)) violations.push("twcap: invalid class");
  if (!SEGMENT_RE.test(slug)) violations.push("twcap: invalid slug");
  if (!VERSION_RE.test(version)) violations.push("twcap: invalid version");
  let operationId = "";
  try {
    operationId = decodeURIComponent(encodedOp);
  } catch {
    violations.push("twcap: malformed percent-encoding in operation id");
  }
  if (operationId.length === 0) violations.push("twcap: empty operation id");
  const params = [...url.searchParams.keys()];
  const contract = url.searchParams.get("contract") ?? "";
  if (params.length !== 1 || params[0] !== "contract") {
    violations.push("twcap: exactly one `contract` query parameter required");
  }
  const hashMatch = /^sha256:([0-9a-f]{64})$/.exec(contract);
  if (!hashMatch)
    violations.push("twcap: contract must be sha256:<64 lowercase hex>");
  if (violations.length > 0) throw new CapabilityContractError(violations);
  return {
    namespace,
    class: cls,
    slug,
    version,
    operationId,
    contractHash: hashMatch![1]!,
  };
}
