/**
 * Workspace context (Spaces & threads).
 *
 * STUB — the section headings below are the agreed outline (THINK-694);
 * the prose under each is a placeholder for a content pass to replace.
 * Keep the TOC and the <Section id>s in step: registry.test.tsx renders
 * this page and fails if a declared TOC entry has no anchor.
 */
import { DocArticle, Section } from "../kit";
import type { DocTocEntry } from "../registry";

export const WORKSPACE_CONTEXT_TOC: DocTocEntry[] = [
  { id: "what-the-agent-sees", title: "What the agent sees" },
  { id: "files-and-artifacts", title: "Files and artifacts" },
  { id: "scoping", title: "Scoping context to a thread" },
];

export function WorkspaceContext() {
  return (
    <DocArticle
      eyebrow="Spaces & threads"
      title="Workspace context"
      lead="Context is not everything the agent could reach — it is what is placed in front of it for this turn. This page is about that selection."
    >
      <Section id="what-the-agent-sees" title="What the agent sees">
        <p>
          Placeholder — &ldquo;What the agent sees&rdquo; has not been written
          yet.
        </p>
      </Section>
      <Section id="files-and-artifacts" title="Files and artifacts">
        <p>
          Placeholder — &ldquo;Files and artifacts&rdquo; has not been written
          yet.
        </p>
      </Section>
      <Section id="scoping" title="Scoping context to a thread">
        <p>
          Placeholder — &ldquo;Scoping context to a thread&rdquo; has not been
          written yet.
        </p>
      </Section>
    </DocArticle>
  );
}
