/**
 * Slack (Tools & integrations).
 *
 * STUB — the section headings below are the agreed outline (THINK-694);
 * the prose under each is a placeholder for a content pass to replace.
 * Keep the TOC and the <Section id>s in step: registry.test.tsx renders
 * this page and fails if a declared TOC entry has no anchor.
 */
import { DocArticle, Section } from "../kit";
import type { DocTocEntry } from "../registry";

export const SLACK_DOCS_TOC: DocTocEntry[] = [
  { id: "install", title: "Installing the Slack app" },
  { id: "in-conversation", title: "Working in a conversation" },
  { id: "limits", title: "Limits and gotchas" },
];

export function SlackDocs() {
  return (
    <DocArticle
      eyebrow="Tools & integrations"
      title="Slack"
      lead="Slack is the connector most teams meet first: the agent joins a channel, reads what it is allowed to, and answers in thread."
    >
      <Section id="install" title="Installing the Slack app">
        <p>
          Placeholder — &ldquo;Installing the Slack app&rdquo; has not been
          written yet.
        </p>
      </Section>
      <Section id="in-conversation" title="Working in a conversation">
        <p>
          Placeholder — &ldquo;Working in a conversation&rdquo; has not been
          written yet.
        </p>
      </Section>
      <Section id="limits" title="Limits and gotchas">
        <p>
          Placeholder — &ldquo;Limits and gotchas&rdquo; has not been written
          yet.
        </p>
      </Section>
    </DocArticle>
  );
}
