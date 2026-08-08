/**
 * Triggers & channels (Spaces & threads) — THINK-697 content pass.
 *
 * Checked against the shipped surfaces. Two corrections to the older MDX are
 * load-bearing here: schedules and webhooks are configured in Automations
 * (which carries a Space picker), not in Space settings; and Slack has no
 * per-channel binding at all — it always lands in the tenant's General space.
 */
import { Callout, DocArticle, DocLink, Section, Term } from "../kit";
import type { DocTocEntry } from "../registry";
import { WorkArrivesDiagram } from "../figures/spaces-threads";

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
          Four things can start work, and whichever one fires, the result is the
          same shape: a <Term>thread</Term> in a space, with the agent running
          against that space&apos;s context.
        </p>
        <WorkArrivesDiagram />
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/20 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Trigger</th>
                <th className="px-3 py-2 font-medium">What starts it</th>
                <th className="px-3 py-2 font-medium">
                  Where you configure it
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60 text-[13px] [&_td]:px-3 [&_td]:py-2">
              <tr>
                <td className="font-medium whitespace-nowrap">Chat</td>
                <td className="text-foreground/80">
                  You send a message from the web app or the mobile app.
                </td>
                <td className="text-foreground/80">
                  Nothing to configure — pick a space (or none, and get{" "}
                  <strong>Chats</strong>) and type.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">Schedule</td>
                <td className="text-foreground/80">
                  A recurring or one-off time fires and wakes the agent with a
                  standing instruction.
                </td>
                <td className="text-foreground/80">
                  <strong>Automations</strong> — an automation with a{" "}
                  <em>Schedule</em> trigger. See{" "}
                  <DocLink slug="automations">
                    Automations &amp; scheduling
                  </DocLink>
                  .
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">Webhook</td>
                <td className="text-foreground/80">
                  An external system POSTs to a URL you hand it. The whole
                  payload is passed to the agent.
                </td>
                <td className="text-foreground/80">
                  <strong>Automations</strong> — an automation with a{" "}
                  <em>Webhook</em> trigger. The URL and token appear after you
                  save.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">Email</td>
                <td className="text-foreground/80">
                  Mail arrives at a space&apos;s address, or someone replies to
                  an email the agent sent.
                </td>
                <td className="text-foreground/80">
                  <strong>Settings → Spaces → </strong>the space&apos;s{" "}
                  <em>Email</em> section, for the sending side. Inbound
                  acceptance is operator-provisioned.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">Slack</td>
                <td className="text-foreground/80">
                  Someone @-mentions the bot in a channel, or DMs it.
                </td>
                <td className="text-foreground/80">
                  Install the Slack app once per workspace, then each person
                  links their account. See <DocLink slug="slack">Slack</DocLink>
                  .
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <Callout
          tone="warn"
          title='"Every 30 minutes" does not mean on the half hour'
        >
          <p>
            Sub-daily presets are expressed as an interval, and an interval is
            measured from <strong>when you saved the automation</strong> — save
            at 09:07 and a 30-minute schedule fires at 09:37, 10:07, 10:37.
            Time-of-day and timezone are ignored for these, because they only
            apply to calendar-style schedules.
          </p>
          <p>
            If you need 9:00 sharp in a particular timezone, use a daily,
            weekday or weekly preset — those are calendar schedules and do
            honour the Time and Timezone fields.
          </p>
        </Callout>
        <Callout tone="note" title="Testing a webhook">
          <p>
            The <strong>Test</strong> action records a synthetic delivery so you
            can see what a row looks like — it does <strong>not</strong> call
            your automation. To prove the path end to end, POST to the real URL
            with its token and then look at the delivery history, which records
            every call: accepted, rejected, rate-limited or replayed.
          </p>
        </Callout>
      </Section>

      <Section id="channels" title="Channels">
        <p>
          Every thread records the channel it came in on. You can read it off
          the thread&apos;s identifier without opening anything: the prefix{" "}
          <em>is</em> the channel.
        </p>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/20 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Channel</th>
                <th className="px-3 py-2 font-medium">Identifier</th>
                <th className="px-3 py-2 font-medium">Where the reply lands</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60 text-[13px] [&_td]:px-3 [&_td]:py-2">
              <tr>
                <td className="font-medium whitespace-nowrap">Chat</td>
                <td className="text-foreground/80">
                  <code>CHAT-1962</code>
                </td>
                <td className="text-foreground/80">
                  Streamed into the thread you are looking at, live.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">Schedule</td>
                <td className="text-foreground/80">
                  <code>AUTO-1963</code>
                </td>
                <td className="text-foreground/80">
                  Written to the thread the run opened; nobody is waiting on it,
                  so you read it after the fact.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">Webhook</td>
                <td className="text-foreground/80">
                  <code>HOOK-1964</code>
                </td>
                <td className="text-foreground/80">
                  Same — the POST returns immediately, the work happens in the
                  thread.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">Email</td>
                <td className="text-foreground/80">
                  <code>EMAIL-1965</code>
                </td>
                <td className="text-foreground/80">
                  Back out as email, threaded onto the original message.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">Slack</td>
                <td className="text-foreground/80">
                  <code>SLACK-1966</code>
                </td>
                <td className="text-foreground/80">
                  Posted into the Slack thread it came from, converted to Slack
                  formatting.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">Manual</td>
                <td className="text-foreground/80">
                  <code>TICK-1967</code>
                </td>
                <td className="text-foreground/80">
                  A thread opened as a record rather than a conversation.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          The number is a per-tenant counter, not a per-channel one, so
          identifiers interleave across channels and sort by age. The channel
          also sets where a new thread starts: chat and scheduled threads open{" "}
          <em>in progress</em>, everything else opens in the backlog.
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
      </Section>

      <Section id="routing" title="Routing a trigger to an agent">
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
            <strong>Space</strong> field. Set it deliberately: it decides which
            space files the run reads, and which room the resulting thread
            appears in.
          </li>
          <li>
            <strong>Email</strong> — the recipient address names the space.
          </li>
          <li>
            <strong>Slack</strong> — always the tenant&apos;s general space.
          </li>
        </ul>
        <Callout
          tone="warn"
          title="A Slack channel cannot be pointed at a space"
        >
          <p>
            Slack has no per-channel configuration today. Every mention and DM
            reaches the tenant agent and lands in the general space, whatever
            channel it came from. If you need Slack work carrying a specific
            space&apos;s context, that context has to be tenant-level for now —
            older docs describing a channel-to-space binding describe an
            intention, not a feature.
          </p>
        </Callout>
        <p>
          Identity matters because a turn composes the acting person&apos;s
          context and reach, not the configurer&apos;s. A scheduled or webhook
          run has no human sending it, so an automation carries an explicit{" "}
          <strong>Run as</strong> field. Set it and the run gets that
          person&apos;s workspace and permissions; leave it empty and the run is
          deliberately narrow — the agent&apos;s own baseline and nothing
          personal. It never silently inherits whoever created the automation.
        </p>
        <Callout tone="tip" title="Read the channel before you debug the agent">
          <p>
            When an automated turn behaves unlike the same prompt in chat, the
            cause is usually one of these three rather than the model: it ran in
            a different space, it ran as nobody, or it ran on a different
            schedule than you think. The thread&apos;s identifier tells you the
            channel, and the automation&apos;s Space and Run as fields tell you
            the rest.
          </p>
        </Callout>
      </Section>
    </DocArticle>
  );
}
