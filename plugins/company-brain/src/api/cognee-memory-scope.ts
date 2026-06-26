export const COGNEE_MEMORY_SCOPE_VERSION = "v1" as const;

export type CogneeMemoryScopeKind = "user" | "space";

export type CogneeMemoryScopeRef =
  | {
      tenantId: string;
      kind: "user";
      userId: string;
    }
  | {
      tenantId: string;
      kind: "space";
      spaceId: string;
    };

export interface CogneeMemoryScope {
  version: typeof COGNEE_MEMORY_SCOPE_VERSION;
  kind: CogneeMemoryScopeKind;
  tenantId: string;
  ownerId: string;
  sourceKind: "user_memory" | "space_memory";
  sourceRef: string;
  datasetName: string;
  nodeSets: string[];
  metadata: {
    memory_scope_version: typeof COGNEE_MEMORY_SCOPE_VERSION;
    memory_scope_kind: CogneeMemoryScopeKind;
    tenant_id: string;
    owner_id: string;
  };
}

export function buildCogneeMemoryScope(
  ref: CogneeMemoryScopeRef,
): CogneeMemoryScope {
  const tenantToken = scopeToken(ref.tenantId, "tenantId");
  const ownerId = ref.kind === "user" ? ref.userId : ref.spaceId;
  const ownerToken = scopeToken(ownerId, `${ref.kind}Id`);
  const sourceKind = ref.kind === "user" ? "user_memory" : "space_memory";

  return {
    version: COGNEE_MEMORY_SCOPE_VERSION,
    kind: ref.kind,
    tenantId: ref.tenantId,
    ownerId,
    sourceKind,
    sourceRef: ownerId,
    datasetName: [
      "thinkwork",
      "memory",
      COGNEE_MEMORY_SCOPE_VERSION,
      "tenant",
      tenantToken,
      ref.kind,
      ownerToken,
    ].join(":"),
    nodeSets: [
      "thinkwork_memory",
      `thinkwork_memory_${COGNEE_MEMORY_SCOPE_VERSION}`,
      `thinkwork_${ref.kind}_memory`,
      `tenant_${tenantToken}`,
      `${ref.kind}_${ownerToken}`,
    ],
    metadata: {
      memory_scope_version: COGNEE_MEMORY_SCOPE_VERSION,
      memory_scope_kind: ref.kind,
      tenant_id: ref.tenantId,
      owner_id: ownerId,
    },
  };
}

function scopeToken(value: string, label: string): string {
  const token = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!token) {
    throw new Error(`Cognee memory scope requires a non-empty ${label}`);
  }
  return token;
}
