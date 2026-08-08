/**
 * Getting started (Start here).
 *
 * STUB — the section headings below are the agreed outline (THINK-694);
 * the prose under each is a placeholder for a content pass to replace.
 * Keep the TOC and the <Section id>s in step: registry.test.tsx renders
 * this page and fails if a declared TOC entry has no anchor.
 */
import { DocArticle, Section } from "../kit";
import type { DocTocEntry } from "../registry";

export const GETTING_STARTED_TOC: DocTocEntry[] = [
  { id: "what-it-is", title: "What ThinkWork Agent is" },
  { id: "your-first-agent", title: "Your first agent" },
  { id: "where-to-next", title: "Where to go next" },
];

export function GettingStarted() {
  return (
    <DocArticle
      eyebrow="Start here"
      title="Getting started"
      lead="ThinkWork Agent is an AWS-native harness for agents that do real work inside your company — this page is the shortest path from signing in to an agent that answers for itself."
    >
      <Section id="what-it-is" title="What ThinkWork Agent is">
        <p>
          Placeholder — &ldquo;What ThinkWork Agent is&rdquo; has not been
          written yet.
        </p>
      </Section>
      <Section id="your-first-agent" title="Your first agent">
        <p>
          Placeholder — &ldquo;Your first agent&rdquo; has not been written yet.
        </p>
      </Section>
      <Section id="where-to-next" title="Where to go next">
        <p>
          Placeholder — &ldquo;Where to go next&rdquo; has not been written yet.
        </p>
      </Section>
    </DocArticle>
  );
}
