/**
 * How a citation opens its document depends on where it renders. Inside a
 * thread, the host provides an opener that docks the document in the
 * artifact side panel (THINK-168) so readers don't lose the conversation;
 * anywhere without a provider, the default new-tab flow
 * (openKnowledgeDocument) applies. Citation surfaces (inline pills, the
 * Used-N-sources card) consume this hook and stay host-agnostic.
 */
import { createContext, useContext } from "react";
import {
  openKnowledgeDocument,
  type OpenableKnowledgeDocument,
} from "@/lib/knowledge-doc-viewer";

/** Opens a cited document; throws when the citation carries no URL. */
export type KnowledgeDocumentOpener = (
  source: OpenableKnowledgeDocument,
) => void;

export const KnowledgeDocumentOpenerContext =
  createContext<KnowledgeDocumentOpener | null>(null);

export function useKnowledgeDocumentOpener(): KnowledgeDocumentOpener {
  return useContext(KnowledgeDocumentOpenerContext) ?? openKnowledgeDocument;
}
