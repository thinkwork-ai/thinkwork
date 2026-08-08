/**
 * How memory works (Memory).
 *
 * STUB — the section headings below are the agreed outline (THINK-694);
 * the prose under each is a placeholder for a content pass to replace.
 * Keep the TOC and the <Section id>s in step: registry.test.tsx renders
 * this page and fails if a declared TOC entry has no anchor.
 */
import { DocArticle, Section } from "../kit";
import type { DocTocEntry } from "../registry";

export const MEMORY_TOC: DocTocEntry[] = [
  { id: "the-engine", title: "The engine" },
  { id: "what-gets-remembered", title: "What gets remembered" },
  { id: "retention", title: "Retention and forgetting" },
];

export function Memory() {
  return (
    <DocArticle
      eyebrow="Memory"
      title="How memory works"
      lead="Memory is what survives the end of a thread. This page covers the engine behind it, what gets written, and what deliberately does not."
    >
      <Section id="the-engine" title="The engine">
        <p>Placeholder — &ldquo;The engine&rdquo; has not been written yet.</p>
      </Section>
      <Section id="what-gets-remembered" title="What gets remembered">
        <p>
          Placeholder — &ldquo;What gets remembered&rdquo; has not been written
          yet.
        </p>
      </Section>
      <Section id="retention" title="Retention and forgetting">
        <p>
          Placeholder — &ldquo;Retention and forgetting&rdquo; has not been
          written yet.
        </p>
      </Section>
    </DocArticle>
  );
}
