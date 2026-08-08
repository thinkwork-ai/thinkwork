/**
 * The agent folder (Agents).
 *
 * STUB — the section headings below are the agreed outline (THINK-694);
 * the prose under each is a placeholder for a content pass to replace.
 * Keep the TOC and the <Section id>s in step: registry.test.tsx renders
 * this page and fails if a declared TOC entry has no anchor.
 */
import { DocArticle, Section } from "../kit";
import type { DocTocEntry } from "../registry";

export const AGENT_FOLDER_TOC: DocTocEntry[] = [
  { id: "anatomy", title: "Anatomy of the folder" },
  { id: "instructions", title: "INSTRUCTIONS.md" },
  { id: "grants-by-presence", title: "Grants by presence" },
];

export function AgentFolder() {
  return (
    <DocArticle
      eyebrow="Agents"
      title="The agent folder"
      lead="An agent is a folder. The same four things appear at every level of it, which is what makes agents compose instead of merely nest."
    >
      <Section id="anatomy" title="Anatomy of the folder">
        <p>
          Placeholder — &ldquo;Anatomy of the folder&rdquo; has not been written
          yet.
        </p>
      </Section>
      <Section id="instructions" title="INSTRUCTIONS.md">
        <p>
          Placeholder — &ldquo;INSTRUCTIONS.md&rdquo; has not been written yet.
        </p>
      </Section>
      <Section id="grants-by-presence" title="Grants by presence">
        <p>
          Placeholder — &ldquo;Grants by presence&rdquo; has not been written
          yet.
        </p>
      </Section>
    </DocArticle>
  );
}
