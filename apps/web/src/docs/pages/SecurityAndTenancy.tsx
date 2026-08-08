/**
 * Security & tenancy (Operations).
 *
 * STUB — the section headings below are the agreed outline (THINK-694);
 * the prose under each is a placeholder for a content pass to replace.
 * Keep the TOC and the <Section id>s in step: registry.test.tsx renders
 * this page and fails if a declared TOC entry has no anchor.
 */
import { DocArticle, Section } from "../kit";
import type { DocTocEntry } from "../registry";

export const SECURITY_AND_TENANCY_TOC: DocTocEntry[] = [
  { id: "tenancy", title: "Tenancy" },
  { id: "identity", title: "Identity and sign-in" },
  { id: "data-boundaries", title: "Data boundaries" },
];

export function SecurityAndTenancy() {
  return (
    <DocArticle
      eyebrow="Operations"
      title="Security & tenancy"
      lead="Everything in the product hangs off one boundary — the tenant. This page says where that line is drawn and what it is enforced by."
    >
      <Section id="tenancy" title="Tenancy">
        <p>Placeholder — &ldquo;Tenancy&rdquo; has not been written yet.</p>
      </Section>
      <Section id="identity" title="Identity and sign-in">
        <p>
          Placeholder — &ldquo;Identity and sign-in&rdquo; has not been written
          yet.
        </p>
      </Section>
      <Section id="data-boundaries" title="Data boundaries">
        <p>
          Placeholder — &ldquo;Data boundaries&rdquo; has not been written yet.
        </p>
      </Section>
    </DocArticle>
  );
}
