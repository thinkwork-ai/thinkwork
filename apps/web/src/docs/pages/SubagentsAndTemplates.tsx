/**
 * Sub-agents & templates (Agents).
 *
 * STUB — the section headings below are the agreed outline (THINK-694);
 * the prose under each is a placeholder for a content pass to replace.
 * Keep the TOC and the <Section id>s in step: registry.test.tsx renders
 * this page and fails if a declared TOC entry has no anchor.
 */
import { DocArticle, Section } from "../kit";
import type { DocTocEntry } from "../registry";

export const SUBAGENTS_AND_TEMPLATES_TOC: DocTocEntry[] = [
  { id: "subagent-folders", title: "Sub-agent folders" },
  { id: "delegation", title: "How delegation works" },
  { id: "templates", title: "Templates and fleet rollout" },
];

export function SubagentsAndTemplates() {
  return (
    <DocArticle
      eyebrow="Agents"
      title="Sub-agents & templates"
      lead="Sub-agents are folders inside an agent folder: a narrower agent with its own instructions and grants, that the parent can delegate to."
    >
      <Section id="subagent-folders" title="Sub-agent folders">
        <p>
          Placeholder — &ldquo;Sub-agent folders&rdquo; has not been written
          yet.
        </p>
      </Section>
      <Section id="delegation" title="How delegation works">
        <p>
          Placeholder — &ldquo;How delegation works&rdquo; has not been written
          yet.
        </p>
      </Section>
      <Section id="templates" title="Templates and fleet rollout">
        <p>
          Placeholder — &ldquo;Templates and fleet rollout&rdquo; has not been
          written yet.
        </p>
      </Section>
    </DocArticle>
  );
}
