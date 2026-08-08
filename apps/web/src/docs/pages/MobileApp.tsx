/**
 * Mobile app (Operations).
 *
 * STUB — the section headings below are the agreed outline (THINK-694);
 * the prose under each is a placeholder for a content pass to replace.
 * Keep the TOC and the <Section id>s in step: registry.test.tsx renders
 * this page and fails if a declared TOC entry has no anchor.
 */
import { DocArticle, Section } from "../kit";
import type { DocTocEntry } from "../registry";

export const MOBILE_APP_TOC: DocTocEntry[] = [
  { id: "getting-the-app", title: "Getting the app" },
  { id: "what-it-does", title: "What it does" },
  { id: "connecting-accounts", title: "Connecting your accounts" },
];

export function MobileApp() {
  return (
    <DocArticle
      eyebrow="Operations"
      title="Mobile app"
      lead="The mobile app is not a shrunken web app: it is where your personal connector accounts live, and where work reaches you between desks."
    >
      <Section id="getting-the-app" title="Getting the app">
        <p>
          Placeholder — &ldquo;Getting the app&rdquo; has not been written yet.
        </p>
      </Section>
      <Section id="what-it-does" title="What it does">
        <p>
          Placeholder — &ldquo;What it does&rdquo; has not been written yet.
        </p>
      </Section>
      <Section id="connecting-accounts" title="Connecting your accounts">
        <p>
          Placeholder — &ldquo;Connecting your accounts&rdquo; has not been
          written yet.
        </p>
      </Section>
    </DocArticle>
  );
}
