import {
  agents,
  and,
  db as defaultDb,
  eq,
  inboxItems,
} from "../../graphql/utils.js";
import {
  classifyWorkspaceReview,
  createDrizzleClassifyChainStore,
  type ClassifyChainStore,
  type WorkspaceReviewKind,
} from "./classify-review.js";

/**
 * System-agent and unrouted workspace reviews materialize as `inbox_items`
 * rows so operators can resolve them through the existing Inbox UI. This
 * module owns the write-time materialization hook and the status-sync
 * update that runs when a review is resolved.
 *
 * Paired-human reviews never become inbox items — they live on mobile.
 */

export const WORKSPACE_REVIEW_INBOX_TYPE = "workspace_review";
export const WORKSPACE_REVIEW_ENTITY_TYPE = "agent_workspace_run";

export interface WorkspaceReviewInboxStore {
  findAgentNameAndSlug(
    agentId: string,
  ): Promise<{ name: string; slug: string | null } | null>;
  findInboxItemForRun(
    tenantId: string,
    runId: string,
  ): Promise<{ id: string; status: string } | null>;
  insertInboxItem(values: InboxItemInsert): Promise<{ id: string }>;
  updateInboxItemStatus(
    inboxItemId: string,
    updates: InboxItemStatusUpdate,
  ): Promise<void>;
}

interface InboxItemInsert {
  tenant_id: string;
  type: string;
  status: string;
  title: string;
  description: string | null;
  entity_type: string;
  entity_id: string;
  config: Record<string, unknown>;
  requester_type: string;
  requester_id: string;
}

interface InboxItemStatusUpdate {
  status: string;
  decided_by?: string | null;
  decided_at?: Date | null;
  review_notes?: string | null;
  updated_at: Date;
}

export interface MaterializeReviewInput {
  tenantId: string;
  runId: string;
  agentId: string;
  targetPath: string;
  classification: { kind: WorkspaceReviewKind; responsibleUserId: string | null };
  reviewObjectKey?: string | null;
  reviewEtag?: string | null;
  reason?: string | null;
  payload?: Record<string, unknown> | null;
}

export interface MaterializeReviewResult {
  status: "created" | "skipped_exists" | "skipped_paired";
  inboxItemId?: string;
}

export interface MaterializeReviewDeps {
  store?: WorkspaceReviewInboxStore;
}

/**
 * Insert an inbox row for a workspace run that just transitioned to
 * `awaiting_review`, IF its classification is `system` or `unrouted`.
 *
 * Idempotent: skips if an inbox item already exists for this run.
 * Returns `skipped_paired` for paired-human runs (those live on mobile).
 */
export async function materializeReviewAsInboxItem(
  input: MaterializeReviewInput,
  deps: MaterializeReviewDeps = {},
): Promise<MaterializeReviewResult> {
  if (input.classification.kind === "paired") {
    return { status: "skipped_paired" };
  }

  const store = deps.store ?? createDrizzleWorkspaceReviewInboxStore();

  const existing = await store.findInboxItemForRun(input.tenantId, input.runId);
  if (existing) {
    return { status: "skipped_exists", inboxItemId: existing.id };
  }

  const agent = await store.findAgentNameAndSlug(input.agentId);
  const agentLabel = agent?.name ?? agent?.slug ?? input.agentId.slice(0, 8);
  const targetPath = input.targetPath || "/";
  const titlePrefix =
    input.classification.kind === "unrouted"
      ? "Workspace review (unrouted)"
      : "Workspace review";
  const title = `${titlePrefix}: ${agentLabel} on ${targetPath}`;

  const description = derivedDescription(input.reason, input.payload);

  const config: Record<string, unknown> = {
    workspaceRunId: input.runId,
    agentId: input.agentId,
    agentName: agent?.name ?? null,
    agentSlug: agent?.slug ?? null,
    targetPath: input.targetPath,
    reviewObjectKey: input.reviewObjectKey ?? null,
    reviewEtag: input.reviewEtag ?? null,
    reason: input.reason ?? null,
    classification: {
      kind: input.classification.kind,
      responsibleUserId: input.classification.responsibleUserId,
    },
  };
  if (input.payload && typeof input.payload === "object") {
    config.payload = input.payload;
  }

  const inserted = await store.insertInboxItem({
    tenant_id: input.tenantId,
    type: WORKSPACE_REVIEW_INBOX_TYPE,
    status: "pending",
    title,
    description,
    entity_type: WORKSPACE_REVIEW_ENTITY_TYPE,
    entity_id: input.runId,
    config,
    requester_type: "agent",
    requester_id: input.agentId,
  });
  return { status: "created", inboxItemId: inserted.id };
}

export type WorkspaceRunResolution =
  | "approved"
  | "rejected"
  | "revision_requested"
  | "cancelled"
  | "completed"
  | "failed";

export interface SyncInboxStatusInput {
  tenantId: string;
  runId: string;
  status: WorkspaceRunResolution;
  decidedBy?: string | null;
  decidedAt?: Date | null;
  reviewNotes?: string | null;
}

export interface SyncInboxStatusResult {
  status: "updated" | "skipped_no_item" | "skipped_no_change";
}

/**
 * When a system/unrouted workspace run reaches a terminal review state,
 * mirror that onto the linked inbox item. No-op for paired runs (no inbox
 * row was ever created).
 *
 * Includes a recursion guard: if the inbox row is already at the target
 * status, return `skipped_no_change`. This prevents bridge-dispatched
 * workspace events from re-updating the inbox row that the bridge itself
 * just updated.
 */
export async function syncInboxStatusForRun(
  input: SyncInboxStatusInput,
  deps: MaterializeReviewDeps = {},
): Promise<SyncInboxStatusResult> {
  const store = deps.store ?? createDrizzleWorkspaceReviewInboxStore();
  const existing = await store.findInboxItemForRun(input.tenantId, input.runId);
  if (!existing) return { status: "skipped_no_item" };
  if (existing.status === input.status) return { status: "skipped_no_change" };

  await store.updateInboxItemStatus(existing.id, {
    status: input.status,
    decided_by: input.decidedBy ?? null,
    decided_at: input.decidedAt ?? new Date(),
    review_notes: input.reviewNotes ?? null,
    updated_at: new Date(),
  });
  return { status: "updated" };
}

function derivedDescription(
  reason: string | null | undefined,
  payload: Record<string, unknown> | null | undefined,
): string | null {
  if (reason) return reason;
  const body = stringValue(payload?.reviewBody);
  if (body) return body.slice(0, 240);
  const fileName = stringValue(payload?.fileName);
  if (fileName) return `Review file: ${fileName}`;
  return null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function createDrizzleWorkspaceReviewInboxStore(
  database = defaultDb,
): WorkspaceReviewInboxStore {
  return {
    async findAgentNameAndSlug(agentId) {
      const [agent] = await database
        .select({ name: agents.name, slug: agents.slug })
        .from(agents)
        .where(eq(agents.id, agentId))
        .limit(1);
      return agent
        ? { name: agent.name, slug: agent.slug ?? null }
        : null;
    },
    async findInboxItemForRun(tenantId, runId) {
      const [row] = await database
        .select({ id: inboxItems.id, status: inboxItems.status })
        .from(inboxItems)
        .where(
          and(
            eq(inboxItems.tenant_id, tenantId),
            eq(inboxItems.entity_type, WORKSPACE_REVIEW_ENTITY_TYPE),
            eq(inboxItems.entity_id, runId),
          ),
        )
        .limit(1);
      return row ?? null;
    },
    async insertInboxItem(values) {
      const [row] = await database
        .insert(inboxItems)
        .values(values)
        .returning({ id: inboxItems.id });
      if (!row) throw new Error("inbox_item_insert_failed");
      return row;
    },
    async updateInboxItemStatus(inboxItemId, updates) {
      await database
        .update(inboxItems)
        .set(updates)
        .where(eq(inboxItems.id, inboxItemId));
    },
  };
}

/**
 * Used by the workspace event processor to classify a run for
 * materialization. Wraps `classifyWorkspaceReview` with the default
 * Drizzle store.
 */
export async function classifyForMaterialization(
  tenantId: string,
  agentId: string,
  classifierStore?: ClassifyChainStore,
): Promise<{ kind: WorkspaceReviewKind; responsibleUserId: string | null }> {
  const store = classifierStore ?? createDrizzleClassifyChainStore();
  return classifyWorkspaceReview(store, { tenantId, agentId });
}
