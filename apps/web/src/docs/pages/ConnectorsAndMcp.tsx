/**
 * Connectors & MCP tools (Tools & integrations).
 *
 * STUB — the section headings below are the agreed outline (THINK-694);
 * the prose under each is a placeholder for a content pass to replace.
 * Keep the TOC and the <Section id>s in step: registry.test.tsx renders
 * this page and fails if a declared TOC entry has no anchor.
 */
import { DocArticle, Section } from "../kit";
import type { DocTocEntry } from "../registry";

export const CONNECTORS_AND_MCP_TOC: DocTocEntry[] = [
  { id: "connectors", title: "Connectors" },
  { id: "mcp-servers", title: "MCP tool servers" },
  { id: "tool-permissions", title: "Tool permissions" },
];

export function ConnectorsAndMcp() {
  return (
    <DocArticle
      eyebrow="Tools & integrations"
      title="Connectors & MCP tools"
      lead="Connectors are how an agent reaches a system you already run; MCP is the protocol underneath most of them."
    >
      <Section id="connectors" title="Connectors">
        <p>Placeholder — &ldquo;Connectors&rdquo; has not been written yet.</p>
      </Section>
      <Section id="mcp-servers" title="MCP tool servers">
        <p>
          Placeholder — &ldquo;MCP tool servers&rdquo; has not been written yet.
        </p>
      </Section>
      <Section id="tool-permissions" title="Tool permissions">
        <p>
          Placeholder — &ldquo;Tool permissions&rdquo; has not been written yet.
        </p>
      </Section>
    </DocArticle>
  );
}
