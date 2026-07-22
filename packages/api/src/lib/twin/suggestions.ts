/**
 * Materialization suggestions (Company Brain U8 / R8 — AE3's "name the
 * gap" half). Recorded when a cohort question needed a facet the clone
 * policy holds out: repeated gaps on the same (entity type, facet)
 * increment ONE row's hit counter; a dismissed suggestion is not
 * immediately re-created (a fresh hit after dismissal re-opens it — the
 * demand signal is real).
 */

import { and, eq, isNull, sql } from "drizzle-orm";
import { twinMaterializationSuggestions } from "@thinkwork/database-pg/schema";
import { db as defaultDb } from "../db.js";

type DbLike = typeof defaultDb;

const RECENT_DISMISSAL_MS = 7 * 24 * 60 * 60 * 1000;

export async function recordMaterializationSuggestion(args: {
  tenantId: string;
  entityTypeSlug: string;
  facetSlug: string;
  question?: string | null;
  db?: DbLike;
  now?: Date;
}): Promise<{ recorded: boolean; reason?: string }> {
  const db = args.db ?? defaultDb;
  const now = args.now ?? new Date();

  const [existing] = await db
    .select({
      id: twinMaterializationSuggestions.id,
      dismissed_at: twinMaterializationSuggestions.dismissed_at,
    })
    .from(twinMaterializationSuggestions)
    .where(
      and(
        eq(twinMaterializationSuggestions.tenant_id, args.tenantId),
        eq(
          twinMaterializationSuggestions.entity_type_slug,
          args.entityTypeSlug,
        ),
        eq(twinMaterializationSuggestions.facet_slug, args.facetSlug),
      ),
    )
    .limit(1);

  if (existing?.dismissed_at) {
    const age = now.getTime() - existing.dismissed_at.getTime();
    if (age < RECENT_DISMISSAL_MS) {
      // Recently dismissed — respect the operator's call; don't nag.
      return { recorded: false, reason: "recently_dismissed" };
    }
  }

  await db
    .insert(twinMaterializationSuggestions)
    .values({
      tenant_id: args.tenantId,
      entity_type_slug: args.entityTypeSlug,
      facet_slug: args.facetSlug,
      last_question: args.question ?? null,
      updated_at: now,
    })
    .onConflictDoUpdate({
      target: [
        twinMaterializationSuggestions.tenant_id,
        twinMaterializationSuggestions.entity_type_slug,
        twinMaterializationSuggestions.facet_slug,
      ],
      set: {
        hit_count: sql`${twinMaterializationSuggestions.hit_count} + 1`,
        last_question: args.question ?? null,
        dismissed_at: null,
        updated_at: now,
      },
    });
  return { recorded: true };
}

export async function listMaterializationSuggestions(args: {
  tenantId: string;
  db?: DbLike;
}) {
  const db = args.db ?? defaultDb;
  return db
    .select()
    .from(twinMaterializationSuggestions)
    .where(
      and(
        eq(twinMaterializationSuggestions.tenant_id, args.tenantId),
        isNull(twinMaterializationSuggestions.dismissed_at),
      ),
    );
}

export async function dismissMaterializationSuggestion(args: {
  tenantId: string;
  suggestionId: string;
  db?: DbLike;
  now?: Date;
}): Promise<boolean> {
  const db = args.db ?? defaultDb;
  const rows = await db
    .update(twinMaterializationSuggestions)
    .set({
      dismissed_at: args.now ?? new Date(),
      updated_at: args.now ?? new Date(),
    })
    .where(
      and(
        eq(twinMaterializationSuggestions.id, args.suggestionId),
        eq(twinMaterializationSuggestions.tenant_id, args.tenantId),
      ),
    )
    .returning({ id: twinMaterializationSuggestions.id });
  return rows.length > 0;
}
