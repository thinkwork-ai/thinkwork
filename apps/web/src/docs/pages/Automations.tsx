/**
 * Automations & scheduling (Automations & quality).
 *
 * STUB — the section headings below are the agreed outline (THINK-694);
 * the prose under each is a placeholder for a content pass to replace.
 * Keep the TOC and the <Section id>s in step: registry.test.tsx renders
 * this page and fails if a declared TOC entry has no anchor.
 */
import { DocArticle, Section } from "../kit";
import type { DocTocEntry } from "../registry";

export const AUTOMATIONS_TOC: DocTocEntry[] = [
  { id: "scheduled-jobs", title: "Scheduled jobs" },
  { id: "wakeups", title: "Wakeups" },
  { id: "operating", title: "Operating an automation" },
];

export function Automations() {
  return (
    <DocArticle
      eyebrow="Automations & quality"
      title="Automations & scheduling"
      lead="An automation is a standing duty — work the agent does on a schedule or on an event, without anyone opening a thread first."
    >
      <Section id="scheduled-jobs" title="Scheduled jobs">
        <p>
          Placeholder — &ldquo;Scheduled jobs&rdquo; has not been written yet.
        </p>
      </Section>
      <Section id="wakeups" title="Wakeups">
        <p>Placeholder — &ldquo;Wakeups&rdquo; has not been written yet.</p>
      </Section>
      <Section id="operating" title="Operating an automation">
        <p>
          Placeholder — &ldquo;Operating an automation&rdquo; has not been
          written yet.
        </p>
      </Section>
    </DocArticle>
  );
}
