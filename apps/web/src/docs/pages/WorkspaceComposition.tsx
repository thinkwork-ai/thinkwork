/**
 * Workspace composition & inheritance (Agents).
 *
 * STUB — the section headings below are the agreed outline (THINK-694);
 * the prose under each is a placeholder for a content pass to replace.
 * Keep the TOC and the <Section id>s in step: registry.test.tsx renders
 * this page and fails if a declared TOC entry has no anchor.
 */
import { DocArticle, Section } from "../kit";
import type { DocTocEntry } from "../registry";

export const WORKSPACE_COMPOSITION_TOC: DocTocEntry[] = [
  { id: "layers", title: "The layers" },
  { id: "inheritance", title: "What inherits, what overrides" },
  { id: "capabilities-manifest", title: "The capabilities manifest" },
];

export function WorkspaceComposition() {
  return (
    <DocArticle
      eyebrow="Agents"
      title="Workspace composition & inheritance"
      lead="What an agent can actually see and do is composed from several layers; this page shows the layers, the order they apply, and what wins."
    >
      <Section id="layers" title="The layers">
        <p>Placeholder — &ldquo;The layers&rdquo; has not been written yet.</p>
      </Section>
      <Section id="inheritance" title="What inherits, what overrides">
        <p>
          Placeholder — &ldquo;What inherits, what overrides&rdquo; has not been
          written yet.
        </p>
      </Section>
      <Section id="capabilities-manifest" title="The capabilities manifest">
        <p>
          Placeholder — &ldquo;The capabilities manifest&rdquo; has not been
          written yet.
        </p>
      </Section>
    </DocArticle>
  );
}
