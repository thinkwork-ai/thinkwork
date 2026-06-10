/**
 * wikiPage — load one compiled page by (tenant, scope, type, slug) with its
 * sections and aliases. Sections come ordered by position; aliases are a
 * flat string array.
 *
 * Scope rule (plan 2026-06-09-004 U14): serves the transitional union —
 * tenant-scoped pages (owner_id NULL, readable by any tenant member) plus
 * the requesting user's own pages. When a user page and a tenant page share
 * a slug during the transition window, the user's own page wins (see
 * `findReadablePageBySlug`).
 */

import { asc, eq } from "drizzle-orm";
import {
  wikiPageSections,
  wikiPageAliases,
} from "@thinkwork/database-pg/schema";
import type { GraphQLContext } from "../../context.js";
import { db } from "../../utils.js";
import { findReadablePageBySlug } from "../../../lib/wiki/repository.js";
import { resolveWikiUnionReadScope } from "./auth.js";
import { toGraphQLType, toGraphQLPage } from "./mappers.js";

export const wikiPage = async (
  _parent: unknown,
  args: {
    tenantId: string;
    userId?: string | null;
    ownerId?: string | null;
    type: "ENTITY" | "TOPIC" | "DECISION";
    slug: string;
  },
  ctx: GraphQLContext,
) => {
  const { tenantId, scope } = await resolveWikiUnionReadScope(ctx, args);

  const lowerType = args.type.toLowerCase() as "entity" | "topic" | "decision";

  const page = await findReadablePageBySlug(
    {
      tenantId,
      scope,
      type: lowerType,
      slug: args.slug,
    },
    db,
  );

  if (!page) return null;

  const [sections, aliases] = await Promise.all([
    db
      .select()
      .from(wikiPageSections)
      .where(eq(wikiPageSections.page_id, page.id))
      .orderBy(asc(wikiPageSections.position)),
    db
      .select({ alias: wikiPageAliases.alias })
      .from(wikiPageAliases)
      .where(eq(wikiPageAliases.page_id, page.id)),
  ]);

  return toGraphQLPage(page, {
    sections: sections.map((s) => ({
      id: s.id,
      sectionSlug: s.section_slug,
      heading: s.heading,
      bodyMd: s.body_md,
      position: s.position,
      lastSourceAt: s.last_source_at?.toISOString() ?? null,
    })),
    aliases: aliases.map((a) => a.alias),
  });
};

export { toGraphQLType };
