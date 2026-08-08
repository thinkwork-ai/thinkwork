/**
 * Skills (Agents).
 *
 * STUB — the section headings below are the agreed outline (THINK-694);
 * the prose under each is a placeholder for a content pass to replace.
 * Keep the TOC and the <Section id>s in step: registry.test.tsx renders
 * this page and fails if a declared TOC entry has no anchor.
 */
import { DocArticle, Section } from "../kit";
import type { DocTocEntry } from "../registry";

export const SKILLS_TOC: DocTocEntry[] = [
  { id: "what-a-skill-is", title: "What a skill is" },
  { id: "catalog-and-install", title: "Catalog and install" },
  { id: "assignment-state", title: "Assignment state and permissions" },
];

export function Skills() {
  return (
    <DocArticle
      eyebrow="Agents"
      title="Skills"
      lead="A skill is a packaged procedure an agent can install: instructions, any tools it needs, and the permissions it is allowed to use."
    >
      <Section id="what-a-skill-is" title="What a skill is">
        <p>
          Placeholder — &ldquo;What a skill is&rdquo; has not been written yet.
        </p>
      </Section>
      <Section id="catalog-and-install" title="Catalog and install">
        <p>
          Placeholder — &ldquo;Catalog and install&rdquo; has not been written
          yet.
        </p>
      </Section>
      <Section id="assignment-state" title="Assignment state and permissions">
        <p>
          Placeholder — &ldquo;Assignment state and permissions&rdquo; has not
          been written yet.
        </p>
      </Section>
    </DocArticle>
  );
}
