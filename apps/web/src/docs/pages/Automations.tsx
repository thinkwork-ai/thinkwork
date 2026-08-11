/**
 * Automations & scheduling (Automations & quality) — THINK-700.
 *
 * Converted to the report restyle (Eric 2026-08-11). Claims verified
 * against the shipped code: packages/database-pg/src/schema/agent-loops.ts
 * (trigger families, draft/active/paused/archived lifecycle, the run-status
 * enum, kind 'user'/'system'), packages/api/src/graphql/resolvers/
 * agent-loops/deleteAgentLoop.mutation.ts (system built-ins are never
 * deletable), apps/web/src/components/agent-loops/ (the form fields, the
 * Manual/Hourly/Daily/Weekdays/Weekly/Custom presets with 15-minute steps
 * and UTC timezone, Run now / Pause / Refresh / Archive, the Executions
 * tab, AutomationWebhookPanel's URL + token + delivery history),
 * packages/lambda/job-schedule-manager.ts + CLAUDE.md (rate() anchors at
 * save time, not wall clock), packages/agent-loops-core/src/run-ledger.ts
 * (one OPEN deduplicated failure inbox item per automation, failureCount
 * incremented on repeats), and packages/api/src/lib/agent-loops/
 * run-acting-user.ts + the form's defaultAgentLoopDraft (Run as pre-fills
 * to you; an empty value never falls back to the creator — the invariant
 * itself lives on the triggers & channels page, cross-linked not repeated).
 */
import {
  CardGrid,
  DocLink,
  DocTable,
  Flow,
  FlowArrow,
  FlowBox,
  InfoCard,
  Invariant,
  PullQuote,
  ReportArticle,
  ReportSection,
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
    <ReportArticle
      eyebrow="Automations & quality"
      title="Automations & scheduling"
      lead="An automation is a standing duty — work the agent does on a schedule or when something calls it, without anyone opening a thread first."
    >
      <ReportSection id="what-an-automation-is" title="What an automation is">
        <p>
          An automation is one simple thing:{" "}
          <strong>a trigger bound to a target</strong>. The trigger decides when
          the work starts. The target decides what the work is. Everything else
          on the form is detail hanging off those two choices.
        </p>
        <p>
          Automations live under <strong>Automations</strong> in the left
          sidebar — not in Settings. The list shows every automation in your
          tenant with its trigger, its target, whether it is running, and when
          it last ran. A few rows are platform built-ins: they read like any
          other automation and can be paused, but they can never be deleted —
          the platform owns their definition.
        </p>
        <DocTable
          head={["Trigger", "Starts the work when", "Use it for"]}
          rows={[
            [
              <strong>Schedule</strong>,
              "a clock reaches the time you picked",
              "standing duties — a morning digest, a weekly report, an hourly sweep of an inbox",
            ],
            [
              <strong>Webhook</strong>,
              "something outside ThinkWork posts to a private URL",
              "reacting to another system — a form submission, a CI result, an alert from a tool you already run",
            ],
            [
              <strong>Manual</strong>,
              <>
                you press <strong>Run now</strong>
              </>,
              "work you want packaged and repeatable, but started by a person",
            ],
          ]}
        />
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
        <p>
          One thing the interface deliberately does not have: a triggers tab
          inside a <Term>space</Term>. A Space is a <em>field</em> on the
          automation, and that field is what scopes the run — what the agent can
          see, and where the resulting <Term>thread</Term> lands. If you are
          looking for a Space&apos;s automations, filter the Automations list
          rather than opening the Space.
        </p>
      </ReportSection>

      <ReportSection id="creating-one" title="Creating one">
        <p>
          <strong>Automations → New automation</strong> opens a single form. The
          fields change shape as you pick a trigger and a target, so most of
          this table will not be on screen at once:
        </p>
        <DocTable
          head={["Field", "Shown for", "What it does"]}
          rows={[
            [
              <strong>Automation name</strong>,
              "always",
              <>
                What you will search for later. Name it after the outcome, not
                the cadence — &ldquo;Overnight support triage&rdquo; beats
                &ldquo;Daily job 3&rdquo;.
              </>,
            ],
            [
              <strong>Trigger</strong>,
              "always",
              "Schedule or Webhook. Choosing Schedule reveals the schedule picker; choosing Webhook reveals the URL and token.",
            ],
            [
              <strong>Target</strong>,
              "always",
              "Agent thread, Routine or Workflow.",
            ],
            [
              <strong>Agent instructions</strong>,
              "agent thread",
              "The prompt every run starts from. Write it as a standing order, not a one-off question — it will be read again tomorrow, with none of today's context in the room.",
            ],
            [
              <strong>Schedule</strong>,
              "schedule trigger",
              "Manual, Hourly, Daily, Weekdays, Weekly, or a Custom expression. See below — this field has a sharp edge.",
            ],
            [
              <strong>Run as</strong>,
              "always",
              <>
                Whose identity the run uses — which decides the connectors and
                personal accounts the agent can reach, because those are
                per-user. The form pre-fills it with you; it is never quietly
                the creator. See{" "}
                <DocLink slug="triggers-and-channels">
                  triggers &amp; channels
                </DocLink>{" "}
                for exactly what an empty Run as means.
              </>,
            ],
            [
              <strong>Space</strong>,
              "always",
              "Which Space the run belongs to, and therefore what it can see.",
            ],
            [
              <strong>Worker</strong>,
              "agent thread",
              "Which agent does the work.",
            ],
            [
              <strong>Thread</strong>,
              "agent thread",
              "A new thread per run, or one fixed thread reused forever. A new thread each time keeps runs independent; a fixed thread lets the agent see what it said last time — and grows without limit.",
            ],
            [
              <strong>Maintains document</strong>,
              "agent thread",
              "Off, create a document on the first run, or keep updating an existing one. This is how you get a living report instead of a pile of threads.",
            ],
            [
              <strong>Email delivery</strong>,
              "agent thread with a document",
              "Mail each new edition of the maintained document to a list of recipients, with a subject you set.",
            ],
          ]}
        />
        <p>
          A webhook automation has no URL until it exists — the URL and its
          token are generated when you save. After that, the detail page shows
          both, with copy buttons, and a delivery history of what has called it.
        </p>
        <Invariant title="A webhook body is someone else's text">
          <p>
            Anything posted to a webhook URL arrives as untrusted input. It is
            data for the agent to work on, never instructions for the agent to
            follow — the workspace{" "}
            <DocLink slug="approvals-and-guardrails">guardrails</DocLink> say so
            explicitly. Keep the token private; anyone holding it can start runs
            as whoever the automation runs as.
          </p>
        </Invariant>
      </ReportSection>

      <ReportSection id="when-it-runs" title="When it actually runs">
        <p>
          The schedule picker offers six choices. Five of them do what they say;
          the sharp edge is in how the interval ones are anchored.
        </p>
        <DocTable
          head={["Preset", "Fires", "Anchored to"]}
          rows={[
            [
              <strong>Manual</strong>,
              "never on its own — only when you press Run now",
              "—",
            ],
            [<strong>Hourly</strong>, "every hour", "the moment you saved it"],
            [
              <strong>Daily</strong>,
              "once a day at a time you pick, in 15-minute steps",
              "the clock",
            ],
            [
              <strong>Weekdays</strong>,
              "Monday to Friday at that time",
              "the clock",
            ],
            [
              <strong>Weekly</strong>,
              "one chosen day at that time",
              "the clock",
            ],
            [
              <strong>Custom</strong>,
              <>
                whatever you type — a calendar expression like{" "}
                <code>cron(0 9 ? * MON-FRI *)</code>, or an interval like{" "}
                <code>rate(4 hours)</code>
              </>,
              "the clock for calendar expressions, the save moment for intervals",
            ],
          ]}
        />
        <ScheduleAnchorDiagram />
        <p>
          &ldquo;Every 4 hours&rdquo; does <strong>not</strong> mean 00:00,
          04:00, 08:00. It means four hours after you pressed save, and every
          four hours after that. Save at 10:20 and you get 14:20, 18:20, 22:20 —
          forever, or until you edit it.{" "}
          <strong>Editing restarts the clock:</strong> save the same automation
          again at 11:05 and the next run is 15:05, not 14:20. The same applies
          to Hourly, which is an interval wearing a friendly name. If you need a
          run at a predictable wall-clock time, use Daily, Weekdays or Weekly,
          or a Custom calendar expression — those ignore when you saved them.
        </p>
        <p>
          There is also no timezone picker. A schedule you set for 9:00 AM means
          9:00 AM <strong>UTC</strong>, and the detail page says so next to the
          schedule. If your team is in Chicago, do the arithmetic once when you
          create the automation — and remember that daylight saving will shift
          the local time twice a year while the UTC time stays put.
        </p>
        <p>
          One more thing about timing: a run that is still going does not hold
          back the next one. If a schedule fires every hour and the work
          reliably takes ninety minutes, you will have two runs in flight.
          Either lengthen the interval or make the instructions cheap enough to
          finish inside it.
        </p>
      </ReportSection>

      <ReportSection id="run-history" title="Run history">
        <p>Here is what one fire actually does:</p>
        <Flow vertical>
          <FlowBox
            title="The trigger fires"
            sub="a schedule reaches its time, or a webhook is called"
          />
          <FlowArrow down label="check" />
          <FlowBox
            title="Can this run start?"
            sub="paused, over budget, or missing a worker — recorded as skipped instead"
          />
          <FlowArrow down label="go" />
          <FlowBox
            title="The agent takes a turn"
            sub="in a new thread titled after the automation, or the fixed thread you chose"
          />
          <FlowArrow down label="record" />
          <FlowBox
            title="The run is written to the ledger"
            sub="status, duration, and a link to the thread it happened in"
          />
        </Flow>
        <p>
          Open any automation and the <strong>Executions</strong> tab lists
          every run, newest first. Each row carries its status, what triggered
          it, when it started, how long it took, and a link into the thread —
          which is where you read what the agent actually did. The right-hand
          rail on the <strong>Definition</strong> tab is the fast version of the
          same information: <strong>Last ran</strong>,{" "}
          <strong>Last result</strong>, and <strong>Last thread</strong>. The
          Automations list shows <strong>Last run</strong> per row, or{" "}
          <em>Never</em>.
        </p>
        <DocTable
          head={["Run status", "Means"]}
          rows={[
            [<code>queued · running</code>, "In flight right now."],
            [
              <code>completed</code>,
              <>
                The agent finished its turn. That is not the same as &ldquo;did
                the right thing&rdquo; — open the thread to judge that.
              </>,
            ],
            [<code>failed</code>, "The run errored out. See the next section."],
            [
              <code>skipped</code>,
              <>
                The trigger fired but the run was not allowed to start — paused
                automation, disabled schedule, budget pause, no worker agent.
                The row records which. A skipped run is the most common answer
                to &ldquo;why did nothing happen?&rdquo;
              </>,
            ],
            [
              <code>waiting_for_human</code>,
              <>
                The run stopped for an{" "}
                <DocLink slug="approvals-and-guardrails">approval</DocLink> and
                resumes once somebody decides.
              </>,
            ],
            [
              <code>budget_stopped</code>,
              "The run-as user hit their monthly spend limit.",
            ],
            [
              <code>escalated · canceled</code>,
              "Handed to a person, or stopped deliberately.",
            ],
          ]}
        />
        <p>
          The header of the detail page carries the four things you will
          actually use: <strong>Run now</strong> (start one immediately, off
          schedule), <strong>Pause</strong> / <strong>Resume</strong> (the
          supported off-switch — a paused automation keeps its history and its
          webhook URL), <strong>Refresh</strong>, and <strong>Archive</strong>{" "}
          for one you are done with.
        </p>
        <p>
          A debugging habit worth keeping: an automation that is failing every
          hour is also filling its own history with noise while you read it.
          Pause it, fix the instructions, use <strong>Run now</strong> to test
          the fix once, then resume. Resuming an interval schedule re-anchors it
          to that moment, which is usually what you want anyway.
        </p>
      </ReportSection>

      <ReportSection id="when-a-run-fails" title="When a run fails">
        <p>
          A failed run is <strong>not retried</strong>. Nothing tries again five
          minutes later; the automation simply waits for its next scheduled
          fire. So a daily automation that fails is a daily automation that
          produced nothing today, and you find out either because you looked or
          because it told you. How it tells you depends on the target:
        </p>
        <CardGrid>
          <InfoCard title="Agent thread target">
            <p>
              The failure appears in the run&apos;s own thread, alongside
              whatever the agent had done so far. The Executions row links
              straight to it.
            </p>
          </InfoCard>
          <InfoCard title="Routine or workflow target">
            <p>
              There is no thread to write into, so the failure raises one open
              item in your inbox instead.
            </p>
          </InfoCard>
        </CardGrid>
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
        <PullQuote who="why an automation is worth an evaluation">
          Instructions that run unattended every morning are exactly the ones
          nobody re-reads.
        </PullQuote>
        <p>
          If an automation matters, capture what a good run looks like as a test
          case, so a change to the agent&apos;s instructions or skills cannot
          quietly break it — <DocLink slug="evaluations">evaluations</DocLink>{" "}
          covers how.
        </p>
      </ReportSection>
    </ReportArticle>
  );
}
