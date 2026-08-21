/**
 * Threads (Spaces & threads) — report restyle (2026-08-11 docs overhaul).
 *
 * Claims verified against the shipped code:
 * packages/database-pg/src/lib/thread-helpers.ts (channel prefixes, the
 * per-tenant issue counter, initial status per channel),
 * packages/api/src/graphql/resolvers/messages/sendMessage.mutation.ts +
 * sendMessage.agent-handling.ts (the 80-character word-trimmed title; one
 * default agent turn per message; multiplayer suppresses auto-dispatch,
 * mentions still dispatch), packages/api/src/lib/threads/thread-mode.ts +
 * packages/database-pg/src/schema/threads.ts:85-89 (mode derived from the
 * human participant count; the override is a thread column that pins the
 * mode for every participant), packages/api/src/lib/thread-checkout.ts
 * (one turn at a time; STALE_CHECKOUT_MINUTES = 10) with wakeup-defer.ts
 * (the queued second message), packages/pi-runtime-core/src/
 * durable-session-manager.ts + threads.session_data (durable resume — a
 * cold turn reconstructs what a warm one had), and
 * packages/database-pg/src/schema/work-items.ts (work items own task
 * state; per-space statuses; thread links).
 *
 * Deliberately not claimed: a rendered step-boundary separator (the stream
 * carries start-step/finish-step but the web merge reducer no-ops them),
 * and any specific idle window after which a warm session expires (no TTL
 * constant exists in this repo — only the user-visible warm/cold effect is
 * stated). The warm-session material stays phrased as user-visible effect
 * rather than AWS wiring; the reader does not operate the runtime.
 *
 * Sources section (2026-08-13, #4277/#4278): claims verified against
 * apps/web/src/components/ai-elements/sources.tsx (knowledge sources +
 * numbered citations from search_knowledge, MCP knowledge servers and
 * brain_ask grounded answers), data-sources.tsx + documents/
 * DataCitationViewer.tsx (dataCitations rows; query text present only when
 * the caller's access allowed it server-side — the viewer states when it is
 * withheld), and workbench/TaskThreadView.tsx (cards anchor to the reply;
 * inline [n] markers linkify against the turn's citation map; citations are
 * read from the stored turn payloads, so history renders them too).
 * Deliberately not claimed: that every reply carries inline [n] markers —
 * marker emission is the model following workspace instructions, so the
 * inline chips are documented conditionally ("when the reply cites
 * inline") while the cards are unconditional.
 *
 * Chat-latency program (2026-08-20, #4296-#4308). Eric 2026-08-20: the
 * phase list and the turn header are the same object read two ways — what
 * the turn is doing now, and what it cost when it finished — so the phases
 * extend "Live progress" and the header gets one new section,
 * `turn-receipt` (permanent slug). Claims verified against apps/web/src/
 * components/workbench/TaskThreadView.tsx:5097-5221 (the "Workspace sync"
 * and "AgentCore phases" rows, AGENTCORE_PHASE_LABELS, and the
 * bootstrap/sync de-duplication), :5949-5972 (formatTokenUsage — "N in /
 * N out / N cache read / N cache write"), :5767-5769 (formatUsd) and
 * :4335-4425 (usage and cost chips render only on a finished turn),
 * workbench/turnHeader.ts ("Queued…" / "Working…" / "Worked for {dur}" /
 * "Failed after {dur}"), workbench/useTurnElapsed.ts +
 * TaskThreadView.tsx:2489-2524 (a delivered reply is terminal for display,
 * so the timer stops when the answer lands), packages/agentcore-pi/
 * agent-container/src/server.ts (the eleven runtime.* phases the UI can
 * render; workspace_bootstrap, tool_assembly and session_resume record
 * `skipped` with detail `session_reuse=warm`), packages/api/src/lib/
 * chat-finalize/process-finalize.ts (the assistant message is inserted and
 * published before the deferred tail flips the turn to succeeded — the
 * answer arrives first, the chips a beat later), packages/api/src/lib/
 * agentcore-session-prewarm.ts + graphql/resolvers/threads/
 * createThread.mutation.ts:597-656 (a thread created without an opening
 * message fires an inert warm ping; enabled unless
 * AGENTCORE_SESSION_PREWARM is explicitly off), and packages/api/src/lib/
 * agentcore-session-id.ts + terraform/modules/app/lambda-api/
 * variables.tf:808-816 (per-user session keying is a per-stage setting,
 * default "thread", with a per-thread fallback on the first conflict).
 *
 * Deliberately not claimed here: the conflict-wait and other api.* phases
 * (stdout-only operator telemetry that never reaches the panel), any
 * specific cold-start duration, and that per-user session scope is on for
 * a given reader — the default is per-thread, so cross-thread warmth is
 * written as something a deployment may enable, not promised behavior.
 */
import {
  CardGrid,
  DocLink,
  DocTable,
  Flow,
  FlowArrow,
  FlowBox,
  InfoCard,
  PullQuote,
  ReportArticle,
  ReportSection,
  Term,
} from "../kit";
import type { DocTocEntry } from "../registry";

export const THREADS_TOC: DocTocEntry[] = [
  { id: "anatomy", title: "Anatomy of a thread" },
  { id: "live-progress", title: "Live progress" },
  { id: "turn-receipt", title: "Reading the turn header" },
  { id: "sources", title: "Where an answer came from" },
  { id: "history", title: "History and resumption" },
];

export function Threads() {
  return (
    <ReportArticle
      eyebrow="Spaces & threads"
      title="Threads"
      lead="A thread is one conversation with one agent: the messages, the tool calls behind them, and the artifacts the turn produced."
    >
      <ReportSection id="anatomy" title="Anatomy of a thread">
        <p>
          Every thread lives in exactly one <Term>space</Term> and carries an
          identifier — <code>CHAT-1962</code>, <code>AUTO-1963</code> — whose
          prefix names the channel it arrived on. Its title is the first
          eighty characters of your opening message, trimmed at a word;
          automated runs are titled after the automation that started them.
          Nothing renames a thread afterwards unless you do.
        </p>
        <p>
          Inside, two records run in parallel, and it is worth keeping them
          apart:
        </p>
        <CardGrid>
          <InfoCard title="Messages">
            <p>
              The conversation — what you said, what the agent said back. That
              is what the chat view renders.
            </p>
          </InfoCard>
          <InfoCard title="Turns">
            <p>
              The execution behind a message: the model call plus every tool
              call, skill run and step it took to get there. One message from
              you produces one turn, however much work happened inside it.
            </p>
          </InfoCard>
        </CardGrid>
        <p>
          So a single question is two messages and one turn. The turn is the
          receipt; the messages are the conversation.
        </p>
        <Flow vertical>
          <FlowBox title="Your message" sub="lands in the thread immediately" />
          <FlowArrow down label="one turn" />
          <FlowBox
            title="The agent turn"
            sub="space files, memory, your context"
          />
          <FlowArrow down label="as needed" />
          <FlowBox
            title="Tools and skills"
            sub="each call shown as it runs"
          />
          <FlowArrow down label="finishes" />
          <FlowBox
            title="What you get back"
            sub="reply, charts, artifacts, work items"
          />
        </Flow>
        <p>
          A thread also has a <strong>mode</strong>, and it changes whether
          the agent answers by default. In <strong>Agent mode</strong> — the
          default while you are the only human in the thread — every message
          you send dispatches a turn. In <strong>Multiplayer mode</strong> a
          second person is in the thread, so the agent stops answering
          automatically and you can talk to each other; mention it explicitly
          to bring it back in.
        </p>
        <p>
          The mode is derived from how many people are in the thread, and it
          flips the moment a second one joins. You can pin it either way from
          the thread&apos;s info panel, and the pin applies to everyone in the
          thread, not just you.
        </p>
        <p>
          Mentioning someone lets them in: @-mentioning a colleague makes them
          a participant of <em>that thread</em> — including a thread in a
          private space they are not a member of. It is thread-level access:
          they can read and reply here, and they still cannot start new work
          in the space. See <DocLink slug="spaces">Spaces</DocLink>.
        </p>
        <p>
          One thing a thread does <em>not</em> own is task state. Threads
          carry a status and a priority, and they are largely vestigial — the
          platform tracks real task state in <strong>work items</strong>,
          which belong to the space, carry statuses the space itself defines,
          and can link to the threads that discussed them. If you want to know
          whether something is actually done, look at the work item, not the
          thread.
        </p>
      </ReportSection>

      <ReportSection id="live-progress" title="Live progress">
        <p>
          A turn is not a black box that eventually emits an answer. The
          thread streams while it works, and you see:
        </p>
        <ul>
          <li>
            <strong>The reply, as it is written</strong> — text arrives in
            fragments rather than all at once.
          </li>
          <li>
            <strong>Reasoning</strong>, where the model exposes it, as a
            separate strand from the answer.
          </li>
          <li>
            <strong>Each tool call</strong> — which tool, the arguments as
            they are assembled, and the result when it returns. Failures show
            as failures rather than vanishing.
          </li>
        </ul>
        <p>
          Charts and artifacts appear inline as the turn emits them, and an
          artifact created during a turn is automatically attached to the
          thread — you do not have to save it anywhere. Because artifacts
          belong to the space rather than the thread, you can keep editing one
          from a later conversation. See{" "}
          <DocLink slug="charts-and-artifacts">Charts &amp; artifacts</DocLink>
          .
        </p>
        <p>
          A thread runs <strong>a single turn at a time</strong>. Send a
          second message while the first is still working and it is saved
          immediately — you will see it in the thread — but the agent picks it
          up after the running turn finishes rather than racing itself. If a
          turn dies without cleaning up, the thread unblocks itself after
          about ten minutes and the next message runs normally; a thread that
          appears stuck for longer than that is worth reporting, not waiting
          on.
        </p>
        <p>
          A finished turn also keeps a breakdown of where its time went. Open{" "}
          <strong>AgentCore phases</strong> in the turn&apos;s activity list
          and you get one line per stage, each with how long it took and
          whether it ran at all:
        </p>
        <DocTable
          head={["Phase", "What was happening"]}
          rows={[
            [
              <strong>Starting agent VM</strong>,
              "Waiting for a machine to run on. This is the part that used to be invisible, and on a cold start it is often the largest single number in the list.",
            ],
            [
              <strong>Preparing turn</strong>,
              "Working out who is asking, which agent answers, and what this turn is allowed to do.",
            ],
            [
              <strong>Syncing workspace</strong>,
              "Pulling the space's files down so the agent reads what you would read. Recorded as skipped on a warm session — the files are already there.",
            ],
            [
              <strong>Indexing workspace</strong>,
              "Making those files searchable for the turn.",
            ],
            [
              <strong>Assembling tools</strong>,
              "Connecting the connectors and MCP servers this agent can reach. Also skipped on a warm session.",
            ],
            [
              <strong>Loading conversation</strong>,
              "Restoring the thread's earlier turns. Skipped when the session still holds them.",
            ],
            [
              <strong>Agent loop</strong>,
              "The model actually working — reasoning, calling tools, writing the reply. On a healthy turn this is where most of the time belongs.",
            ],
            [
              <strong>Saving conversation</strong>,
              "Writing session state back, so the next turn resumes from it.",
            ],
            [
              <strong>Wrapping up</strong>,
              "Reconciling the files the turn changed, then handing the result back to the app.",
            ],
          ]}
        />
        <p>
          The phases deliberately do not add up to the header&apos;s total,
          and no sum is shown: the agent loop already contains the tool and
          model time inside it, so adding the rows together would
          double-count. Read them as <em>where the time sat</em>, not as a
          budget.
        </p>
        <p>
          The line worth watching is <strong>Starting agent VM</strong>. A
          second or two is ordinary. A much larger number means the turn
          waited for a machine to be provisioned, which is the difference
          between the first question of a session and every one after it — see{" "}
          <a href="#history">History and resumption</a>.
        </p>
      </ReportSection>

      <ReportSection id="turn-receipt" title="Reading the turn header">
        <p>
          Every turn collapses to a single line above the reply, and that line
          is the whole receipt. While the turn runs it reads{" "}
          <strong>Working…</strong> with a live clock beside it — or{" "}
          <strong>Queued…</strong> before it has started. When it finishes,
          the line carries three things:
        </p>
        <Flow>
          <FlowBox title="Worked for 1m 30s" sub="wall clock for the turn" />
          <FlowBox title="12.4K in / 1.1K out" sub="tokens the turn used" />
          <FlowBox title="$0.0342" sub="priced from the model catalog" />
        </Flow>
        <p>
          A turn that ended badly says so in the same place rather than going
          quiet: <strong>Failed after 12s</strong>,{" "}
          <strong>Cancelled after 12s</strong>,{" "}
          <strong>Timed out after 12s</strong>.
        </p>
        <p>
          The clock stops when <em>the answer arrives</em>, not when the
          platform has finished its own bookkeeping. That ordering is
          deliberate — the reply is written into the thread first, and the
          accounting follows a moment later. So the header settles to{" "}
          <strong>Worked for …</strong> as soon as there is something to read,
          and the token and cost figures fill in just behind it. A turn whose
          reply is on screen is done, whatever is still arriving beside it.
        </p>
        <p>
          On a model that supports prompt caching, two more figures join the
          token line: <strong>cache read</strong> and{" "}
          <strong>cache write</strong>. Cache read is the part of the prompt
          that did not have to be paid for again, and it is billed at a
          fraction of ordinary input — which is why a long thread on a
          cache-capable model gets cheaper per turn rather than steadily more
          expensive. Which models do this is a property of the model, not a
          setting you choose: see{" "}
          <DocLink slug="model-catalog">the model catalog</DocLink>.
        </p>
        <PullQuote who="the turn header, in one sentence">
          Time, tokens and money for one question, on one line — and the time
          stops the moment you have your answer.
        </PullQuote>
      </ReportSection>

      <ReportSection id="sources" title="Where an answer came from">
        <p>
          When a turn draws on your company&apos;s held knowledge or data, the
          reply says so — with receipts, not just prose. Two cards can appear
          with a reply, one for each kind of grounding:
        </p>
        <CardGrid>
          <InfoCard title="Knowledge sources">
            <p>
              The documents behind the answer — an SOP, a policy, a manual —
              each with the page the passage came from. Click one and the
              document opens in a side panel at the cited page, so you can
              read the original rather than trust the summary.
            </p>
          </InfoCard>
          <InfoCard title="Data sources">
            <p>
              The queries behind a number — which tables were read and how
              many rows came back. Click one for the details: the database,
              the row count, and the executed query itself when your access
              allows it (the panel says so plainly when it is withheld).
            </p>
          </InfoCard>
        </CardGrid>
        <p>
          When the reply cites inline — the small <code>[n]</code> chips at
          the end of a claim — each chip is clickable and opens the same
          document panel as its row in the card. A claim, its source, and the
          original document are one click apart.
        </p>
        <p>
          Citations are stored with the turn, like everything else in the
          receipt: an old thread shows its sources the same way a fresh one
          does. If an answer states a figure or a rule and shows no source
          card at all, that is worth noticing — it means the answer came from
          the model&apos;s own reasoning or the public web, not from your
          company&apos;s knowledge.
        </p>
      </ReportSection>

      <ReportSection id="history" title="History and resumption">
        <p>
          Threads are kept. There is no retention window, no expiry, and
          nothing that quietly prunes old conversations — a thread from last
          year still opens, still shows its messages, and still shows what the
          agent did in each turn.
        </p>
        <p>
          Resuming is just sending another message. The agent picks the
          conversation back up with its history intact, including work it did
          in tools rather than said out loud.
        </p>
        <p>
          What <em>does</em> change between visits is speed, and only speed.
          While a thread is active, its session stays warm: follow-ups skip
          the setup the first message paid for — building the session,
          connecting tool servers, pulling the workspace down — and answer
          noticeably faster. Come back to a thread that has gone cold and the
          next message pays that setup cost once more, then runs warm again.
        </p>
        <PullQuote who="cold starts, in one sentence">
          Cold is slower, never lossier: conversation history and session
          state are stored durably against the thread, so a cold turn
          reconstructs exactly what a warm one had.
        </PullQuote>
        <p>
          Two things quietly shorten that first wait, and neither is something
          you switch on:
        </p>
        <CardGrid>
          <InfoCard title="The machine boots while you type">
            <p>
              Starting a new thread and then writing your question is not dead
              time. The moment the empty thread exists, the platform sends an
              inert ping to warm the machine your first message will land on,
              so the typing and the provisioning overlap. Create a thread and
              its opening message in one action — from a mobile share, say —
              and there is nothing to overlap with; that first turn pays the
              wait.
            </p>
          </InfoCard>
          <InfoCard title="Some deployments stay warm across threads">
            <p>
              A deployment can key its warm sessions to <em>you and an
              agent</em> rather than to one thread, so a brand-new thread
              lands on the machine your last conversation already warmed —
              including its open connections to tools. Whether that is on is a
              deployment-level setting; where it is, the pattern you feel is
              &ldquo;the first question of the day is slower, everything after
              it is quick&rdquo;.
            </p>
          </InfoCard>
        </CardGrid>
        <p>
          If two of your own threads want the same warm machine at the same
          moment, the second one is given a machine of its own rather than
          queued behind the first. You may see a longer{" "}
          <strong>Starting agent VM</strong> on that turn; you will not see it
          wait.
        </p>
        <p>
          Two things do move on between turns rather than freezing, and both
          are deliberate:
        </p>
        <ul>
          <li>
            <strong>Workspace edits apply to the next turn.</strong> Change a
            space file mid-conversation and the running turn finishes on what
            it already loaded; the following one picks up your edit. See{" "}
            <DocLink slug="workspace-context">Workspace context</DocLink>.
          </li>
          <li>
            <strong>Memory keeps compounding.</strong> What the agent learned
            in this thread is available to later ones through memory rather
            than by re-reading the transcript. See{" "}
            <DocLink slug="memory">How memory works</DocLink>.
          </li>
        </ul>
        <p>
          The flip side of perfect history: a long thread that took a wrong
          turn keeps carrying that wrong turn. When a conversation has gone
          somewhere unhelpful, starting a fresh thread in the same space is
          usually faster than arguing the old one back on track — the space
          context is identical either way, and only the transcript is left
          behind.
        </p>
      </ReportSection>
    </ReportArticle>
  );
}
