/**
 * Triggers & channels (Spaces & threads) — report restyle (2026-08-11 docs
 * overhaul).
 *
 * Claims verified against the shipped code:
 * packages/database-pg/src/lib/thread-helpers.ts (channel prefixes; the
 * per-tenant counter; chat/schedule open in_progress, the rest backlog)
 * with packages/api/src/lib/slack/thread-mapping.ts (SLACK- ids minted
 * separately, threads created in_progress, one ThinkWork thread per Slack
 * thread keyed on rootThreadTs, DMs map to a single row, threads created
 * in the general space — no per-channel binding exists),
 * apps/web/src/components/agent-loops/AgentLoopForm.tsx +
 * AutomationWebhookPanel.tsx (the Automations form's Space picker, Run as
 * field, thread-mode toggle, webhook URL + token),
 * apps/web/src/components/schedule-picker/SchedulePicker.tsx +
 * packages/api/src/lib/artifacts/canvas-refresh-schedule.ts +
 * packages/lambda/job-schedule-manager.ts (sub-daily presets are rate()
 * counted from creation, hour/timezone only apply to cron presets),
 * packages/api/src/graphql/resolvers/webhooks/testWebhook.mutation.ts +
 * packages/database-pg/src/schema/webhook-deliveries.ts (Test records a
 * row stamped "test" and dispatches nothing; delivery outcomes + is_replay
 * flag), packages/api/src/handlers/webhooks.ts (POST returns immediately,
 * work runs off a wakeup), packages/api/src/lib/email/space-address.ts +
 * email-channel resolvers (space addresses; provisioning gated on tenant
 * admin), packages/api/src/lib/email/thread-reply.ts (replies threaded via
 * In-Reply-To/References), packages/api/src/lib/slack/format-reply.ts
 * (GFM → Slack mrkdwn), packages/database-pg/src/schema/
 * scheduled-jobs.ts:71-81 + packages/api/src/lib/scheduled-jobs/
 * run-as-authz.ts (Run as never inherits the creator),
 * packages/lambda/job-trigger.ts:1011 (runs titled after the automation),
 * packages/agent-loops-core/src/contracts.ts (new_per_run | fixed thread
 * mode).
 *
 * Two corrections to the older MDX remain load-bearing: schedules and
 * webhooks are configured in Automations (which carries a Space picker),
 * not in Space settings; and Slack has no per-channel binding at all — it
 * always lands in the tenant's general space.
 */
import {
  CardGrid,
  DocLink,
  DocTable,
  InfoCard,
  Invariant,
  ReportArticle,
  ReportSection,
  Term,
} from "../kit";
import type { DocTocEntry } from "../registry";
import { WorkArrivesDiagram } from "../figures/spaces-threads";

export const TRIGGERS_AND_CHANNELS_TOC: DocTocEntry[] = [
  { id: "trigger-types", title: "Trigger types" },
  { id: "channels", title: "Channels" },
  { id: "routing", title: "Routing a trigger to an agent" },
];

export function TriggersAndChannels() {
  return (
    <ReportArticle
      eyebrow="Spaces & threads"
      title="Triggers & channels"
      lead="A turn does not have to start with someone typing. Triggers say what can start one; channels say where the answer arrives."
    >
      <ReportSection id="trigger-types" title="Trigger types">
        <p>
          Several things can start work, and whichever one fires, the result
          is the same shape: a <Term>thread</Term> in a space, with the agent
          running against that space&apos;s context.
        </p>
        <WorkArrivesDiagram />
        <DocTable
          head={["Trigger", "What starts it", "Where you configure it"]}
          rows={[
            [
              <strong>Chat</strong>,
              "You send a message from the web app or the mobile app.",
              <>
                Nothing to configure — pick a space (or none, and get{" "}
                <strong>Chats</strong>) and type.
              </>,
            ],
            [
              <strong>Schedule</strong>,
              "A recurring or one-off time fires and wakes the agent with a standing instruction.",
              <>
                <strong>Automations</strong> — an automation with a{" "}
                <em>Schedule</em> trigger. See{" "}
                <DocLink slug="automations">Automations &amp; scheduling</DocLink>
                .
              </>,
            ],
            [
              <strong>Webhook</strong>,
              "An external system POSTs to a URL you hand it. The whole payload is passed to the agent.",
              <>
                <strong>Automations</strong> — an automation with a{" "}
                <em>Webhook</em> trigger. The URL and token appear after you
                save.
              </>,
            ],
            [
              <strong>Email</strong>,
              "Mail arrives at a space's address, or someone replies to an email the agent sent.",
              <>
                <strong>Settings → Spaces</strong> → the space&apos;s{" "}
                <em>Email</em> section, for the sending side. Inbound addresses
                are provisioned by a tenant admin.
              </>,
            ],
            [
              <strong>Slack</strong>,
              "Someone @-mentions the bot in a channel, or DMs it.",
              <>
                Install the Slack app once per workspace, then each person
                links their account. See <DocLink slug="slack">Slack</DocLink>.
              </>,
            ],
          ]}
        />
        <p>
          One scheduling subtlety catches almost everyone, so it is worth
          stating precisely: <strong>&quot;every 30 minutes&quot; does not
          mean on the half hour</strong>. The presets come in two kinds, and
          they keep time differently:
        </p>
        <CardGrid>
          <InfoCard title="Interval presets (sub-daily)">
            <p>
              Measured from <strong>when you saved the automation</strong> —
              save at 09:07 and a 30-minute schedule fires at 09:37, 10:07,
              10:37. The Time and Timezone fields do not apply to these.
            </p>
          </InfoCard>
          <InfoCard title="Calendar presets (daily and up)">
            <p>
              Daily, weekday and weekly presets are calendar schedules. They
              honour the Time and Timezone fields, so this is how you get 9:00
              sharp in a particular timezone.
            </p>
          </InfoCard>
        </CardGrid>
        <p>
          And one webhook subtlety: the <strong>Test</strong> action records a
          synthetic delivery so you can see what a row looks like — it does{" "}
          <strong>not</strong> call your automation. To prove the path end to
          end, POST to the real URL with its token and then read the delivery
          history, which records every call and its outcome — verified,
          ignored, rate-limited or errored — and flags replays.
        </p>
      </ReportSection>

      <ReportSection id="channels" title="Channels">
        <p>
          Every thread records the channel it came in on. You can read it off
          the thread&apos;s identifier without opening anything: the prefix{" "}
          <em>is</em> the channel.
        </p>
        <DocTable
          head={["Channel", "Identifier", "Where the reply lands"]}
          rows={[
            [
              <strong>Chat</strong>,
              <code>CHAT-1962</code>,
              "Streamed into the thread you are looking at, live.",
            ],
            [
              <strong>Schedule</strong>,
              <code>AUTO-1963</code>,
              "Written to the thread the run opened; nobody is waiting on it, so you read it after the fact.",
            ],
            [
              <strong>Webhook</strong>,
              <code>HOOK-1964</code>,
              "Same — the POST returns immediately, the work happens in the thread.",
            ],
            [
              <strong>Email</strong>,
              <code>EMAIL-1965</code>,
              "Back out as email, threaded onto the original message.",
            ],
            [
              <strong>Slack</strong>,
              <code>SLACK-1966</code>,
              "Posted into the Slack thread it came from, converted to Slack formatting.",
            ],
            [
              <strong>Manual</strong>,
              <code>TICK-1967</code>,
              "A thread opened as a record rather than a conversation.",
            ],
          ]}
        />
        <p>
          The number is a per-tenant counter, not a per-channel one, so
          identifiers interleave across channels and sort by age. The channel
          also sets where a new thread starts: chat, scheduled and Slack
          threads open <em>in progress</em>; the rest open in the backlog.
        </p>
        <p>Two channel behaviours are worth knowing before you rely on them:</p>
        <ul>
          <li>
            <strong>Slack keeps one thread per Slack thread.</strong> A
            follow-up in the same Slack thread continues the same ThinkWork
            thread, so the agent sees its own earlier answer. A new top-level
            mention starts a new one. A DM with the bot is one single thread
            that never rolls over.
          </li>
          <li>
            <strong>A scheduled automation opens a new thread per run</strong>{" "}
            by default, titled after the automation. If you would rather have
            one long-running log, set the automation&apos;s thread mode to a
            fixed thread.
          </li>
        </ul>
      </ReportSection>

      <ReportSection id="routing" title="Routing a trigger to an agent">
        <p>
          There is only one agent, so &quot;routing&quot; is really two
          questions: <strong>which space</strong> does the work land in, and{" "}
          <strong>whose identity</strong> does it run as.
        </p>
        <p>Space is decided at configuration time, per trigger:</p>
        <ul>
          <li>
            <strong>Chat</strong> — the space you are in. Start from{" "}
            <strong>Chats</strong> and it goes to your tenant&apos;s general
            space.
          </li>
          <li>
            <strong>Schedules and webhooks</strong> — an automation has a{" "}
            <strong>Space</strong> field. Set it deliberately: it decides
            which space files the run reads, and which room the resulting
            thread appears in.
          </li>
          <li>
            <strong>Email</strong> — the recipient address names the space.
          </li>
          <li>
            <strong>Slack</strong> — always the tenant&apos;s general space.
            Slack has no per-channel configuration today: every mention and DM
            lands in the general space, whatever channel it came from. If you
            need Slack work carrying a specific space&apos;s context, that
            context has to be tenant-level for now — older docs describing a
            channel-to-space binding describe an intention, not a feature.
          </li>
        </ul>
        <p>
          Identity matters because a turn composes the acting person&apos;s
          context and reach, not the configurer&apos;s. A scheduled or webhook
          run has no human sending it, so an automation carries an explicit{" "}
          <strong>Run as</strong> field.
        </p>
        <Invariant title="An automation never silently runs as its creator">
          <p>
            Set <strong>Run as</strong> and the run gets that person&apos;s
            workspace and permissions. Leave it empty and the run is
            deliberately narrow — the agent&apos;s own baseline and nothing
            personal. It never inherits the permissions of whoever happened to
            create the automation.
          </p>
        </Invariant>
        <p>
          A practical consequence: read the channel before you debug the
          agent. When an automated turn behaves unlike the same prompt in
          chat, the cause is usually one of these three rather than the model
          — it ran in a different space, it ran as nobody, or it ran on a
          different schedule than you think. The thread&apos;s identifier
          tells you the channel, and the automation&apos;s Space and Run as
          fields tell you the rest.
        </p>
      </ReportSection>
    </ReportArticle>
  );
}
