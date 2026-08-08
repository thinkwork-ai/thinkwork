/**
 * Automations & scheduling (Automations & quality) — THINK-700.
 *
 * Grounded in the shipped surface, not the older MDX: the live inventory
 * is /automations (the Settings routes redirect away), the schedule picker
 * offers six presets and no timezone, and there is no per-Space triggers
 * tab — a Space is a field on the Automation. The scheduling section is
 * the point of the page: an interval schedule is anchored to the moment
 * you saved it, which is the one thing everybody gets wrong.
 */
import { Bot, Clock, Inbox, MessageSquare, Webhook } from "lucide-react";
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
import { ScheduleAnchorDiagram } from "../figures/automations";
import type { DocTocEntry } from "../registry";

export const AUTOMATIONS_TOC: DocTocEntry[] = [
  { id: "what-an-automation-is", title: "What an automation is" },
  { id: "creating-one", title: "Creating one" },
  { id: "when-it-runs", title: "When it actually runs" },
  { id: "run-history", title: "Run history" },
  { id: "when-a-run-fails", title: "When a run fails" },
];

export function Automations() {
  return (
    <DocArticle
      eyebrow="Automations & quality"
      title="Automations & scheduling"
      lead="An automation is a standing duty — work the agent does on a schedule or when something calls it, without anyone opening a thread first."
    >
      <Section id="what-an-automation-is" title="What an automation is">
        <p>
          An automation is one simple thing:{" "}
          <strong>a trigger bound to a target</strong>. The trigger decides when
          the work starts. The target decides what the work is. Everything else
          on the form is detail hanging off those two choices.
        </p>
        <p>
          They live under <strong>Automations</strong> in the left sidebar — not
          in Settings. The list shows every automation in your tenant with its
          trigger, its target, whether it is running, and when it last ran.
        </p>

        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/20 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Trigger</th>
                <th className="px-3 py-2 font-medium">Starts the work when</th>
                <th className="px-3 py-2 font-medium">Use it for</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60 text-[13px] [&_td]:px-3 [&_td]:py-2">
              <tr>
                <td className="font-medium whitespace-nowrap">Schedule</td>
                <td className="text-foreground/80">
                  a clock reaches the time you picked
                </td>
                <td className="text-foreground/80">
                  standing duties — a morning digest, a weekly report, an hourly
                  sweep of an inbox
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">Webhook</td>
                <td className="text-foreground/80">
                  something outside ThinkWork posts to a private URL
                </td>
                <td className="text-foreground/80">
                  reacting to another system — a form submission, a CI result,
                  an alert from a tool you already run
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">Manual</td>
                <td className="text-foreground/80">
                  you press <strong>Run now</strong>
                </td>
                <td className="text-foreground/80">
                  work you want packaged and repeatable, but started by a person
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <p>And three targets:</p>
        <ul>
          <li>
            <strong>Agent thread</strong> — the common one. The automation
            carries a block of instructions, and each run hands them to an agent
            as a turn, exactly as if you had typed them.
          </li>
          <li>
            <strong>Routine</strong> — runs a routine you have already defined,
            rather than free-text instructions.
          </li>
          <li>
            <strong>Workflow</strong> — runs a workflow, for multi-step work
            with its own structure.
          </li>
        </ul>

        <Callout tone="note" title="A Space is a field, not a place">
          <p>
            Automations are not configured from inside a <Term>space</Term>.
            There is no triggers tab on a Space. Instead every automation has a{" "}
            <strong>Space</strong> field, and that is what scopes the run — what
            the agent can see, and where the resulting <Term>thread</Term>{" "}
            lands. If you are looking for a Space&apos;s automations, filter the
            Automations list rather than opening the Space.
          </p>
        </Callout>
      </Section>

      <Section id="creating-one" title="Creating one">
        <p>
          <strong>Automations → New automation</strong> opens a single form. The
          fields change shape as you pick a trigger and a target, so most of
          this table will not be on screen at once:
        </p>

        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/20 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Field</th>
                <th className="px-3 py-2 font-medium">Shown for</th>
                <th className="px-3 py-2 font-medium">What it does</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60 text-[13px] [&_td]:px-3 [&_td]:py-2">
              <tr>
                <td className="font-medium whitespace-nowrap">
                  Automation name
                </td>
                <td className="text-muted-foreground">always</td>
                <td className="text-foreground/80">
                  What you will search for later. Name it after the outcome, not
                  the cadence — &ldquo;Overnight support triage&rdquo; beats
                  &ldquo;Daily job 3&rdquo;.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">Trigger</td>
                <td className="text-muted-foreground">always</td>
                <td className="text-foreground/80">
                  Schedule or Webhook. Choosing Schedule reveals the schedule
                  picker; choosing Webhook reveals the URL and token.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">Target</td>
                <td className="text-muted-foreground">always</td>
                <td className="text-foreground/80">
                  Agent thread, Routine or Workflow.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">
                  Agent instructions
                </td>
                <td className="text-muted-foreground">agent thread</td>
                <td className="text-foreground/80">
                  The prompt every run starts from. Write it as a standing
                  order, not a one-off question — it will be read again
                  tomorrow, with none of today&apos;s context in the room.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">Schedule</td>
                <td className="text-muted-foreground">schedule trigger</td>
                <td className="text-foreground/80">
                  Manual, Hourly, Daily, Weekdays, Weekly, or a Custom
                  expression. See below — this field has a sharp edge.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">Run as</td>
                <td className="text-muted-foreground">always</td>
                <td className="text-foreground/80">
                  Whose identity the run uses. This decides which connectors and
                  which personal accounts the agent can reach, because those are
                  per-user. Defaults to you.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">Space</td>
                <td className="text-muted-foreground">always</td>
                <td className="text-foreground/80">
                  Which Space the run belongs to, and therefore what it can see.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">Worker</td>
                <td className="text-muted-foreground">agent thread</td>
                <td className="text-foreground/80">
                  Which agent does the work.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">Thread</td>
                <td className="text-muted-foreground">agent thread</td>
                <td className="text-foreground/80">
                  A new thread per run, or one fixed thread reused forever. A
                  new thread each time keeps runs independent; a fixed thread
                  lets the agent see what it said last time — and grows without
                  limit.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">
                  Maintains document
                </td>
                <td className="text-muted-foreground">agent thread</td>
                <td className="text-foreground/80">
                  Off, create a document on the first run, or keep updating an
                  existing one. This is how you get a living report instead of a
                  pile of threads.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">
                  Email delivery
                </td>
                <td className="text-muted-foreground">
                  agent thread with a document
                </td>
                <td className="text-foreground/80">
                  Mail each new edition of the maintained document to a list of
                  recipients, with a subject you set.
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <p>
          A webhook automation has no URL until it exists — the URL and its
          token are generated when you save. After that, the detail page shows
          both, with copy buttons, and a delivery history of what has called it.
        </p>

        <Callout
          tone="warn"
          title="Treat a webhook body as someone else's text"
        >
          <p>
            Anything posted to a webhook URL arrives as untrusted input. It is
            data for the agent to work on, never instructions for the agent to
            follow — the workspace{" "}
            <DocLink slug="approvals-and-guardrails">guardrails</DocLink> say so
            explicitly. Keep the token private; anyone holding it can start runs
            as whoever the automation runs as.
          </p>
        </Callout>
      </Section>

      <Section id="when-it-runs" title="When it actually runs">
        <p>
          The schedule picker offers six choices. Five of them do what they say;
          the sharp edge is in how the interval ones are anchored.
        </p>

        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/20 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Preset</th>
                <th className="px-3 py-2 font-medium">Fires</th>
                <th className="px-3 py-2 font-medium">Anchored to</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60 text-[13px] [&_td]:px-3 [&_td]:py-2">
              <tr>
                <td className="font-medium whitespace-nowrap">Manual</td>
                <td className="text-foreground/80">
                  never on its own — only when you press Run now
                </td>
                <td className="text-muted-foreground">—</td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">Hourly</td>
                <td className="text-foreground/80">every hour</td>
                <td className="text-foreground/80">the moment you saved it</td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">Daily</td>
                <td className="text-foreground/80">
                  once a day at a time you pick, in 15-minute steps
                </td>
                <td className="text-foreground/80">the clock</td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">Weekdays</td>
                <td className="text-foreground/80">
                  Monday to Friday at that time
                </td>
                <td className="text-foreground/80">the clock</td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">Weekly</td>
                <td className="text-foreground/80">
                  one chosen day at that time
                </td>
                <td className="text-foreground/80">the clock</td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">Custom</td>
                <td className="text-foreground/80">
                  whatever you type — a calendar expression like{" "}
                  <code>cron(0 9 ? * MON-FRI *)</code>, or an interval like{" "}
                  <code>rate(4 hours)</code>
                </td>
                <td className="text-foreground/80">
                  the clock for calendar expressions, the save moment for
                  intervals
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <ScheduleAnchorDiagram />

        <Callout
          tone="warn"
          title="An interval counts from when you saved it, not from midnight"
        >
          <p>
            &ldquo;Every 4 hours&rdquo; does not mean 00:00, 04:00, 08:00. It
            means four hours after you pressed save, and every four hours after
            that. Save at 10:20 and you get 14:20, 18:20, 22:20 — forever, or
            until you edit it. <strong>Editing restarts the clock:</strong> save
            the same automation again at 11:05 and the next run is 15:05, not
            14:20. The same applies to Hourly, which is an interval wearing a
            friendly name.
          </p>
          <p>
            If you need a run at a predictable wall-clock time, use Daily,
            Weekdays or Weekly, or a Custom calendar expression. Those ignore
            when you saved them.
          </p>
        </Callout>

        <Callout tone="note" title="Times are UTC">
          <p>
            There is no timezone picker. A schedule you set for 9:00 AM means
            9:00 AM UTC, and the detail page says so next to the schedule. If
            your team is in Chicago, do the arithmetic once when you create the
            automation — and remember that daylight saving will shift the local
            time twice a year while the UTC time stays put.
          </p>
        </Callout>

        <p>
          One more thing about timing: a run that is still going does not hold
          back the next one. If a schedule fires every hour and the work
          reliably takes ninety minutes, you will have two runs in flight.
          Either lengthen the interval or make the instructions cheap enough to
          finish inside it.
        </p>
      </Section>

      <Section id="run-history" title="Run history">
        <p>Here is what one fire actually does:</p>

        <FlowDiagram>
          <FlowChain>
            <FlowNode
              icon={Clock}
              title="The trigger fires"
              sub="a schedule reaches its time, or a webhook is called"
              tone="source"
            />
            <FlowLink label="check" />
            <FlowNode
              icon={Webhook}
              title="Can this run start?"
              sub="paused, over budget, or missing a worker — and it is recorded as skipped instead"
              tone="neutral"
            />
            <FlowLink label="go" />
            <FlowNode
              icon={Bot}
              title="The agent takes a turn"
              sub="in a new thread titled after the automation, or the fixed thread you chose"
              tone="compute"
            />
            <FlowLink label="record" />
            <FlowNode
              icon={MessageSquare}
              title="The run is written to the ledger"
              sub="status, duration, and a link to the thread it happened in"
              tone="graph"
            />
          </FlowChain>
        </FlowDiagram>

        <p>
          Open any automation and the <strong>Executions</strong> tab lists
          every run, newest first. Each row carries its status, what triggered
          it, when it started, how long it took, and a link into the thread —
          which is where you read what the agent actually did.
        </p>
        <p>
          The right-hand rail on the <strong>Definition</strong> tab is the fast
          version of the same information: <strong>Last ran</strong>,{" "}
          <strong>Last result</strong>, and <strong>Last thread</strong>. The
          Automations list shows <strong>Last run</strong> per row, or{" "}
          <em>Never</em>.
        </p>

        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/20 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Run status</th>
                <th className="px-3 py-2 font-medium">Means</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60 text-[13px] [&_td]:px-3 [&_td]:py-2">
              <tr>
                <td className="font-medium whitespace-nowrap">
                  queued · running
                </td>
                <td className="text-foreground/80">In flight right now.</td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">completed</td>
                <td className="text-foreground/80">
                  The agent finished its turn. That is not the same as
                  &ldquo;did the right thing&rdquo; — open the thread to judge
                  that.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">failed</td>
                <td className="text-foreground/80">
                  The run errored out. See the next section.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">skipped</td>
                <td className="text-foreground/80">
                  The trigger fired but the run was not allowed to start —
                  paused automation, disabled schedule, budget pause, no worker
                  agent. The row records which. A skipped run is the most common
                  answer to &ldquo;why did nothing happen?&rdquo;
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">
                  waiting_for_human
                </td>
                <td className="text-foreground/80">
                  The run stopped for an{" "}
                  <DocLink slug="approvals-and-guardrails">approval</DocLink>{" "}
                  and resumes once somebody decides.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">
                  budget_stopped
                </td>
                <td className="text-foreground/80">
                  The run-as user hit their monthly spend limit.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">
                  escalated · canceled
                </td>
                <td className="text-foreground/80">
                  Handed to a person, or stopped deliberately.
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <p>
          The header of the detail page carries the four things you will
          actually use: <strong>Run now</strong> (start one immediately, off
          schedule), <strong>Pause</strong> / <strong>Resume</strong> (the
          supported off-switch — a paused automation keeps its history and its
          webhook URL), <strong>Refresh</strong>, and <strong>Archive</strong>{" "}
          for one you are done with.
        </p>

        <Callout tone="tip" title="Pause before you debug">
          <p>
            An automation that is failing every hour is also filling its own
            history with noise while you read it. Pause it, fix the
            instructions, use <strong>Run now</strong> to test the fix once,
            then resume. Resuming an interval schedule re-anchors it to that
            moment, which is usually what you want anyway.
          </p>
        </Callout>
      </Section>

      <Section id="when-a-run-fails" title="When a run fails">
        <p>
          A failed run is <strong>not retried</strong>. Nothing tries again five
          minutes later; the automation simply waits for its next scheduled
          fire. So a daily automation that fails is a daily automation that
          produced nothing today, and you find out either because you looked or
          because it told you.
        </p>
        <p>How it tells you depends on the target:</p>

        <FlowDiagram>
          <FlowChain>
            <FlowNode
              icon={MessageSquare}
              title="Agent thread target"
              sub="the failure appears in the run's own thread, alongside whatever the agent had done so far"
              tone="compute"
            />
            <FlowLink label="or" />
            <FlowNode
              icon={Inbox}
              title="Routine or workflow target"
              sub="no thread to write into, so it raises one open item in your inbox instead"
              tone="consumer"
            />
          </FlowChain>
        </FlowDiagram>

        <p>
          That inbox item is deliberately <strong>one per automation</strong>,
          not one per failure. An automation that has failed forty times shows a
          single item with a failure count on it — and a new item is only raised
          once you have dealt with the old one. This is why a broken hourly
          automation does not bury everything else you needed to see.
        </p>

        <p>The usual causes, roughly in order of how often they turn up:</p>
        <ul>
          <li>
            <strong>The run was skipped, not failed.</strong> Check the status
            first. Paused automations and budget pauses account for most
            &ldquo;it stopped working&rdquo; reports.
          </li>
          <li>
            <strong>The run-as user lost a connection.</strong> Connectors are
            per-user. If the person the automation runs as revoked a Google or
            GitHub grant, the automation loses it too — see{" "}
            <DocLink slug="connectors-and-mcp">
              connectors and MCP tools
            </DocLink>
            .
          </li>
          <li>
            <strong>The instructions assumed context that is not there.</strong>{" "}
            An automation runs with no conversation behind it. Instructions that
            worked when you pasted them into a live thread can fail in a fresh
            one — see{" "}
            <DocLink slug="workspace-context">workspace context</DocLink> for
            what the agent can actually see.
          </li>
          <li>
            <strong>The work outgrew the interval,</strong> and overlapping runs
            are now competing for the same fixed thread.
          </li>
        </ul>

        <Callout tone="tip" title="An automation is worth an evaluation">
          <p>
            Instructions that run unattended every morning are exactly the ones
            nobody re-reads. If an automation matters, capture what a good run
            looks like as a test case, so a change to the agent&apos;s
            instructions or skills cannot quietly break it —{" "}
            <DocLink slug="evaluations">evaluations</DocLink> covers how.
          </p>
        </Callout>
      </Section>
    </DocArticle>
  );
}
