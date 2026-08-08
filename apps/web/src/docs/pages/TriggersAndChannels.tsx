/**
 * Triggers & channels (Spaces & threads).
 *
 * STUB — the section headings below are the agreed outline (THINK-694);
 * the prose under each is a placeholder for a content pass to replace.
 * Keep the TOC and the <Section id>s in step: registry.test.tsx renders
 * this page and fails if a declared TOC entry has no anchor.
 */
import { DocArticle, Section } from "../kit";
import type { DocTocEntry } from "../registry";

export const TRIGGERS_AND_CHANNELS_TOC: DocTocEntry[] = [
  { id: "trigger-types", title: "Trigger types" },
  { id: "channels", title: "Channels" },
  { id: "routing", title: "Routing a trigger to an agent" },
];

export function TriggersAndChannels() {
  return (
    <DocArticle
      eyebrow="Spaces & threads"
      title="Triggers & channels"
      lead="A turn does not have to start with someone typing. Triggers say what can start one; channels say where the answer arrives."
    >
      <Section id="trigger-types" title="Trigger types">
        <p>
          Placeholder — &ldquo;Trigger types&rdquo; has not been written yet.
        </p>
      </Section>
      <Section id="channels" title="Channels">
        <p>Placeholder — &ldquo;Channels&rdquo; has not been written yet.</p>
      </Section>
      <Section id="routing" title="Routing a trigger to an agent">
        <p>
          Placeholder — &ldquo;Routing a trigger to an agent&rdquo; has not been
          written yet.
        </p>
      </Section>
    </DocArticle>
  );
}
