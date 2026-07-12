/**
 * KnowledgeBase type field resolvers (THINK-193 U7).
 *
 * `documents` exposes the per-document edition manifest
 * (knowledge_base_documents) for operator visibility: edition, ingest
 * status (incl. 'deleting'/'absent_verified' settlement states), and the
 * coarse Hindsight projection status.
 */

import { asc, eq } from "drizzle-orm";
import { knowledgeBaseDocuments } from "@thinkwork/database-pg/schema";
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
};
