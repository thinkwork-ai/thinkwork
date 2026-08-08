/**
 * App tour (Start here).
 *
 * STUB — the section headings below are the agreed outline (THINK-694);
 * the prose under each is a placeholder for a content pass to replace.
 * Keep the TOC and the <Section id>s in step: registry.test.tsx renders
 * this page and fails if a declared TOC entry has no anchor.
 */
import { DocArticle, Section } from "../kit";
import type { DocTocEntry } from "../registry";

export const APP_TOUR_TOC: DocTocEntry[] = [
  { id: "work-surfaces", title: "The work surfaces" },
  { id: "settings", title: "Settings and operator surfaces" },
  { id: "shared-idioms", title: "Shared idioms" },
];

export function AppTour() {
  return (
    <DocArticle
      eyebrow="Start here"
      title="App tour"
      lead="A walk through the app in the order you meet it — the work surfaces first, then the operator settings that configure them."
    >
      <Section id="work-surfaces" title="The work surfaces">
        <p>
          Placeholder — &ldquo;The work surfaces&rdquo; has not been written
          yet.
        </p>
      </Section>
      <Section id="settings" title="Settings and operator surfaces">
        <p>
          Placeholder — &ldquo;Settings and operator surfaces&rdquo; has not
          been written yet.
        </p>
      </Section>
      <Section id="shared-idioms" title="Shared idioms">
        <p>
          Placeholder — &ldquo;Shared idioms&rdquo; has not been written yet.
        </p>
      </Section>
    </DocArticle>
  );
}
