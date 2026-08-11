/**
 * Slack (Tools & integrations) — THINK-699.
 *
 * Slack is an ingress and delivery surface, not a second agent runtime, and
 * almost every question people ask about it ("why didn't it answer?") is
 * explained by one of two facts: channel turns need an explicit mention, and
 * every turn runs as an explicitly linked person.
 *
 * Report restyle (2026-08-11). Claims verified against the shipped code:
 * packages/api/src/handlers/slack/events.ts (classifySlackEvent — mention
 * gating, DM behavior, unlinked prompt before any dispatch, thread-context
 * and file fetches best-effort, ack/typing paths), packages/api/src/lib/
 * slack/oauth-state.ts (the requested scope set and the assistant:write
 * reinstall note), user-link-store.ts (link lookup by team + user id, never
 * email), thread-mapping.ts (one mapping per channel thread; a DM channel
 * maps whole to one thread; ingress dedupe; the "general" Space), thread-
 * reply.ts (delivery claim, not_slack_origin skip, artifact share links),
 * format-reply.ts (text-only replies), workspace-store.ts + handlers/slack/
 * oauth-install.ts (admin install, bot token in Secrets Manager),
 * resolvers/slack/uninstallSlackWorkspace.mutation.ts, and
 * docs/reference/compliance/slack-data-handling.md (the training policy).
 */
import {
  DocLink,
  DocTable,
  Flow,
  FlowArrow,
  FlowBox,
  Invariant,
  PullQuote,
  ReportArticle,
  ReportSection,
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
    <ReportArticle
      eyebrow="Tools & integrations"
      title="Slack"
      lead="Mention the agent in a channel or send it a DM, and the turn runs in ThinkWork as you — with the answer delivered back into the same Slack conversation."
    >
      <ReportSection id="what-it-is" title="What the Slack app is">
        <p>
          Slack is an <strong>ingress and delivery surface</strong>. It is not a
          second copy of the agent, and it does not keep its own memory or its
          own configuration. A Slack invocation becomes an ordinary{" "}
          <DocLink slug="threads">thread</DocLink> in ThinkWork, runs on the
          same Enterprise Agent with the same tools and the same memory, and the
          finished answer is posted back where it came from.
        </p>
        <Flow>
          <FlowBox
            title="@ThinkWork, or a DM"
            sub="an explicit invocation"
          />
          <FlowArrow label="as the linked user" />
          <FlowBox
            title="A ThinkWork thread"
            sub="an ordinary turn, ordinary tools"
          />
          <FlowArrow label="exactly once" />
          <FlowBox
            title="The answer, back in Slack"
            sub="same channel, same thread"
          />
        </Flow>
        <p>
          A channel thread maps to one ThinkWork thread; a DM conversation maps
          whole to a single ThinkWork thread that keeps growing. Because the
          ThinkWork thread is a real thread, you can open it in the web app or
          on mobile and keep going there. The reverse does not leak: a
          follow-up you type in the app is <em>not</em> echoed to Slack. Only
          turns that started in Slack answer in Slack.
        </p>
      </ReportSection>

      <ReportSection id="install" title="Installing the Slack app">
        <p>
          A <strong>tenant admin</strong> installs the app once for the whole
          Slack workspace. The install is a standard Slack OAuth flow; when it
          finishes, the workspace&apos;s bot token is stored in Secrets Manager
          in your own AWS account and the workspace is recorded as installed.
        </p>
        <p>
          The install asks for the scopes the shipped surfaces actually use —
          receiving mentions, reading channel and DM messages so a mention with
          an attached file still arrives, reading the messages of the thread it
          was invoked in, downloading files on the invoking message, showing a
          typing status in DMs, and posting replies. Nothing is requested for
          behaviour that does not exist: no slash-command scope, no
          impersonation scope, no email-address scope.
        </p>
        <p>
          One consequence of how Slack handles scopes is worth knowing: Slack
          never changes the grant of an existing install. A workspace installed
          before a scope was added simply does not have it until someone
          reinstalls — which is why, on long-installed workspaces, the DM
          typing indicator silently falls back to a posted placeholder message.
          Reinstalling is the fix.
        </p>
      </ReportSection>

      <ReportSection id="linking" title="Linking your Slack identity">
        <p>
          Installing the app does not give anyone the ability to run work. Each
          person links their own Slack identity to their own ThinkWork account,
          from Connections in the web app or the Credential Locker on{" "}
          <DocLink slug="mobile-app">mobile</DocLink>. The link is explicit —
          you sign in to Slack and confirm — and there is no matching by email
          address, deliberately: a guessed identity is worse than none.
        </p>
        <Invariant title="Every turn has a named human behind it">
          <p>
            A Slack turn runs as the linked person who invoked it — their
            permissions, their memory, their connections. An unlinked person
            who mentions the agent gets a prompt to link and{" "}
            <strong>no work runs</strong>: nothing is dispatched, nothing is
            persisted as a request. The agent never acts as &quot;the
            bot&quot; or as the workspace at large; the bot token is transport,
            not an identity.
          </p>
        </Invariant>
        <p>
          Because the requester is whoever invoked, two colleagues mentioning
          the agent in the same Slack thread can legitimately get different
          answers — each turn sees that person&apos;s{" "}
          <DocLink slug="connectors-and-mcp">connectors</DocLink> and their own{" "}
          <DocLink slug="memory">memory</DocLink>. If a teammate says &quot;it
          works for me&quot;, that is not evidence that it should work for you.
        </p>
      </ReportSection>

      <ReportSection id="in-conversation" title="Working in a conversation">
        <DocTable
          head={["Where", "What starts a turn", "What you see"]}
          rows={[
            [
              <strong>Channel</strong>,
              <>
                An explicit <code>@</code>-mention, every time — including on a
                reply inside a thread the agent is already in.
              </>,
              "A short “working on it” reply in the thread, updated in place with the answer.",
            ],
            [
              <strong>Direct message</strong>,
              "Any message. No mention needed.",
              "A native typing status, then the answer as a fresh message.",
            ],
          ]}
        />
        <PullQuote who="the single biggest surprise, in one sentence">
          Once the agent has answered in a channel thread, it is not
          &quot;in&quot; that thread and following along — a reply with no
          mention never becomes a request, and every channel turn needs its own
          mention.
        </PullQuote>
        <p>
          A channel message that mentions nobody is acknowledged at the front
          door and discarded — it is never stored as a ThinkWork message and no
          work runs on it. What the agent knows of the surrounding conversation
          it reads at invocation time, from the thread you mentioned it in. If
          a back-and-forth is getting tedious, move it to a DM, where every
          message counts as an invocation.
        </p>
        <p>
          Slack conversations land in your tenant&apos;s <strong>general</strong>{" "}
          <DocLink slug="spaces">Space</DocLink>. There is no per-channel
          routing to a specific Space today — if a conversation belongs
          somewhere more specific, start it there in the app.
        </p>
      </ReportSection>

      <ReportSection id="what-it-can-do" title="What the agent can do in Slack">
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
            <strong>Reads the thread it was invoked in</strong>, up to a
            bounded amount of recent context — best effort. If that fetch fails
            the turn still runs on your message alone.
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
            <strong>Slash commands, shortcuts, modals and interactive
            callbacks</strong> are not supported — those endpoints do not
            exist. A leftover <code>/thinkwork</code> command from an old app
            configuration will fail; remove it in Slack&apos;s app settings.
          </li>
          <li>
            <strong>Rich in-Slack rendering.</strong> Charts and{" "}
            <DocLink slug="charts-and-artifacts">artifacts</DocLink> are app
            surfaces; a Slack answer is the text, with a link when there is
            something to open.
          </li>
        </ul>
      </ReportSection>

      <ReportSection id="data" title="What ThinkWork sees">
        <p>
          Worth being able to say out loud to a security reviewer, because the
          answer is narrower than most people assume:
        </p>
        <ul>
          <li>
            <strong>Only invocations become requests.</strong> The app does
            not ingest workspace history, does not index channels, and never
            acts on a channel message that did not mention it.
          </li>
          <li>
            <strong>Per invocation</strong>, it processes the message you
            sent, a bounded slice of the thread it lives in, files referenced
            on that message, and the ids needed to route the answer back and
            to de-duplicate Slack&apos;s redeliveries.
          </li>
          <li>
            <strong>Everything stays in your AWS account</strong> — the
            ingress, the storage, the runtime and the reply. Bot tokens live in
            Secrets Manager; they are transport only and never become an
            identity a turn runs as.
          </li>
          <li>
            <strong>Slack content is not used to train models</strong> — the
            stated policy, with retention following the deployed Bedrock and
            AgentCore configuration.
          </li>
        </ul>
        <p>
          <DocLink slug="security-and-tenancy">Security &amp; tenancy</DocLink>{" "}
          covers the boundary this sits inside.
        </p>
      </ReportSection>

      <ReportSection id="limits" title="Limits and gotchas">
        <DocTable
          head={["Symptom", "What is actually happening"]}
          rows={[
            [
              "“It ignored me in the channel.”",
              "No mention, or you are not linked. Those two cover nearly every report.",
            ],
            [
              "“It answered twice.”",
              "It does not — delivery is claimed per answer, so Slack retries redrive a failure rather than reposting. Two answers means two invocations.",
            ],
            [
              "“I replied in the app and my teammate never saw it.”",
              "Correct and intended: only Slack-originated turns deliver to Slack.",
            ],
            [
              "“The typing indicator never appears in DMs.”",
              "An install predating that scope. Reinstall the workspace.",
            ],
            [
              "“We uninstalled it — is our history gone?”",
              "No. Uninstalling in ThinkWork ends ingress and delivery immediately and deletes the stored bot token; the threads it already created remain like any other conversation. Revoking the token on Slack’s side also stops the app working, though ThinkWork only notices when the next call fails.",
            ],
          ]}
        />
      </ReportSection>
    </ReportArticle>
  );
}
