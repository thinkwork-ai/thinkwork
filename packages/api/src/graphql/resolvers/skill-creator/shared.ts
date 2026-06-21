import { randomUUID } from "node:crypto";
import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import {
  and,
  asc,
  db,
  eq,
  inArray,
  skillDraftEvents,
  skillDrafts,
  tenants,
  threads,
  users,
} from "../../utils.js";
import { requireTenantAdmin, requireTenantMember } from "../core/authz.js";
import {
  resolveCaller,
  resolveCallerTenantId,
  resolveCallerUserId,
} from "../core/resolve-auth-user.js";

export const SKILL_DRAFT_STATUSES = [
  "draft",
  "submitted",
  "rejected",
  "failed",
] as const;

export type SkillDraftStatus = (typeof SKILL_DRAFT_STATUSES)[number];

const SKILL_DRAFT_SOURCE_KINDS = [
  "thread",
  "archive",
  "manual",
  "existing_skill",
] as const;

export type SkillDraftSourceKind = (typeof SKILL_DRAFT_SOURCE_KINDS)[number];

export type SkillDraftRow = typeof skillDrafts.$inferSelect;
export type SkillDraftEventRow = typeof skillDraftEvents.$inferSelect;

export interface SkillDraftPayload {
  row: SkillDraftRow;
  requester?: { id: string; name: string | null; email: string | null } | null;
  events?: SkillDraftEventRow[];
}

export function userInput(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: "BAD_USER_INPUT" } });
}

export function forbidden(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: "FORBIDDEN" } });
}

export function notFound(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: "NOT_FOUND" } });
}

export function failedPrecondition(message: string): GraphQLError {
  return new GraphQLError(message, {
    extensions: { code: "FAILED_PRECONDITION" },
  });
}

export function normalizeSlug(value: unknown): string {
  const slug = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)) {
    throw userInput(
      "Skill draft slug must use lowercase letters, numbers, and dashes.",
    );
  }
  return slug;
}

export function normalizeSourceKind(value: unknown): SkillDraftSourceKind {
  const kind = typeof value === "string" ? value : "thread";
  if ((SKILL_DRAFT_SOURCE_KINDS as readonly string[]).includes(kind)) {
    return kind as SkillDraftSourceKind;
  }
  throw userInput("Unknown skill draft source kind.");
}

export function requireNonEmptyText(value: unknown, field: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw userInput(`${field} is required.`);
  return text;
}

export async function requireDraftAuthor(
  ctx: GraphQLContext,
): Promise<{ tenantId: string; userId: string }> {
  const caller = await resolveCaller(ctx);
  if (!caller.tenantId || !caller.userId) {
    throw forbidden("Tenant member required");
  }
  await requireTenantMember(ctx, caller.tenantId);
  return { tenantId: caller.tenantId, userId: caller.userId };
}

export async function resolveReadTenant(ctx: GraphQLContext): Promise<string> {
  const tenantId = await resolveCallerTenantId(ctx);
  if (!tenantId) throw forbidden("Tenant context required");
  await requireTenantMember(ctx, tenantId);
  return tenantId;
}

export async function isTenantOperator(
  ctx: GraphQLContext,
  tenantId: string,
): Promise<boolean> {
  try {
    await requireTenantAdmin(ctx, tenantId);
    return true;
  } catch {
    return false;
  }
}

export async function requireOperator(
  ctx: GraphQLContext,
  tenantId: string,
): Promise<{ userId: string | null }> {
  await requireTenantAdmin(ctx, tenantId);
  return { userId: await resolveCallerUserId(ctx) };
}

export async function loadTenantSlug(tenantId: string): Promise<string> {
  const [tenant] = await db
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  if (!tenant?.slug) throw failedPrecondition("Tenant slug not found.");
  return tenant.slug;
}

export async function assertSourceThreadTenant(
  tenantId: string,
  threadId?: string | null,
): Promise<void> {
  if (!threadId) return;
  const [thread] = await db
    .select({ id: threads.id })
    .from(threads)
    .where(and(eq(threads.id, threadId), eq(threads.tenant_id, tenantId)))
    .limit(1);
  if (!thread) throw userInput("Source thread was not found in this tenant.");
}

export async function loadDraftForTenant(
  tenantId: string,
  draftId: string,
): Promise<SkillDraftRow> {
  const [row] = await db
    .select()
    .from(skillDrafts)
    .where(
      and(eq(skillDrafts.id, draftId), eq(skillDrafts.tenant_id, tenantId)),
    )
    .limit(1);
  if (!row) throw notFound("Skill draft not found.");
  return row;
}

export function assertCanReadDraft(args: {
  draft: SkillDraftRow;
  callerUserId: string | null;
  operator: boolean;
}): void {
  if (args.operator) return;
  if (
    args.callerUserId &&
    args.draft.requested_by_user_id === args.callerUserId
  ) {
    return;
  }
  throw forbidden("Skill draft not found.");
}

export function assertEditableDraft(row: SkillDraftRow): void {
  if (row.status === "draft" || row.status === "failed") return;
  throw failedPrecondition("Skill draft is not editable in its current state.");
}

export async function appendSkillDraftEvent(args: {
  tenantId: string;
  draftId: string;
  actorUserId?: string | null;
  eventType: "created" | "updated" | "submitted" | "rejected" | "failed";
  message?: string | null;
  payload?: Record<string, unknown>;
}): Promise<void> {
  await db.insert(skillDraftEvents).values({
    tenant_id: args.tenantId,
    draft_id: args.draftId,
    actor_user_id: args.actorUserId ?? null,
    event_type: args.eventType,
    message: args.message ?? null,
    payload: args.payload ?? {},
  });
}

export async function loadDraftEvents(
  tenantId: string,
  draftId: string,
): Promise<SkillDraftEventRow[]> {
  return db
    .select()
    .from(skillDraftEvents)
    .where(
      and(
        eq(skillDraftEvents.tenant_id, tenantId),
        eq(skillDraftEvents.draft_id, draftId),
      ),
    )
    .orderBy(asc(skillDraftEvents.created_at));
}

export async function loadRequesters(
  rows: SkillDraftRow[],
): Promise<
  Map<string, { id: string; name: string | null; email: string | null }>
> {
  const ids = Array.from(new Set(rows.map((row) => row.requested_by_user_id)));
  if (ids.length === 0) return new Map();
  const requesterRows = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(inArray(users.id, ids));
  return new Map(requesterRows.map((row) => [row.id, row]));
}

export function toDraftPayload(
  row: SkillDraftRow,
  requester?: { id: string; name: string | null; email: string | null } | null,
  events: SkillDraftEventRow[] = [],
): SkillDraftPayload {
  return { row, requester: requester ?? null, events };
}

export function toGraphqlDraft(payload: SkillDraftPayload) {
  const row = payload.row;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    slug: row.slug,
    title: row.title,
    displayName: row.display_name,
    summary: row.summary,
    status: row.status,
    source: {
      kind: row.source_kind,
      threadId: row.source_thread_id,
      messageId: row.source_message_id,
    },
    requester: payload.requester,
    currentContentHash: row.current_content_hash,
    draftS3Prefix: row.draft_s3_prefix,
    inboxItemId: row.inbox_item_id,
    failureMessage: row.failure_message,
    rejectedAt: row.rejected_at,
    publishedCatalogSlug: row.published_catalog_slug,
    publishedContentHash: row.published_content_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    submittedAt: row.submitted_at,
    events: (payload.events ?? []).map((event) => ({
      id: event.id,
      draftId: event.draft_id,
      eventType: event.event_type,
      message: event.message,
      payload: event.payload,
      actorUserId: event.actor_user_id,
      createdAt: event.created_at,
    })),
  };
}

export function toGraphqlDraftSummary(payload: SkillDraftPayload) {
  const draft = toGraphqlDraft(payload);
  const { events: _events, draftS3Prefix: _draftS3Prefix, ...summary } = draft;
  return summary;
}

export function nextDraftId(): string {
  return randomUUID();
}
