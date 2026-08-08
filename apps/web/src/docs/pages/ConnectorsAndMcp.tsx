/**
 * Connectors & MCP tools (Tools & integrations) — THINK-699.
 *
 * The section's anchor page: the three families of tool an agent can call,
 * the credential split that decides who has to authorize what, and the
 * workspace folder that records the grant. Everything downstream (Slack,
 * GitHub & Google, charts) assumes this page has been read.
 */
import { Callout, DocArticle, DocLink, Section, Term } from "../kit";
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
    <DocArticle
      eyebrow="Tools & integrations"
      title="Connectors & MCP tools"
      lead="A connector is how an agent reaches a system you already run. Most of them speak MCP — the Model Context Protocol — so registering one is a URL, an auth choice, and a decision about who does the authorizing."
    >
      <Section id="three-families" title="Three families of tool">
        <p>
          By the time a turn starts, everything the agent can call has been
          folded into <strong>one flat list</strong>. The model chooses from it
          by reading tool descriptions; it does not know or care which family a
          tool came from. You care, because the three families are configured in
          three different places by three different people.
        </p>
        <ul>
          <li>
            <strong>Built-in tools</strong> — shipped with the platform: web
            search, a code sandbox, email. An operator turns them on for the
            tenant.
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
          The shape of the middle band is the thing worth internalising: a tool
          result comes back <em>into the same turn</em>. The agent can call
          another tool, notice that the first one returned nothing useful, or
          answer. Nothing about a connector is a separate step you wait for.
        </p>
      </Section>

      <Section id="built-in-tools" title="Built-in tools">
        <p>
          <strong>Settings → Tool Library</strong> (operator-only) is the whole
          catalog. Each entry is off until someone turns it on, and a few need a
          provider and an API key before they will do anything:
        </p>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/20 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Tool</th>
                <th className="px-3 py-2 font-medium">What the agent can do</th>
                <th className="px-3 py-2 font-medium">Needs</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60 text-[13px] [&_td]:px-3 [&_td]:py-2">
              <tr>
                <td className="font-medium whitespace-nowrap">Web Search</td>
                <td className="text-foreground/80">
                  Find candidate URLs and results for research.
                </td>
                <td className="text-foreground/80">An Exa or SerpAPI key</td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">
                  Web Extraction
                </td>
                <td className="text-foreground/80">
                  Read one known public URL as clean markdown.
                </td>
                <td className="text-foreground/80">A Firecrawl key</td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">
                  Browser Automation
                </td>
                <td className="text-foreground/80">
                  Operate a site that a fetch cannot — logins, forms, dynamic
                  pages — in a managed browser session.
                </td>
                <td className="text-foreground/80">Operator switch</td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">Code Sandbox</td>
                <td className="text-foreground/80">
                  Run Python against real data inside your own AWS account.
                </td>
                <td className="text-foreground/80">Operator switch</td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">Send Email</td>
                <td className="text-foreground/80">
                  Send plain-text email from the agent&apos;s address, with
                  replies tracked back to the thread.
                </td>
                <td className="text-foreground/80">Operator switch</td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">Generated UI</td>
                <td className="text-foreground/80">
                  Answer with rendered tables and rich blocks instead of prose.
                </td>
                <td className="text-foreground/80">Operator switch</td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">
                  ThinkWork Brain
                </td>
                <td className="text-foreground/80">
                  Query across memory, wiki pages and workspace files in one
                  call. See{" "}
                  <DocLink slug="retrieval-and-context">
                    Retrieval &amp; context
                  </DocLink>
                  .
                </td>
                <td className="text-foreground/80">Operator switch</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          Turning a tool on makes it available to the tenant&apos;s Enterprise
          Agent. An individual agent can still be told <em>not</em> to use one —
          blocking a tool for one agent is a per-agent override, not a change to
          the library.
        </p>
        <p>
          One capability is deliberately not in the table because it is never
          switched off: every agent can draw a{" "}
          <DocLink slug="charts-and-artifacts">chart</DocLink>. Charting is a
          presentation of data the agent already has, so there is nothing to
          grant.
        </p>
      </Section>

      <Section id="mcp-servers" title="MCP servers">
        <p>
          <strong>Settings → Connectors → MCP Servers</strong> is the tenant
          registry, and registering one is a short form:
        </p>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/20 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Field</th>
                <th className="px-3 py-2 font-medium">
                  The decision it encodes
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60 text-[13px] [&_td]:px-3 [&_td]:py-2">
              <tr>
                <td className="font-medium whitespace-nowrap">Name</td>
                <td className="text-foreground/80">
                  What members see in the list. It is not the tool name — tool
                  names come from the server.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">URL</td>
                <td className="text-foreground/80">
                  The server&apos;s HTTP endpoint. Streamable HTTP is the
                  transport; the URL is read from the registry on every call, so
                  changing it here changes where the next request goes.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">
                  Authentication
                </td>
                <td className="text-foreground/80">
                  <strong>None</strong> for a private-network service;{" "}
                  <strong>API key (tenant)</strong> for one shared secret;{" "}
                  <strong>API key (per user)</strong> or <strong>OAuth</strong>{" "}
                  when the server must act as a specific person.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">Enabled</td>
                <td className="text-foreground/80">
                  Enabled servers attach to the tenant&apos;s Enterprise Agent
                  automatically. Per-agent choices are made in the Composer.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          There is nothing to declare about the tools themselves. The runtime
          connects, asks the server what it exposes, and adds every tool it
          names to the turn&apos;s list. Add a tool to your server and the agent
          can call it on the next turn, with no change here.
        </p>
        <Callout tone="note" title="A dead server is skipped, not fatal">
          <p>
            Connecting is time-boxed. A server that is slow, unreachable or
            unauthorized is dropped from the turn and the agent proceeds with
            everything else — you get an answer that quietly lacks one
            capability rather than a failed turn. If an agent keeps
            &quot;forgetting&quot; it can do something, suspect this before you
            suspect the prompt.
          </p>
        </Callout>
      </Section>

      <Section id="who-authorizes" title="Who authorizes what">
        <p>
          This is the part people get wrong, and it is worth being blunt: a
          connector has <strong>two</strong> possible authorizers, and which one
          applies is decided by the auth type, not by who is in a hurry.
        </p>
        <ConnectorCredentialsDiagram />
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/20 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Connector</th>
                <th className="px-3 py-2 font-medium">
                  Where it is configured
                </th>
                <th className="px-3 py-2 font-medium">Who authorizes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60 text-[13px] [&_td]:px-3 [&_td]:py-2">
              <tr>
                <td className="font-medium">Built-in tool</td>
                <td className="text-foreground/80">Settings → Tool Library</td>
                <td className="text-foreground/80">
                  An operator, once, for everyone
                </td>
              </tr>
              <tr>
                <td className="font-medium">MCP server — none or tenant key</td>
                <td className="text-foreground/80">
                  Settings → Connectors → MCP Servers
                </td>
                <td className="text-foreground/80">
                  An operator, once, for everyone
                </td>
              </tr>
              <tr>
                <td className="font-medium">
                  MCP server — OAuth or per-user key
                </td>
                <td className="text-foreground/80">
                  Registered by an operator; connected by each member on the
                  server&apos;s detail page, or in the mobile Credential Locker
                </td>
                <td className="text-foreground/80">
                  <strong>You, for yourself</strong>
                </td>
              </tr>
              <tr>
                <td className="font-medium">
                  Google Workspace / Microsoft 365
                </td>
                <td className="text-foreground/80">
                  Settings → Connectors → Connections, or the mobile Credential
                  Locker
                </td>
                <td className="text-foreground/80">
                  <strong>You, for yourself</strong>
                </td>
              </tr>
              <tr>
                <td className="font-medium">Slack workspace</td>
                <td className="text-foreground/80">
                  Installed once for the whole Slack workspace
                </td>
                <td className="text-foreground/80">A tenant admin</td>
              </tr>
              <tr>
                <td className="font-medium">Your Slack identity</td>
                <td className="text-foreground/80">
                  Connections, or the mobile Credential Locker
                </td>
                <td className="text-foreground/80">
                  <strong>You, for yourself</strong>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <Callout
          tone="warn"
          title="Enabling a server is not the same as connecting it"
        >
          <p>
            The most common support ticket in this area: an operator registers
            an OAuth connector, flips <strong>Enabled</strong>, tests it
            successfully as themselves, and announces it to the team — for whom
            it does nothing. There is deliberately{" "}
            <strong>no tenant-wide fallback credential</strong>. A per-user
            server is assembled into a turn only when <em>that</em> caller has a
            live token, and it is silently absent for everyone else until they
            connect. Enabling makes it <em>available</em>; each member still has
            to connect.
          </p>
        </Callout>
        <Callout tone="tip" title="Connect once, not once per app">
          <p>
            Your connections live with your account, not with the client you
            made them from. Connecting Google Workspace in the mobile Credential
            Locker is the same connection the web app shows as active, and the
            same one an overnight scheduled run uses. Reconnecting in a second
            place proves nothing and fixes nothing.
          </p>
        </Callout>
      </Section>

      <Section
        id="in-the-workspace"
        title="How a connector lands in the folder"
      >
        <p>
          Attaching a connector to an agent writes a folder into that
          agent&apos;s workspace — <code>connectors/&lt;name&gt;/</code> — and
          the folder <em>is</em> the grant. There is no separate assignment list
          to keep in step; if the folder is there, the connector is attached,
          and removing it revokes. See{" "}
          <DocLink slug="agent-folder">the agent folder</DocLink> for the shape
          this fits into.
        </p>
        <p>Beside the definition sits a small sidecar recording:</p>
        <ul>
          <li>
            <strong>Enabled</strong> — attached but paused is a legitimate
            state, and the list surfaces show it.
          </li>
          <li>
            <strong>Allowed operations</strong> — the tool allowlist, covered
            below. Empty means every tool the server exposes.
          </li>
          <li>
            <strong>Approval policy</strong> — whether a call pauses for a human
            first. See{" "}
            <DocLink slug="approvals-and-guardrails">
              Approvals &amp; guardrails
            </DocLink>
            .
          </li>
          <li>
            <strong>Credential references</strong> — pointers to where the
            secret lives, never the secret. Nothing in the workspace, and
            nothing the model reads, contains a token.
          </li>
        </ul>
        <Callout tone="note" title="A note on the old spelling">
          <p>
            This folder used to be called <code>connections/</code>. It is{" "}
            <code>connectors/</code> now, and both spellings still resolve while
            existing workspaces are moved over — so an older memory, transcript
            or screenshot that says <code>connections/</code> is not wrong, just
            dated.
          </p>
        </Callout>
      </Section>

      <Section id="tool-permissions" title="Narrowing what a connector can do">
        <p>
          A server that exposes forty tools does not have to hand the agent
          forty tools. The allowlist on the assignment names the operations this
          agent may call, and everything else the server offers is invisible to
          it — the agent cannot ask for a tool it was never shown.
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
            parent&apos;s operations — never a superset. Credentials and
            definitions are not copied down, so revoking the connector at the
            top withers every sub-agent&apos;s grant at once, with no edit to
            any child.
          </li>
        </ul>
        <Callout tone="tip" title="Prefer narrowing over instructing">
          <p>
            &quot;Never delete anything in the CRM&quot; in an instruction file
            is a preference. Leaving the delete tool out of the allowlist is a
            fence. Where you can express a limit either way, express it as the
            fence — instructions are read by a model, allowlists are enforced
            before the model is asked.
          </p>
        </Callout>
      </Section>

      <Section id="when-it-does-not-work" title="When a tool does not show up">
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
            per-user-key server? The status column reads <em>connected</em>,{" "}
            <em>expired</em> or <em>not connected</em>, and it is per person —
            check it while signed in as the person who saw the failure.
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
            <strong>Is the server actually reachable?</strong> A connect failure
            drops the server from the turn without failing it — which reads,
            from the outside, exactly like the agent having forgotten the
            capability.
          </li>
        </ol>
        <p>
          When you need to know what a specific turn really had, read the
          thread&apos;s activity rather than reasoning from configuration: the
          timeline records the tool calls, which server they went to, and what
          came back. <DocLink slug="threads">Threads</DocLink> covers reading
          it.
        </p>
      </Section>
    </DocArticle>
  );
}
