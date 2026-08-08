/**
 * Charts & artifacts (Tools & integrations).
 *
 * STUB — the section headings below are the agreed outline (THINK-694);
 * the prose under each is a placeholder for a content pass to replace.
 * Keep the TOC and the <Section id>s in step: registry.test.tsx renders
 * this page and fails if a declared TOC entry has no anchor.
 */
import { DocArticle, Section } from "../kit";
import type { DocTocEntry } from "../registry";

export const CHARTS_AND_ARTIFACTS_TOC: DocTocEntry[] = [
  { id: "inline-charts", title: "Inline charts" },
  { id: "artifacts", title: "Artifacts" },
  { id: "sharing", title: "Sharing and export" },
];

export function ChartsAndArtifacts() {
  return (
    <DocArticle
      eyebrow="Tools & integrations"
      title="Charts & artifacts"
      lead="Not every answer is a paragraph. Charts and artifacts are the structured things an agent can hand back, on web and on mobile alike."
    >
      <Section id="inline-charts" title="Inline charts">
        <p>
          Placeholder — &ldquo;Inline charts&rdquo; has not been written yet.
        </p>
      </Section>
      <Section id="artifacts" title="Artifacts">
        <p>Placeholder — &ldquo;Artifacts&rdquo; has not been written yet.</p>
      </Section>
      <Section id="sharing" title="Sharing and export">
        <p>
          Placeholder — &ldquo;Sharing and export&rdquo; has not been written
          yet.
        </p>
      </Section>
    </DocArticle>
  );
}
