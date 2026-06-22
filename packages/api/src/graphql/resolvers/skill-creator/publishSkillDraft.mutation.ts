import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import { db, eq, skillDrafts } from "../../utils.js";
import {
  SkillDraftPublishError,
  publishSkillDraftToCatalog,
} from "../../../lib/skill-drafts/publish-catalog.js";
import {
  appendSkillDraftEvent,
  loadDraftEvents,
  loadDraftForTenant,
  loadTenantSlug,
  requireOperator,
  resolveReadTenant,
  toDraftPayload,
  toGraphqlDraft,
} from "./shared.js";

export async function publishSkillDraft(
  _parent: unknown,
  args: { input: { id: string; confirmReplace?: boolean | null } },
  ctx: GraphQLContext,
) {
  const tenantId = await resolveReadTenant(ctx);
  const draft = await loadDraftForTenant(tenantId, args.input.id);
  const { userId } = await requireOperator(ctx, tenantId);
  const tenantSlug = await loadTenantSlug(tenantId);

  let publishResult;
  try {
    publishResult = await publishSkillDraftToCatalog({
      tenantId,
      tenantSlug,
      draft,
      confirmReplace: args.input.confirmReplace === true,
    });
  } catch (err) {
    if (err instanceof SkillDraftPublishError) {
      throw new GraphQLError(err.message, {
        extensions: {
          code: err.status === 409 ? "FAILED_PRECONDITION" : "BAD_USER_INPUT",
          reason: err.code,
          ...err.details,
        },
      });
    }
    throw err;
  }

  const now = new Date();
  const [row] = await db
    .update(skillDrafts)
    .set({
      status: "published",
      published_catalog_slug: publishResult.slug,
      published_content_hash: publishResult.contentHash,
      updated_at: now,
      failure_message: null,
    })
    .where(eq(skillDrafts.id, draft.id))
    .returning();

  await appendSkillDraftEvent({
    tenantId,
    draftId: draft.id,
    actorUserId: userId,
    eventType: "published",
    message: `Skill draft published to Skill Library as '${publishResult.slug}'.`,
    payload: {
      slug: publishResult.slug,
      contentHash: publishResult.contentHash,
      replaced: publishResult.replaced,
      generatedWiring: publishResult.generatedWiring,
      trustStatus: publishResult.trustReport.status,
      scannerStatus: publishResult.trustReport.scanner.status,
      indexWarning: publishResult.indexWarning ?? null,
      evalDatasetWarning: publishResult.evalDatasetWarning ?? null,
    },
  });

  const events = await loadDraftEvents(tenantId, draft.id);
  return toGraphqlDraft(toDraftPayload(row ?? draft, null, events));
}
