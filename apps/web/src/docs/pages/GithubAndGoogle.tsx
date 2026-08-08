/**
 * GitHub & Google Workspace (Tools & integrations).
 *
 * STUB — the section headings below are the agreed outline (THINK-694);
 * the prose under each is a placeholder for a content pass to replace.
 * Keep the TOC and the <Section id>s in step: registry.test.tsx renders
 * this page and fails if a declared TOC entry has no anchor.
 */
import { DocArticle, Section } from "../kit";
import type { DocTocEntry } from "../registry";

export const GITHUB_AND_GOOGLE_TOC: DocTocEntry[] = [
  { id: "github", title: "GitHub" },
  { id: "google-workspace", title: "Google Workspace" },
  { id: "per-user-oauth", title: "Per-user OAuth" },
];

export function GithubAndGoogle() {
  return (
    <DocArticle
      eyebrow="Tools & integrations"
      title="GitHub & Google Workspace"
      lead="GitHub and Google Workspace are the two connectors that act as a specific person rather than as the tenant — that difference shapes both setups."
    >
      <Section id="github" title="GitHub">
        <p>Placeholder — &ldquo;GitHub&rdquo; has not been written yet.</p>
      </Section>
      <Section id="google-workspace" title="Google Workspace">
        <p>
          Placeholder — &ldquo;Google Workspace&rdquo; has not been written yet.
        </p>
      </Section>
      <Section id="per-user-oauth" title="Per-user OAuth">
        <p>
          Placeholder — &ldquo;Per-user OAuth&rdquo; has not been written yet.
        </p>
      </Section>
    </DocArticle>
  );
}
