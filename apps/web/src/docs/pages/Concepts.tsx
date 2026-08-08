/**
 * Core concepts (Start here).
 *
 * STUB — the section headings below are the agreed outline (THINK-694);
 * the prose under each is a placeholder for a content pass to replace.
 * Keep the TOC and the <Section id>s in step: registry.test.tsx renders
 * this page and fails if a declared TOC entry has no anchor.
 */
import { DocArticle, Section } from "../kit";
import type { DocTocEntry } from "../registry";

export const CONCEPTS_TOC: DocTocEntry[] = [
  { id: "how-the-pieces-fit", title: "How the pieces fit" },
  { id: "glossary", title: "Glossary" },
  { id: "naming-notes", title: "Naming notes" },
];

export function Concepts() {
  return (
    <DocArticle
      eyebrow="Start here"
      title="Core concepts"
      lead="Every other page in these docs leans on the same handful of words; this page defines them once, in the order they build on each other."
    >
      <Section id="how-the-pieces-fit" title="How the pieces fit">
        <p>
          Placeholder — &ldquo;How the pieces fit&rdquo; has not been written
          yet.
        </p>
      </Section>
      <Section id="glossary" title="Glossary">
        <p>Placeholder — &ldquo;Glossary&rdquo; has not been written yet.</p>
      </Section>
      <Section id="naming-notes" title="Naming notes">
        <p>
          Placeholder — &ldquo;Naming notes&rdquo; has not been written yet.
        </p>
      </Section>
    </DocArticle>
  );
}
