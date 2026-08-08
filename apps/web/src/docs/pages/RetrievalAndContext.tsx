/**
 * Retrieval & context (Memory).
 *
 * STUB — the section headings below are the agreed outline (THINK-694);
 * the prose under each is a placeholder for a content pass to replace.
 * Keep the TOC and the <Section id>s in step: registry.test.tsx renders
 * this page and fails if a declared TOC entry has no anchor.
 */
import { DocArticle, Section } from "../kit";
import type { DocTocEntry } from "../registry";

export const RETRIEVAL_AND_CONTEXT_TOC: DocTocEntry[] = [
  { id: "how-retrieval-works", title: "How retrieval works" },
  { id: "budgeting-context", title: "Budgeting the context window" },
  { id: "citations", title: "Citations and evidence" },
];

export function RetrievalAndContext() {
  return (
    <DocArticle
      eyebrow="Memory"
      title="Retrieval & context"
      lead="Storing memory is the easy half. This page is about the other half: getting the right piece of it in front of the agent at the right moment."
    >
      <Section id="how-retrieval-works" title="How retrieval works">
        <p>
          Placeholder — &ldquo;How retrieval works&rdquo; has not been written
          yet.
        </p>
      </Section>
      <Section id="budgeting-context" title="Budgeting the context window">
        <p>
          Placeholder — &ldquo;Budgeting the context window&rdquo; has not been
          written yet.
        </p>
      </Section>
      <Section id="citations" title="Citations and evidence">
        <p>
          Placeholder — &ldquo;Citations and evidence&rdquo; has not been
          written yet.
        </p>
      </Section>
    </DocArticle>
  );
}
