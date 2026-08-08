/**
 * Compounding memory (Memory).
 *
 * STUB — the section headings below are the agreed outline (THINK-694);
 * the prose under each is a placeholder for a content pass to replace.
 * Keep the TOC and the <Section id>s in step: registry.test.tsx renders
 * this page and fails if a declared TOC entry has no anchor.
 */
import { DocArticle, Section } from "../kit";
import type { DocTocEntry } from "../registry";

export const COMPOUNDING_MEMORY_TOC: DocTocEntry[] = [
  { id: "the-wiki", title: "The wiki" },
  { id: "compilation", title: "How compilation works" },
  { id: "browsing", title: "Browsing the graph" },
];

export function CompoundingMemory() {
  return (
    <DocArticle
      eyebrow="Memory"
      title="Compounding memory"
      lead="Raw memories accumulate; compounding memory distills them into pages — entities, topics, decisions — that get better the more the agent works."
    >
      <Section id="the-wiki" title="The wiki">
        <p>Placeholder — &ldquo;The wiki&rdquo; has not been written yet.</p>
      </Section>
      <Section id="compilation" title="How compilation works">
        <p>
          Placeholder — &ldquo;How compilation works&rdquo; has not been written
          yet.
        </p>
      </Section>
      <Section id="browsing" title="Browsing the graph">
        <p>
          Placeholder — &ldquo;Browsing the graph&rdquo; has not been written
          yet.
        </p>
      </Section>
    </DocArticle>
  );
}
