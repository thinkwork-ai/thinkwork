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
 */
import {
  CardGrid,
  DocLink,
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
