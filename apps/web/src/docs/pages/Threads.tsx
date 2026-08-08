/**
 * Threads (Spaces & threads).
 *
 * STUB — the section headings below are the agreed outline (THINK-694);
 * the prose under each is a placeholder for a content pass to replace.
 * Keep the TOC and the <Section id>s in step: registry.test.tsx renders
 * this page and fails if a declared TOC entry has no anchor.
 */
import { DocArticle, Section } from "../kit";
import type { DocTocEntry } from "../registry";

export const THREADS_TOC: DocTocEntry[] = [
  { id: "anatomy", title: "Anatomy of a thread" },
  { id: "live-progress", title: "Live progress" },
  { id: "history", title: "History and resumption" },
];

export function Threads() {
  return (
    <DocArticle
      eyebrow="Spaces & threads"
      title="Threads"
      lead="A thread is one conversation with one agent: the messages, the tool calls behind them, and the artifacts the turn produced."
    >
      <Section id="anatomy" title="Anatomy of a thread">
        <p>
          Placeholder — &ldquo;Anatomy of a thread&rdquo; has not been written
          yet.
        </p>
      </Section>
      <Section id="live-progress" title="Live progress">
        <p>
          Placeholder — &ldquo;Live progress&rdquo; has not been written yet.
        </p>
      </Section>
      <Section id="history" title="History and resumption">
        <p>
          Placeholder — &ldquo;History and resumption&rdquo; has not been
          written yet.
        </p>
      </Section>
    </DocArticle>
  );
}
