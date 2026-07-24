/**
 * KnowledgeBase type field resolvers (THINK-193 U7).
 *
 * `documents` exposes the per-document edition manifest
 * (knowledge_base_documents) for operator visibility: edition, ingest
 * status (incl. 'deleting'/'absent_verified' settlement states), and the
 * coarse Hindsight projection status.
 */

import { asc, eq } from "drizzle-orm";
import {
  knowledgeBaseDocuments,
  knowledgeBaseSources,
} from "@thinkwork/database-pg/schema";
import { db, snakeToCamel } from "../../utils.js";

export const knowledgeBaseTypeResolvers = {
  documents: async (parent: { id: string }) => {
    const rows = await db
      .select()
      .from(knowledgeBaseDocuments)
      .where(eq(knowledgeBaseDocuments.knowledge_base_id, parent.id))
      .orderBy(asc(knowledgeBaseDocuments.document_key));
    return rows.map(snakeToCamel);
  },
  sources: async (parent: { id: string }) => {
    const rows = await db
      .select()
      .from(knowledgeBaseSources)
      .where(eq(knowledgeBaseSources.knowledge_base_id, parent.id))
      .orderBy(asc(knowledgeBaseSources.created_at));
    return rows.map((row) => {
      const camel = snakeToCamel(row) as Record<string, unknown>;
      // AWSJSON fields must be JSON-encoded strings on the wire.
      if (camel.filterPatterns != null) {
        camel.filterPatterns = JSON.stringify(camel.filterPatterns);
      }
      return camel;
    });
  },
};
