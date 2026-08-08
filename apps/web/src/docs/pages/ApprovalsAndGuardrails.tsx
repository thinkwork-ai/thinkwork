/**
 * Approvals & guardrails (Automations & quality).
 *
 * STUB — the section headings below are the agreed outline (THINK-694);
 * the prose under each is a placeholder for a content pass to replace.
 * Keep the TOC and the <Section id>s in step: registry.test.tsx renders
 * this page and fails if a declared TOC entry has no anchor.
 */
import { DocArticle, Section } from "../kit";
import type { DocTocEntry } from "../registry";

export const APPROVALS_AND_GUARDRAILS_TOC: DocTocEntry[] = [
  { id: "guardrails", title: "Guardrails" },
  { id: "approvals", title: "Approvals" },
  { id: "audit-trail", title: "Audit trail" },
];

export function ApprovalsAndGuardrails() {
  return (
    <DocArticle
      eyebrow="Automations & quality"
      title="Approvals & guardrails"
      lead="There are two ways to bound what an agent does: rule it out in advance with a guardrail, or route it to a person with an approval."
    >
      <Section id="guardrails" title="Guardrails">
        <p>Placeholder — &ldquo;Guardrails&rdquo; has not been written yet.</p>
      </Section>
      <Section id="approvals" title="Approvals">
        <p>Placeholder — &ldquo;Approvals&rdquo; has not been written yet.</p>
      </Section>
      <Section id="audit-trail" title="Audit trail">
        <p>Placeholder — &ldquo;Audit trail&rdquo; has not been written yet.</p>
      </Section>
    </DocArticle>
  );
}
