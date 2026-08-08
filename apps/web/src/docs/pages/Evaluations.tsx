/**
 * Evaluations (Automations & quality).
 *
 * STUB — the section headings below are the agreed outline (THINK-694);
 * the prose under each is a placeholder for a content pass to replace.
 * Keep the TOC and the <Section id>s in step: registry.test.tsx renders
 * this page and fails if a declared TOC entry has no anchor.
 */
import { DocArticle, Section } from "../kit";
import type { DocTocEntry } from "../registry";

export const EVALUATIONS_TOC: DocTocEntry[] = [
  { id: "test-cases", title: "Test cases" },
  { id: "evaluators", title: "Evaluators" },
  { id: "runs-and-comparison", title: "Runs and comparison" },
];

export function Evaluations() {
  return (
    <DocArticle
      eyebrow="Automations & quality"
      title="Evaluations"
      lead="Evaluations are how you find out whether a change made the agent better, rather than hoping so."
    >
      <Section id="test-cases" title="Test cases">
        <p>Placeholder — &ldquo;Test cases&rdquo; has not been written yet.</p>
      </Section>
      <Section id="evaluators" title="Evaluators">
        <p>Placeholder — &ldquo;Evaluators&rdquo; has not been written yet.</p>
      </Section>
      <Section id="runs-and-comparison" title="Runs and comparison">
        <p>
          Placeholder — &ldquo;Runs and comparison&rdquo; has not been written
          yet.
        </p>
      </Section>
    </DocArticle>
  );
}
