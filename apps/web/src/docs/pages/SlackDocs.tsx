/**
 * Slack (Tools & integrations) — THINK-699.
 *
 * Slack is an ingress and delivery surface, not a second agent runtime, and
 * almost every question people ask about it ("why didn't it answer?") is
 * explained by one of two facts: channel turns need an explicit mention, and
 * every turn runs as an explicitly linked person. Both are load-bearing
 * enough to get their own section.
 */
import { ArrowLeftRight, AtSign, MessageSquare, UserCheck } from "lucide-react";
import {
  Callout,
  DocArticle,
  DocLink,
  FlowChain,
  FlowDiagram,
  FlowLink,
  FlowNode,
  Section,
  Term,
} from "../kit";
import type { DocTocEntry } from "../registry";

export const SLACK_DOCS_TOC: DocTocEntry[] = [
  { id: "what-it-is", title: "What the Slack app is" },
  { id: "install", title: "Installing the Slack app" },
  { id: "linking", title: "Linking your Slack identity" },
  { id: "in-conversation", title: "Working in a conversation" },
  { id: "what-it-can-do", title: "What the agent can do in Slack" },
  { id: "data", title: "What ThinkWork sees" },
  { id: "limits", title: "Limits and gotchas" },
];

export function SlackDocs() {
  return (
    <DocArticle
      eyebrow="Tools & integrations"
      title="Slack"
      lead="Mention the agent in a channel or send it a DM, and the turn runs in ThinkWork as you — with the answer delivered back into the same Slack thread."
    >
      <Section id="what-it-is" title="What the Slack app is">
        <p>
          Slack is an <strong>ingress and delivery surface</strong>. It is not a
          second copy of the agent, and it does not keep its own memory or its
          own configuration. A Slack invocation becomes an ordinary{" "}
          <DocLink slug="threads">thread</DocLink> in ThinkWork, runs on the
          same Enterprise Agent with the same tools and the same memory, and the
          finished answer is posted back where it came from.
        </p>
        <FlowDiagram>
          <FlowChain>
            <FlowNode
              icon={AtSign}
              title="@ThinkWork in a channel, or a DM"
              sub="An explicit invocation — nothing else is read"
              tone="consumer"
            />
            <FlowLink label="linked user" />
            <FlowNode
              icon={MessageSquare}
              title="A ThinkWork thread"
              sub="One Slack thread maps to one ThinkWork thread"
              tone="compute"
            />
            <FlowLink label="ordinary turn" />
            <FlowNode
              icon={ArrowLeftRight}
              title="The answer, back in the same Slack thread"
              sub="Exactly once, only for Slack-originated turns"
              tone="graph"
            />
          </FlowChain>
        </FlowDiagram>
        <p>
          Because the ThinkWork thread is a real thread, you can open it in the
          web app or on mobile and keep going there. The reverse does not leak:
          a follow-up you type in the app is <em>not</em> echoed to Slack. Only
          turns that started in Slack answer in Slack.
        </p>
      </Section>

      <Section id="install" title="Installing the Slack app">
        <p>
          A <strong>tenant admin</strong> installs the app once for the whole
          Slack workspace. The install is a standard Slack OAuth flow; when it
          finishes, the workspace&apos;s bot token is stored in your own AWS
          account and the workspace is recorded as installed.
        </p>
        <p>
          The install asks for the minimum set of scopes the shipped surfaces
          actually use — receiving mentions, reading DM and channel messages so
          a mention with an attached file still arrives, reading the messages of
          the thread it was invoked in, downloading files on the invoking
          message, and posting replies. Nothing is requested for behaviour that
          does not exist.
        </p>
        <Callout tone="note" title="Slack never narrows an existing install">
          <p>
            Slack does not retroactively revoke scopes. A workspace installed
            under an older, broader set keeps that grant until someone
            reinstalls — and, in the other direction, a workspace installed
            before a scope was <em>added</em> does not have it. That is why the
            DM &quot;is thinking…&quot; indicator silently falls back to a
            placeholder message on long-installed workspaces: reinstalling is
            the fix.
          </p>
        </Callout>
      </Section>

      <Section id="linking" title="Linking your Slack identity">
        <p>
          Installing the app does not give anyone the ability to run work. Each
          person links their own Slack identity to their own ThinkWork account,
          from Connections in the web app or the Credential Locker on{" "}
          <DocLink slug="mobile-app">mobile</DocLink>.
        </p>
        <FlowDiagram>
          <FlowChain>
            <FlowNode
              icon={UserCheck}
              title="Your Slack user, linked to your ThinkWork user"
              sub="Explicit. There is no matching by email address."
              tone="consumer"
            />
            <FlowLink label="every turn" />
            <FlowNode
              icon={MessageSquare}
              title="The turn runs as you"
              sub="Your permissions, your memory, your connections"
              tone="compute"
            />
          </FlowChain>
        </FlowDiagram>
        <p>
          An unlinked person who mentions the agent gets a prompt to link and{" "}
          <strong>no work runs</strong> — nothing is dispatched, nothing is
          persisted as a request. This is deliberate: a turn always has a named
          human behind it, and the agent never acts as &quot;the bot&quot; or as
          the workspace at large.
        </p>
        <Callout
          tone="warn"
          title="Same Slack thread, two different people, two different results"
        >
          <p>
            Because the requester is whoever invoked, two colleagues mentioning
            the agent in the same Slack thread can legitimately get different
            answers — each turn sees that person&apos;s{" "}
            <DocLink slug="connectors-and-mcp">connections</DocLink> and their
            own <DocLink slug="memory">memory</DocLink>. If a teammate says
            &quot;it works for me&quot;, that is not evidence that it should
            work for you.
          </p>
        </Callout>
      </Section>

      <Section id="in-conversation" title="Working in a conversation">
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/20 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Where</th>
                <th className="px-3 py-2 font-medium">What starts a turn</th>
                <th className="px-3 py-2 font-medium">What you see</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60 text-[13px] [&_td]:px-3 [&_td]:py-2">
              <tr>
                <td className="font-medium whitespace-nowrap">Channel</td>
                <td className="text-foreground/80">
                  An explicit <code>@</code>-mention, every time — including on
                  a reply inside a thread the agent is already in.
                </td>
                <td className="text-foreground/80">
                  A short &quot;working on it&quot; reply in the thread, updated
                  in place with the answer.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">
                  Direct message
                </td>
                <td className="text-foreground/80">
                  Any message. No mention needed.
                </td>
                <td className="text-foreground/80">
                  A native typing status, then the answer as a fresh message.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <Callout
          tone="warn"
          title="The single biggest surprise: a thread reply without a mention is not read"
        >
          <p>
            People reasonably expect that once the agent has answered in a
            thread, it is <em>in</em> that thread and following along. It is
            not. A channel message with no mention is never delivered to
            ThinkWork at all — not read, not stored, not ignored-after-reading.
            Every channel turn needs its own mention.
          </p>
          <p>
            If a back-and-forth is getting tedious, move it to a DM, where every
            message counts as an invocation.
          </p>
        </Callout>
        <p>
          Slack conversations land in your tenant&apos;s{" "}
          <strong>general</strong> <DocLink slug="spaces">Space</DocLink>. There
          is no per-channel routing to a specific Space today — if a
          conversation belongs somewhere more specific, start it there in the
          app.
        </p>
      </Section>

      <Section id="what-it-can-do" title="What the agent can do in Slack">
        <p>
          Everything it can do anywhere. The Slack path changes where a turn
          comes from and where the answer goes; it does not change the toolset,
          the memory, or the guardrails. A Slack turn can call{" "}
          <Term id="connector">connectors</Term>, run a skill, search the web,
          and write to memory exactly as a turn typed in the app would.
        </p>
        <p>Within Slack itself, the app:</p>
        <ul>
          <li>
            <strong>Reads the thread it was invoked in</strong>, up to a bounded
            amount of recent context — best effort. If that fetch fails the turn
            still runs on your message alone.
          </li>
          <li>
            <strong>Takes files you attach to the invoking message</strong> and
            makes them available to the turn. Also best effort: a file that
            cannot be fetched never blocks the text.
          </li>
          <li>
            <strong>Posts one final answer</strong> into the originating
            conversation, exactly once, even if Slack redelivers the event or a
            retry fires.
          </li>
        </ul>
        <p>What it does not do inside Slack:</p>
        <ul>
          <li>
            <strong>Slash commands, shortcuts, modals and buttons</strong> are
            not supported — those endpoints do not exist. A leftover{" "}
            <code>/thinkwork</code> command from an old app configuration will
            fail; remove it in Slack&apos;s app settings.
          </li>
          <li>
            <strong>Rich in-Slack rendering.</strong> Charts and{" "}
            <DocLink slug="charts-and-artifacts">artifacts</DocLink> are app
            surfaces; a Slack answer is the text, with a link when there is
            something to open.
          </li>
        </ul>
      </Section>

      <Section id="data" title="What ThinkWork sees">
        <p>
          Worth being able to say out loud to a security reviewer, because the
          answer is narrower than most people assume:
        </p>
        <ul>
          <li>
            <strong>Only invoked messages.</strong> The app does not ingest
            workspace history, does not index channels, and never reads a
            channel message that did not mention it.
          </li>
          <li>
            <strong>Per invocation</strong>, it processes the message you sent,
            a bounded slice of the thread it lives in, files referenced on that
            message, and the ids needed to route the answer back and to
            de-duplicate Slack&apos;s redeliveries.
          </li>
          <li>
            <strong>Everything stays in your AWS account</strong> — the ingress,
            the storage, the runtime and the reply. Bot tokens live in Secrets
            Manager; they are transport only and never become an identity a turn
            runs as.
          </li>
          <li>
            <strong>Slack content is not used to train models.</strong>
          </li>
        </ul>
        <p>
          <DocLink slug="security-and-tenancy">Security &amp; tenancy</DocLink>{" "}
          covers the boundary this sits inside.
        </p>
      </Section>

      <Section id="limits" title="Limits and gotchas">
        <ul>
          <li>
            <strong>&quot;It ignored me in the channel.&quot;</strong> No
            mention, or you are not linked. Those two cover nearly every report.
          </li>
          <li>
            <strong>&quot;It answered twice.&quot;</strong> It does not —
            delivery is claimed per answer, so Slack retries redrive a failure
            rather than reposting. Two answers means two invocations.
          </li>
          <li>
            <strong>
              &quot;I replied in the app and my teammate never saw it.&quot;
            </strong>{" "}
            Correct and intended: only Slack-originated turns deliver to Slack.
          </li>
          <li>
            <strong>
              &quot;The typing indicator never appears in DMs.&quot;
            </strong>{" "}
            An install predating that scope. Reinstall the workspace.
          </li>
          <li>
            <strong>Uninstalling stops new work, not history.</strong> Removing
            the app or revoking the token ends ingress and delivery immediately;
            the threads it already created remain in ThinkWork like any other
            conversation.
          </li>
        </ul>
      </Section>
    </DocArticle>
  );
}
