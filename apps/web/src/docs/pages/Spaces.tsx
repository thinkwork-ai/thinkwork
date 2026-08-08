/**
 * Spaces (Spaces & threads).
 *
 * STUB — the section headings below are the agreed outline (THINK-694);
 * the prose under each is a placeholder for a content pass to replace.
 * Keep the TOC and the <Section id>s in step: registry.test.tsx renders
 * this page and fails if a declared TOC entry has no anchor.
 */
import { DocArticle, Section } from "../kit";
import type { DocTocEntry } from "../registry";

export const SPACES_TOC: DocTocEntry[] = [
  { id: "what-a-space-is", title: "What a space is" },
  { id: "membership", title: "Membership and visibility" },
  { id: "organizing-work", title: "Organizing work" },
];

export function Spaces() {
  return (
    <DocArticle
      eyebrow="Spaces & threads"
      title="Spaces"
      lead="A space is the container your work lives in: a set of people, an agent, and everything that agent is allowed to read on their behalf."
    >
      <Section id="what-a-space-is" title="What a space is">
        <p>
          Placeholder — &ldquo;What a space is&rdquo; has not been written yet.
        </p>
      </Section>
      <Section id="membership" title="Membership and visibility">
        <p>
          Placeholder — &ldquo;Membership and visibility&rdquo; has not been
          written yet.
        </p>
      </Section>
      <Section id="organizing-work" title="Organizing work">
        <p>
          Placeholder — &ldquo;Organizing work&rdquo; has not been written yet.
        </p>
      </Section>
    </DocArticle>
  );
}
