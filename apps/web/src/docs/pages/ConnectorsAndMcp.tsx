/**
 * Connectors & MCP tools (Tools & integrations) — THINK-699.
 *
 * The section's anchor page: the three families of tool an agent can call,
 * the credential split that decides who has to authorize what, and the
 * workspace folder plus signed sidecar that record the grant.
 *
 * Report restyle (2026-08-11). Claims verified against the shipped code:
 * apps/web/src/components/settings/SettingsTools.tsx (the Tool Library
 * catalog), packages/database-pg/src/schema/builtin-tools.ts +
 * packages/api/src/lib/builtin-tools/{web-search,web-extract}.ts (the
 * credentialed built-ins are off until keyed and enabled),
 * packages/api/src/lib/resolve-agent-runtime-config.ts (the policy-gated
 * built-ins default on; per-agent blocked_tools), packages/agentcore-pi/
 * agent-container/src/server.ts (charts always on; the flat tool list),
 * mcp-connect.ts (listTools discovery, connect timeouts, allowlist filter
 * before the model), packages/database-pg/src/schema/mcp-servers.ts (the
 * registry row and auth types; per-user tokens), packages/api/src/lib/
 * mcp-configs.ts (per-dispatch URL read, per-user credential gating with
 * no tenant fallback, the paired-human fallback for unattended runs),
 * packages/api/src/lib/capabilities/{definition-schemas,sidecar-signing,
 * manifest-compile,folder-write}.ts (signed sidecars, withhold reasons,
 * raw secrets rejected, subset narrowing for sub-agents), and
 * packages/api/src/lib/workspace-constants.ts (the connections/ dual-read).
 *
 * Dropped from the pre-restyle page: the ThinkWork Brain row of the Tool
 * Library table (the runtime path is gated to the retired strands runtime
 * and is inert on Pi), and the claim that every built-in is off by default.
 */
import {
  DocLink,
  DocTable,
  Invariant,
  PullQuote,
  ReportArticle,
  ReportSection,
  Term,
} from "../kit";
import {
  ConnectorCredentialsDiagram,
  ToolCallFlowDiagram,
} from "../figures/tools";
import type { DocTocEntry } from "../registry";

export const CONNECTORS_AND_MCP_TOC: DocTocEntry[] = [
  { id: "three-families", title: "Three families of tool" },
  { id: "built-in-tools", title: "Built-in tools" },
  { id: "mcp-servers", title: "MCP servers" },
  { id: "who-authorizes", title: "Who authorizes what" },
  { id: "in-the-workspace", title: "How a connector lands in the folder" },
  { id: "tool-permissions", title: "Narrowing what a connector can do" },
  { id: "when-it-does-not-work", title: "When a tool does not show up" },
];

export function ConnectorsAndMcp() {
  return (
    <ReportArticle
      eyebrow="Tools & integrations"
      title="Connectors & MCP tools"
      lead="A connector is how an agent reaches a system you already run. Most of them speak MCP — the Model Context Protocol — so registering one is a URL, an auth choice, and a decision about who does the authorizing."
    >
      <ReportSection id="three-families" title="Three families of tool">
        <p>
          By the time a turn starts, everything the agent can call has been
          folded into <strong>one flat list</strong>. The model chooses from it
          by reading tool descriptions; it does not know or care which family a
          tool came from. You care, because the three families are configured
          in three different places by three different people.
        </p>
        <ul>
          <li>
            <strong>Built-in tools</strong> — shipped with the platform: web
            search, a code sandbox, email. Governed from the operator&apos;s
            Tool Library.
          </li>
          <li>
            <strong>Skills</strong> — packaged procedures installed into the
            agent&apos;s folder. Covered on{" "}
            <DocLink slug="skills">Skills</DocLink>.
          </li>
          <li>
            <strong>Connector tools</strong> — discovered at connect time from
            an <Term id="mcp-server">MCP server</Term> you registered. This
            page.
          </li>
        </ul>
        <ToolCallFlowDiagram />
        <p>
          The return edge is the thing worth internalising: a tool result comes
          back <em>into the same turn</em>. The agent can call another tool,
          notice that the first one returned nothing useful, or answer. Nothing
          about a connector is a separate step you wait for.
        </p>
      </ReportSection>

      <ReportSection id="built-in-tools" title="Built-in tools">
        <p>
          <strong>Settings → Tool Library</strong> (operator-only) is the whole
          catalog. The two research tools need a provider and an API key before
          they will do anything; the rest ship on and can be switched off:
        </p>
        <DocTable
          head={["Tool", "What the agent can do", "Turned on by"]}
          rows={[
            [
              <strong>Web Search</strong>,
              "Find candidate URLs and results for research.",
              "An operator, with an Exa or SerpAPI key",
            ],
            [
              <strong>Web Extraction</strong>,
              "Read one known public URL as clean markdown.",
              "An operator, with a Firecrawl key",
            ],
            [
              <strong>Browser Automation</strong>,
              "Operate a site that a fetch cannot — logins, forms, dynamic pages — in a managed browser session.",
              "On by default; an operator can switch it off",
            ],
            [
              <strong>Code Sandbox</strong>,
              "Run Python against real data inside your own AWS account.",
              "On by default; an operator can switch it off",
            ],
            [
              <strong>Send Email</strong>,
              "Send plain-text email from the agent’s address, with replies tracked back to the thread.",
              "On by default; an operator can switch it off",
            ],
            [
              <strong>Generated UI</strong>,
              "Answer with rendered tables and rich blocks instead of prose.",
              "On by default; an operator can switch it off",
            ],
          ]}
        />
        <p>
          Availability is set for the tenant; an individual agent can still be
          told <em>not</em> to use a tool — blocking a tool for one agent is a
          per-agent override, not a change to the library.
        </p>
        <p>
          One capability is deliberately not in the table because it is never
          switched off: every agent can draw a{" "}
          <DocLink slug="charts-and-artifacts">chart</DocLink>. Charting is a
          presentation of data the agent already has, so there is nothing to
          grant.
        </p>
      </ReportSection>

      <ReportSection id="mcp-servers" title="MCP servers">
        <p>
          <strong>Settings → Connectors → MCP Servers</strong> is the tenant
          registry, and registering one is a short form:
        </p>
        <DocTable
          head={["Field", "The decision it encodes"]}
          rows={[
            [
              <strong>Name</strong>,
              "What members see in the list. It is not the tool name — tool names come from the server.",
            ],
            [
              <strong>URL</strong>,
              "The server’s HTTP endpoint. Streamable HTTP is the transport; the URL is read from the registry on every dispatch, so changing it here changes where the next request goes.",
            ],
            [
              <strong>Authentication</strong>,
              <>
                <strong>None</strong> for a private-network service;{" "}
                <strong>API key (tenant)</strong> for one shared secret;{" "}
                <strong>API key (per user)</strong> or <strong>OAuth</strong>{" "}
                when the server must act as a specific person.
              </>,
            ],
            [
              <strong>Enabled</strong>,
              "Enabled servers attach to the tenant’s default agent automatically. Per-agent choices are made in the Composer.",
            ],
          ]}
        />
        <p>
          There is nothing to declare about the tools themselves. The runtime
          connects, asks the server what it exposes, and adds every tool it
          names to the turn&apos;s list. Add a tool to your server and the
          agent can call it on the next turn, with no change here — unless the
          assignment carries an operations allowlist, in which case a new tool
          stays hidden until someone adds it to the list.
        </p>
        <p>
          Connecting is also time-boxed. A server that is slow, unreachable or
          unauthorized is dropped from the turn and the agent proceeds with
          everything else — you get an answer that quietly lacks one
          capability rather than a failed turn. If an agent keeps
          &quot;forgetting&quot; it can do something, suspect this before you
          suspect the prompt.
        </p>
      </ReportSection>

      <ReportSection id="who-authorizes" title="Who authorizes what">
        <p>
          This is the part people get wrong, and it is worth being blunt: a
          connector has <strong>two</strong> possible authorizers, and which
          one applies is decided by the auth type, not by who is in a hurry.
        </p>
        <ConnectorCredentialsDiagram />
        <DocTable
          head={["Connector", "Where it is configured", "Who authorizes"]}
          rows={[
            [
              "Built-in tool",
              "Settings → Tool Library",
              "An operator, once, for everyone",
            ],
            [
              "MCP server — none or tenant key",
              "Settings → Connectors → MCP Servers",
              "An operator, once, for everyone",
            ],
            [
              "MCP server — OAuth or per-user key",
              "Registered by an operator; connected by each member on the server’s detail page, or in the mobile Credential Locker",
              <strong>You, for yourself</strong>,
            ],
            [
              "Google Workspace / Microsoft 365",
              "Settings → Connectors → Connections, or the mobile Credential Locker",
              <strong>You, for yourself</strong>,
            ],
            [
              "Slack workspace",
              "Installed once for the whole Slack workspace",
              "A tenant admin",
            ],
            [
              "Your Slack identity",
              "Connections, or the mobile Credential Locker",
              <strong>You, for yourself</strong>,
            ],
          ]}
        />
        <PullQuote who="the most common support ticket in this area">
          Enabling a per-user server makes it available; each member still has
          to connect. There is deliberately no tenant-wide fallback credential,
          so a server an operator tested as themselves is silently absent for
          everyone who has not connected.
        </PullQuote>
        <p>
          Two consequences follow. First, your connections live with your
          account, not with the client you made them from — connecting in the
          mobile Credential Locker is the same connection the web app shows as
          active, and reconnecting in a second place proves nothing. Second, a
          run with no human requester — a scheduled run, a wakeup — resolves
          per-user connectors against the <em>agent&apos;s paired human</em>{" "}
          instead, so unattended work still acts as a specific, named person.
        </p>
      </ReportSection>

      <ReportSection
        id="in-the-workspace"
        title="How a connector lands in the folder"
      >
        <p>
          Attaching a connector to an agent writes a folder into that
          agent&apos;s workspace — <code>connectors/&lt;slug&gt;/</code> — and
          beside the definition sits a small sidecar file. The folder{" "}
          <em>declares</em> the connector; what <em>activates</em> it is the
          platform&apos;s signature on that sidecar, applied when an operator
          approves the attachment. A sidecar that is unsigned, edited since it
          was signed, or disabled is withheld when the agent&apos;s
          capabilities are compiled — the connector simply is not offered to
          any turn. Removing the folder revokes. See{" "}
          <DocLink slug="agent-folder">the agent folder</DocLink> for the shape
          this fits into.
        </p>
        <DocTable
          head={["Sidecar field", "What it records"]}
          rows={[
            [
              <strong>Enabled</strong>,
              "Attached but paused is a legitimate state, and the list surfaces show it.",
            ],
            [
              <strong>Allowed operations</strong>,
              "The tool allowlist, covered below. Empty means every tool the server exposes.",
            ],
            [
              <strong>Approval policy</strong>,
              <>
                Whether a call pauses for a human first. See{" "}
                <DocLink slug="approvals-and-guardrails">
                  Approvals &amp; guardrails
                </DocLink>
                .
              </>,
            ],
            [
              <strong>Credential references</strong>,
              "Pointers to where the secret lives, never the secret.",
            ],
          ]}
        />
        <Invariant title="Credentials are references, never values">
          <p>
            Nothing in the workspace, and nothing the model reads, contains a
            token. A sidecar carries pointers — a Secrets Manager or SSM
            reference — and a write that tries to inline a secret-shaped value
            is rejected by the server before it lands. The values stay in
            Secrets Manager and are resolved by the platform per call.
          </p>
        </Invariant>
        <p>
          A note on the old spelling: this folder used to be called{" "}
          <code>connections/</code>. It is <code>connectors/</code> now, and
          both spellings still resolve while existing workspaces are moved
          over — so an older memory, transcript or screenshot that says{" "}
          <code>connections/</code> is not wrong, just dated.
        </p>
      </ReportSection>

      <ReportSection
        id="tool-permissions"
        title="Narrowing what a connector can do"
      >
        <p>
          A server that exposes forty tools does not have to hand the agent
          forty tools. The allowlist on the assignment names the operations
          this agent may call, and everything else the server offers is
          filtered out before the model ever sees the tool list — the agent
          cannot ask for a tool it was never shown.
        </p>
        <p>Two narrowing moves are worth knowing:</p>
        <ul>
          <li>
            <strong>Narrow the agent.</strong> Attach the connector with a
            reduced operations list. A reporting agent gets the read tools; the
            write tools may as well not exist.
          </li>
          <li>
            <strong>Narrow a sub-agent further.</strong> A{" "}
            <DocLink slug="subagents-and-templates">sub-agent</DocLink> can
            carry the same connector with a <strong>subset</strong> of its
            parent&apos;s operations — never a superset, and the compiler
            enforces it. Credentials and definitions are not copied down, so
            revoking the connector at the top withers every sub-agent&apos;s
            grant at once, with no edit to any child.
          </li>
        </ul>
        <p>
          Prefer narrowing over instructing. &quot;Never delete anything in
          the CRM&quot; in an instruction file is a preference; leaving the
          delete tool out of the allowlist is a fence. Where you can express a
          limit either way, express it as the fence — instructions are read by
          a model, allowlists are enforced before the model is asked.
        </p>
      </ReportSection>

      <ReportSection
        id="when-it-does-not-work"
        title="When a tool does not show up"
      >
        <p>
          The symptom is almost always the same — the agent says it cannot do
          the thing, or quietly does something else. Work down this list:
        </p>
        <ol>
          <li>
            <strong>Is the server enabled</strong> in Settings → Connectors →
            MCP Servers? Disabled servers are not offered to any turn.
          </li>
          <li>
            <strong>Are you connected</strong>, if it is an OAuth or
            per-user-key server? The status is per person — check it while
            signed in as the person who saw the failure.
          </li>
          <li>
            <strong>Is it attached to this agent?</strong> Tenant registration
            makes a server available; the agent still has to carry it.
          </li>
          <li>
            <strong>Is the operation in the allowlist?</strong> A narrowed
            assignment hides the rest of the server&apos;s tools completely.
          </li>
          <li>
            <strong>Is the server actually reachable?</strong> A connect
            failure drops the server from the turn without failing it — which
            reads, from the outside, exactly like the agent having forgotten
            the capability.
          </li>
        </ol>
        <p>
          When you need to know what a specific turn really had, read the
          thread&apos;s activity rather than reasoning from configuration: the
          timeline records the tool calls, which server they went to, and what
          came back. <DocLink slug="threads">Threads</DocLink> covers reading
          it.
        </p>
      </ReportSection>
    </ReportArticle>
  );
}
