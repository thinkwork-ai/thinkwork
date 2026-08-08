/**
 * GitHub & Google Workspace (Tools & integrations) — THINK-699.
 *
 * These two names get grouped together in people's heads and they are almost
 * opposites: Google Workspace is the canonical per-user connector, while
 * GitHub is mostly platform plumbing (workspace version control) with the
 * agent-facing half arriving as an ordinary connector. Saying that plainly is
 * the job of this page.
 */
import { Callout, DocArticle, DocLink, Section } from "../kit";
import type { DocTocEntry } from "../registry";

export const GITHUB_AND_GOOGLE_TOC: DocTocEntry[] = [
  { id: "per-user-oauth", title: "Why these two are different" },
  { id: "google-workspace", title: "Google Workspace" },
  { id: "microsoft-365", title: "Microsoft 365" },
  { id: "github", title: "GitHub" },
  { id: "expiry", title: "Expiry, reconnecting and revoking" },
];

export function GithubAndGoogle() {
  return (
    <DocArticle
      eyebrow="Tools & integrations"
      title="GitHub & Google Workspace"
      lead="Google Workspace is the connector that acts as a specific person — you. GitHub is mostly the opposite: a platform-level installation that keeps agent workspaces under version control. Knowing which is which saves a lot of confused setup."
    >
      <Section id="per-user-oauth" title="Why these two are different">
        <p>
          Both are &quot;GitHub&quot; and &quot;Google&quot; in conversation,
          and they sit at opposite ends of the{" "}
          <DocLink slug="connectors-and-mcp">credential split</DocLink>:
        </p>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/20 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">&nbsp;</th>
                <th className="px-3 py-2 font-medium">Google Workspace</th>
                <th className="px-3 py-2 font-medium">GitHub</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60 text-[13px] [&_td]:px-3 [&_td]:py-2">
              <tr>
                <td className="font-medium whitespace-nowrap">Acts as</td>
                <td className="text-foreground/80">You, personally</td>
                <td className="text-foreground/80">The platform</td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">Set up by</td>
                <td className="text-foreground/80">
                  Each member, for themselves
                </td>
                <td className="text-foreground/80">
                  An operator, once per tenant
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">
                  Mainly used for
                </td>
                <td className="text-foreground/80">
                  Mail and calendar — as context, and as things the agent can
                  act on for you
                </td>
                <td className="text-foreground/80">
                  Version control for agent workspaces, and importing platform
                  extensions
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">
                  Agent-facing tools
                </td>
                <td className="text-foreground/80">
                  Supplied by the skills and connectors wired to your connection
                </td>
                <td className="text-foreground/80">
                  Register GitHub&apos;s MCP server like any other connector
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          The reason a per-user connection exists at all is that some work has
          no meaningful tenant-wide answer. &quot;Check my calendar&quot; is a
          different question for every member, and the only correct credential
          is that member&apos;s own.
        </p>
      </Section>

      <Section id="google-workspace" title="Google Workspace">
        <p>
          <strong>Settings → Connectors → Connections</strong> in the web app,
          or the <strong>Credential Locker</strong> on{" "}
          <DocLink slug="mobile-app">mobile</DocLink>. One row, one Connect
          button, a Google consent screen, done. The row then reads{" "}
          <em>active</em>, <em>expired</em> or <em>not connected</em>.
        </p>
        <p>
          Connecting grants Gmail and Google Calendar access, which enables:
        </p>
        <ul>
          <li>
            <strong>Doing things in your mail and calendar</strong> — the agent
            acting as you through the skills and connectors your tenant has
            wired to Google. It is your token that is used, so anything the
            agent does is something you could have done yourself, and shows up
            in Google&apos;s own audit trail as you.
          </li>
          <li>
            <strong>Mail as a memory source</strong> — your own correspondence
            distilled into your personal <DocLink slug="memory">memory</DocLink>
            , so the agent knows the context of an ongoing thread without you
            pasting it in. This is opt-in and personal: it feeds your memory,
            not the tenant&apos;s.
          </li>
          <li>
            <strong>Personal automations</strong> — the standing kind of duty
            described on{" "}
            <DocLink slug="automations">Automations &amp; scheduling</DocLink>,
            running against your account on a schedule.
          </li>
        </ul>
        <Callout tone="note" title="What is stored from your mail">
          <p>
            Message content never lands inline in the database. A processed mail
            thread is stored encrypted in your own AWS account, and the row that
            indexes it keeps only ids, counts and a content hash. Attachments
            are recorded as metadata — filename, type, size — never content.
          </p>
        </Callout>
        <Callout tone="warn" title="Your connection is genuinely yours">
          <p>
            Nobody else&apos;s agent turn uses your Google token — not an
            operator&apos;s, not a teammate&apos;s, not an unattended job that
            someone else scheduled. The flip side is that a workflow which
            depends on Google works for exactly the people who have connected
            it, and quietly does less for everyone else. When you roll out
            something mail- or calendar-shaped to a team, treat &quot;everyone
            connects&quot; as part of the rollout, not as an afterthought.
          </p>
        </Callout>
      </Section>

      <Section id="microsoft-365" title="Microsoft 365">
        <p>
          The same shape, for Outlook mail and calendar: your own connection,
          made in the same place, with the same per-person semantics. If your
          organisation runs Microsoft rather than Google, everything on this
          page about Google Workspace reads across unchanged — connect the
          Microsoft 365 row instead.
        </p>
        <p>
          There is no benefit to connecting both unless you genuinely use both.
          Two live mail connections means two sources feeding the same personal
          memory.
        </p>
      </Section>

      <Section id="github" title="GitHub">
        <p>
          GitHub shows up in ThinkWork in two places, and neither is the one
          people expect.
        </p>
        <p>
          <strong>Version control for agent workspaces.</strong> When the GitHub
          App is installed for a tenant, every agent&apos;s workspace files —{" "}
          <code>INSTRUCTIONS.md</code>, skills, connector definitions — live in
          a repository, and that repository is the source of truth. Edits made
          in the app are commits; the platform&apos;s own copy is a cache kept
          in step behind the scenes. The payoff is ordinary and large: the agent
          folder has a history, a diff, and a blame. See{" "}
          <DocLink slug="agent-folder">the agent folder</DocLink> for what is in
          it and{" "}
          <DocLink slug="workspace-composition">workspace composition</DocLink>{" "}
          for how it is assembled.
        </p>
        <p>
          <strong>Importing platform extensions.</strong> An operator can point
          the platform at a GitHub repository and ref to bring an extension in
          for review. That is an operator workflow, not an agent capability.
        </p>
        <Callout
          tone="warn"
          title="The GitHub App is not how the agent reads your repos"
        >
          <p>
            This is the trap. Installing the GitHub App does{" "}
            <strong>not</strong> give the agent tools for browsing issues,
            reviewing pull requests or committing to your product repositories —
            it is workspace plumbing for one specific repository. If you want
            the agent to work <em>on</em> GitHub during a turn, register
            GitHub&apos;s MCP server as an ordinary{" "}
            <DocLink slug="connectors-and-mcp">connector</DocLink> and choose
            per-user OAuth, so each engineer&apos;s reach in GitHub is their
            own. Two different systems, similar names.
          </p>
        </Callout>
      </Section>

      <Section id="expiry" title="Expiry, reconnecting and revoking">
        <ul>
          <li>
            <strong>Expiry is normal and visible.</strong> Provider tokens age
            out; the connection row flips to <em>expired</em> and Connect turns
            into Reconnect. Reconnecting is the same one-tap flow.
          </li>
          <li>
            <strong>An expired connection fails quietly at the edges.</strong>{" "}
            The turn still runs, minus that capability — so an automation that
            used to email you and now does not is worth checking here first.
          </li>
          <li>
            <strong>Disconnect is a real revoke.</strong> Disconnecting from
            Connections or the Credential Locker stops the platform using that
            credential. Work already done — threads, memories, artifacts —
            stays; it is a credential, not an eraser.
          </li>
          <li>
            <strong>Revoking at the provider works too</strong>, and shows up
            here as an expired connection on next use. Doing both is the belt
            and braces.
          </li>
        </ul>
      </Section>
    </DocArticle>
  );
}
