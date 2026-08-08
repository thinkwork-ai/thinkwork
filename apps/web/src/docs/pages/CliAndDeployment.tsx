/**
 * CLI & deployment (Operations).
 *
 * STUB — the section headings below are the agreed outline (THINK-694);
 * the prose under each is a placeholder for a content pass to replace.
 * Keep the TOC and the <Section id>s in step: registry.test.tsx renders
 * this page and fails if a declared TOC entry has no anchor.
 */
import { DocArticle, Section } from "../kit";
import type { DocTocEntry } from "../registry";

export const CLI_AND_DEPLOYMENT_TOC: DocTocEntry[] = [
  { id: "the-cli", title: "The thinkwork CLI" },
  { id: "stages", title: "Stages and deployment" },
  { id: "day-two", title: "Day-two operations" },
];

export function CliAndDeployment() {
  return (
    <DocArticle
      eyebrow="Operations"
      title="CLI & deployment"
      lead="The product deploys itself: one CLI, bundled Terraform, and a stage model that keeps environments genuinely separate."
    >
      <Section id="the-cli" title="The thinkwork CLI">
        <p>
          Placeholder — &ldquo;The thinkwork CLI&rdquo; has not been written
          yet.
        </p>
      </Section>
      <Section id="stages" title="Stages and deployment">
        <p>
          Placeholder — &ldquo;Stages and deployment&rdquo; has not been written
          yet.
        </p>
      </Section>
      <Section id="day-two" title="Day-two operations">
        <p>
          Placeholder — &ldquo;Day-two operations&rdquo; has not been written
          yet.
        </p>
      </Section>
    </DocArticle>
  );
}
