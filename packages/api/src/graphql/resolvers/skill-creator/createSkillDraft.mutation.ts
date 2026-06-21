import type { GraphQLContext } from "../../context.js";
import { db, eq, skillDrafts } from "../../utils.js";
import {
  appendSkillDraftEvent,
  assertSourceThreadTenant,
  loadDraftEvents,
  loadTenantSlug,
  nextDraftId,
  normalizeSlug,
  normalizeSourceKind,
  requireDraftAuthor,
  requireNonEmptyText,
  toDraftPayload,
  toGraphqlDraft,
} from "./shared.js";

export async function createSkillDraft(
  _parent: unknown,
  args: {
    input: {
      slug: string;
      title: string;
      displayName?: string | null;
      summary?: string | null;
      source?: {
        kind?: string | null;
        threadId?: string | null;
        messageId?: string | null;
      } | null;
      currentContentHash?: string | null;
    };
  },
  ctx: GraphQLContext,
) {
  const { tenantId, userId } = await requireDraftAuthor(ctx);
  const source = args.input.source ?? {};
  const sourceKind = normalizeSourceKind(source.kind);
  await assertSourceThreadTenant(tenantId, source.threadId);

  const id = nextDraftId();
  const tenantSlug = await loadTenantSlug(tenantId);
  const [row] = await db
    .insert(skillDrafts)
    .values({
      id,
      tenant_id: tenantId,
      requested_by_user_id: userId,
      source_thread_id: source.threadId ?? null,
      source_message_id: source.messageId ?? null,
      slug: normalizeSlug(args.input.slug),
      title: requireNonEmptyText(args.input.title, "Title"),
      display_name: args.input.displayName?.trim() || null,
      summary: args.input.summary?.trim() || null,
      source_kind: sourceKind,
      current_content_hash: args.input.currentContentHash?.trim() || null,
      draft_s3_prefix: `tenants/${tenantSlug}/skill-drafts/${id}/`,
    })
    .returning();

  await appendSkillDraftEvent({
    tenantId,
    draftId: row.id,
    actorUserId: userId,
    eventType: "created",
    message: "Skill draft created.",
    payload: { sourceKind },
  });

  const [fresh] = await db
    .select()
    .from(skillDrafts)
    .where(eq(skillDrafts.id, row.id))
    .limit(1);
  const events = await loadDraftEvents(tenantId, row.id);
  return toGraphqlDraft(
    toDraftPayload(
      fresh ?? row,
      { id: userId, name: null, email: null },
      events,
    ),
  );
}
