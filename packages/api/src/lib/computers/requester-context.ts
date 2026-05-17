import { and, eq } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { tenantMembers } from "@thinkwork/database-pg/schema";
import { getMemoryServices } from "../memory/index.js";
import type { MemoryRequestContext, RecallResult } from "../memory/index.js";
import type { NormalizedRecallService } from "../memory/recall-service.js";

const DEFAULT_MEMORY_LIMIT = 8;
const DEFAULT_TOKEN_BUDGET = 1_200;

export class RequesterContextError extends Error {
  constructor(
    readonly code:
      | "requester_user_required"
      | "requester_not_in_tenant"
      | "credential_subject_mismatch",
    message: string,
  ) {
    super(message);
    this.name = "RequesterContextError";
  }
}

export type RequesterContextStatus = {
  providerId: "memory";
  displayName: "Hindsight Memory";
  state: "ok" | "skipped" | "error";
  hitCount: number;
  reason?: string;
  metadata: {
    contextClass: string;
    requesterUserId: string | null;
    computerId: string;
    sourceSurface: string;
    credentialSubject?: MemoryRequestContext["credentialSubject"];
    event?: MemoryRequestContext["event"];
  };
};

export type RequesterMemoryHit = {
  id: string;
  title: string;
  text: string;
  score: number;
  provenance: {
    backend: string;
    sourceId: string;
    whyRecalled?: string;
    createdAt?: string;
    ownerType: "user" | "agent";
    ownerId: string;
  };
};

export type AssembledRequesterContext = {
  contextClass: string;
  computerId: string;
  requester: {
    userId: string | null;
  };
  sourceSurface: string;
  credentialSubject?: MemoryRequestContext["credentialSubject"];
  event?: MemoryRequestContext["event"];
  personalMemory: {
    hits: RequesterMemoryHit[];
    status: RequesterContextStatus;
  };
};

export type AssembleRequesterContextInput = {
  tenantId: string;
  computerId: string;
  requesterUserId?: string | null;
  prompt: string;
  sourceSurface?: string | null;
  contextClass?: string | null;
  credentialSubject?: MemoryRequestContext["credentialSubject"];
  event?: MemoryRequestContext["event"];
  limit?: number;
  tokenBudget?: number;
};

export type AssembleRequesterContextDeps = {
  recall?: Pick<NormalizedRecallService, "recall">;
  validateRequester?: (tenantId: string, userId: string) => Promise<boolean>;
};

export async function assembleRequesterContext(
  input: AssembleRequesterContextInput,
  deps: AssembleRequesterContextDeps = {},
): Promise<AssembledRequesterContext> {
  const contextClass = normalizeContextClass(input.contextClass);
  const sourceSurface = input.sourceSurface?.trim() || "unknown";
  const requesterUserId = input.requesterUserId?.trim() || null;
  const statusMetadata = {
    contextClass,
    requesterUserId,
    computerId: input.computerId,
    sourceSurface,
    credentialSubject: input.credentialSubject,
    event: input.event,
  };

  if (!requesterUserId) {
    if (contextClass !== "system") {
      throw new RequesterContextError(
        "requester_user_required",
        "Requester user id is required for user-scoped context",
      );
    }
    return emptyContext(input, sourceSurface, contextClass, {
      providerId: "memory",
      displayName: "Hindsight Memory",
      state: "skipped",
      hitCount: 0,
      reason: "system context has no requester user scope",
      metadata: statusMetadata,
    });
  }

  if (
    input.credentialSubject?.type === "user" &&
    input.credentialSubject.userId &&
    input.credentialSubject.userId !== requesterUserId
  ) {
    throw new RequesterContextError(
      "credential_subject_mismatch",
      "Credential subject user must match the requester user",
    );
  }

  const validateRequester = deps.validateRequester ?? requesterBelongsToTenant;
  if (!(await validateRequester(input.tenantId, requesterUserId))) {
    throw new RequesterContextError(
      "requester_not_in_tenant",
      "Requester user does not belong to the tenant",
    );
  }

  let hits: RecallResult[];
  try {
    const recall = deps.recall ?? getMemoryServices().recall;
    hits = await recall.recall({
      tenantId: input.tenantId,
      ownerType: "user",
      ownerId: requesterUserId,
      query: input.prompt,
      limit: input.limit ?? DEFAULT_MEMORY_LIMIT,
      tokenBudget: input.tokenBudget ?? DEFAULT_TOKEN_BUDGET,
      requestContext: {
        contextClass,
        computerId: input.computerId,
        requesterUserId,
        sourceSurface,
        credentialSubject: input.credentialSubject,
        event: input.event,
      },
    });
  } catch (err) {
    return {
      contextClass,
      computerId: input.computerId,
      requester: { userId: requesterUserId },
      sourceSurface,
      credentialSubject: input.credentialSubject,
      event: input.event,
      personalMemory: {
        hits: [],
        status: {
          providerId: "memory",
          displayName: "Hindsight Memory",
          state: "error",
          hitCount: 0,
          reason: err instanceof Error ? err.message : String(err),
          metadata: statusMetadata,
        },
      },
    };
  }

  const memoryHits = hits.map(toRequesterMemoryHit);
  const status: RequesterContextStatus =
    memoryHits.length > 0
      ? {
          providerId: "memory",
          displayName: "Hindsight Memory",
          state: "ok",
          hitCount: memoryHits.length,
          metadata: statusMetadata,
        }
      : {
          providerId: "memory",
          displayName: "Hindsight Memory",
          state: "skipped",
          hitCount: 0,
          reason: "no personal memory matched the request",
          metadata: statusMetadata,
        };

  return {
    contextClass,
    computerId: input.computerId,
    requester: { userId: requesterUserId },
    sourceSurface,
    credentialSubject: input.credentialSubject,
    event: input.event,
    personalMemory: {
      hits: memoryHits,
      status,
    },
  };
}

export function formatRequesterContextForPrompt(
  context: AssembledRequesterContext | null | undefined,
): string {
  if (!context) return "";
  const lines = [
    "Requester context overlay:",
    `- Context class: ${context.contextClass}`,
    `- Requester user id: ${context.requester.userId ?? "unavailable"}`,
    `- Memory provider: ${context.personalMemory.status.state}${
      context.personalMemory.status.reason
        ? ` (${context.personalMemory.status.reason})`
        : ""
    }`,
  ];
  if (context.credentialSubject) {
    lines.push(
      `- Credential subject: ${context.credentialSubject.type}${
        context.credentialSubject.userId
          ? `:${context.credentialSubject.userId}`
          : ""
      }`,
    );
  }
  if (context.event) {
    lines.push(
      `- Connector event: ${context.event.provider ?? "unknown"}:${
        context.event.eventType ?? "unknown"
      }`,
    );
  }
  if (context.personalMemory.hits.length > 0) {
    lines.push("- Personal memory hits:");
    for (const hit of context.personalMemory.hits.slice(0, 5)) {
      lines.push(`  - ${hit.title}: ${hit.text}`);
    }
  }
  return lines.join("\n");
}

function normalizeContextClass(value: string | null | undefined) {
  return value?.trim() || "user";
}

function emptyContext(
  input: AssembleRequesterContextInput,
  sourceSurface: string,
  contextClass: string,
  status: RequesterContextStatus,
): AssembledRequesterContext {
  return {
    contextClass,
    computerId: input.computerId,
    requester: { userId: input.requesterUserId?.trim() || null },
    sourceSurface,
    credentialSubject: input.credentialSubject,
    event: input.event,
    personalMemory: {
      hits: [],
      status,
    },
  };
}

function toRequesterMemoryHit(hit: RecallResult): RequesterMemoryHit {
  return {
    id: hit.record.id,
    title: hit.record.content.summary || "Memory",
    text: hit.record.content.summary || hit.record.content.text,
    score: hit.score,
    provenance: {
      backend: hit.backend,
      sourceId: hit.record.id,
      whyRecalled: hit.whyRecalled,
      createdAt: hit.record.createdAt,
      ownerType: hit.record.ownerType,
      ownerId: hit.record.ownerId,
    },
  };
}

async function requesterBelongsToTenant(
  tenantId: string,
  userId: string,
): Promise<boolean> {
  const rows = await getDb()
    .select({ id: tenantMembers.id })
    .from(tenantMembers)
    .where(
      and(
        eq(tenantMembers.tenant_id, tenantId),
        eq(tenantMembers.principal_type, "user"),
        eq(tenantMembers.principal_id, userId),
      ),
    )
    .limit(1);
  return rows.length > 0;
}
