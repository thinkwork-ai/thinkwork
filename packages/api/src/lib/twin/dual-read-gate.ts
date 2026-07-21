/**
 * Per-tenant projection flip gate (Company Brain U8 / KTD-8 — AE8).
 *
 * ONE gate function shared by the entity-page, dossier, and search-broker
 * legs: a tenant's entity type renders the PROJECTED page only when
 * (a) the type declares page sections in the ontology, AND (b) the
 * tenant's first identity sync has completed (the graph projector's cursor
 * row exists — the twin has real nodes to project from). Anything else
 * falls back to the existing compiled `brain.tenant_entity_pages` surface —
 * never a blank or error state caused by the cutover.
 */

import { and, eq } from "drizzle-orm";
import {
  identityGraphProjectionCursors,
  ontologyEntityTypes,
} from "@thinkwork/database-pg/schema";
import { db as defaultDb } from "../db.js";
import {
  parsePageSectionDeclarations,
  type PageSectionDeclaration,
} from "../ontology/twin-declarations.js";

type DbLike = typeof defaultDb;

export interface TwinPageGate {
  projected: boolean;
  sections: PageSectionDeclaration[];
  reason: "projected" | "no_sections_declared" | "first_sync_incomplete";
}

export async function resolveTwinPageGate(args: {
  tenantId: string;
  entityTypeSlug: string;
  db?: DbLike;
}): Promise<TwinPageGate> {
  const db = args.db ?? defaultDb;
  const [typeRow] = await db
    .select({
      page_sections: ontologyEntityTypes.page_sections,
      lifecycle_status: ontologyEntityTypes.lifecycle_status,
    })
    .from(ontologyEntityTypes)
    .where(
      and(
        eq(ontologyEntityTypes.tenant_id, args.tenantId),
        eq(ontologyEntityTypes.slug, args.entityTypeSlug),
      ),
    )
    .limit(1);

  const sections =
    typeRow?.lifecycle_status === "approved"
      ? parsePageSectionDeclarations(typeRow.page_sections)
      : [];
  if (sections.length === 0) {
    return { projected: false, sections: [], reason: "no_sections_declared" };
  }

  const [cursor] = await db
    .select({ tenant_id: identityGraphProjectionCursors.tenant_id })
    .from(identityGraphProjectionCursors)
    .where(eq(identityGraphProjectionCursors.tenant_id, args.tenantId))
    .limit(1);
  if (!cursor) {
    return { projected: false, sections, reason: "first_sync_incomplete" };
  }

  return { projected: true, sections, reason: "projected" };
}
