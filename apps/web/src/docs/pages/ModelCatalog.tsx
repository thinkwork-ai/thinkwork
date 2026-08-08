/**
 * Model catalog (Operations).
 *
 * STUB — the section headings below are the agreed outline (THINK-694);
 * the prose under each is a placeholder for a content pass to replace.
 * Keep the TOC and the <Section id>s in step: registry.test.tsx renders
 * this page and fails if a declared TOC entry has no anchor.
 */
import { DocArticle, Section } from "../kit";
import type { DocTocEntry } from "../registry";

export const MODEL_CATALOG_TOC: DocTocEntry[] = [
  { id: "the-catalog", title: "The catalog" },
  { id: "choosing-a-model", title: "Choosing a model" },
  { id: "cost-and-limits", title: "Cost and limits" },
];

export function ModelCatalog() {
  return (
    <DocArticle
      eyebrow="Operations"
      title="Model catalog"
      lead="The model catalog is the set of models your tenant has approved, and the rules that pick one for any given turn."
    >
      <Section id="the-catalog" title="The catalog">
        <p>Placeholder — &ldquo;The catalog&rdquo; has not been written yet.</p>
      </Section>
      <Section id="choosing-a-model" title="Choosing a model">
        <p>
          Placeholder — &ldquo;Choosing a model&rdquo; has not been written yet.
        </p>
      </Section>
      <Section id="cost-and-limits" title="Cost and limits">
        <p>
          Placeholder — &ldquo;Cost and limits&rdquo; has not been written yet.
        </p>
      </Section>
    </DocArticle>
  );
}
