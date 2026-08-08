/**
 * Threads (Spaces & threads) — THINK-697 content pass.
 *
 * The warm-session material is deliberately stated as user-visible effect
 * (follow-ups skip the bootstrap; nothing is lost when it goes cold) rather
 * than as AWS wiring — the reader of these docs does not operate the runtime.
 */
import { Bot, MessageSquare, Sparkles, Wrench } from "lucide-react";
import {
  Callout,
  DocArticle,
  DocLink,
  FlowChain,
  FlowChip,
  FlowDiagram,
  FlowLink,
  FlowNode,
  Section,
  Term,
} from "../kit";
import type { DocTocEntry } from "../registry";

export const THREADS_TOC: DocTocEntry[] = [
  { id: "anatomy", title: "Anatomy of a thread" },
  { id: "live-progress", title: "Live progress" },
  { id: "history", title: "History and resumption" },
];

export function Threads() {
  return (
    <DocArticle
      eyebrow="Spaces & threads"
      title="Threads"
      lead="A thread is one conversation with one agent: the messages, the tool calls behind them, and the artifacts the turn produced."
    >
      <Section id="anatomy" title="Anatomy of a thread">
        <p>
          Every thread lives in exactly one <Term>space</Term> and carries an
          identifier — <code>CHAT-1962</code>, <code>AUTO-1963</code> — whose
          prefix names the channel it arrived on. Its title is the first eighty
          characters of your opening message, trimmed at a word; automated runs
          are titled after the automation that started them. Nothing renames a
          thread afterwards unless you do.
        </p>
        <p>
          Inside, two records run in parallel and it is worth keeping them
          apart:
        </p>
        <ul>
          <li>
            <strong>Messages</strong> are the conversation — what you said, what
            the agent said back. That is what the chat view renders.
          </li>
          <li>
            <strong>Turns</strong> are the execution behind a message: the model
            call plus every tool call, skill run and step it took to get there.
            One message from you produces one turn, however much work happened
            inside it.
          </li>
        </ul>
        <p>
          So a single question is two messages and one turn. The turn is the
          receipt; the messages are the conversation.
        </p>
        <FlowDiagram>
          <FlowChain>
            <FlowNode
              icon={MessageSquare}
              title="Your message"
              sub="lands in the thread immediately"
              tone="source"
            />
            <FlowLink label="one turn" />
            <FlowNode icon={Bot} title="The agent turn" tone="compute">
              <FlowChip>space files</FlowChip>
              <FlowChip>memory</FlowChip>
              <FlowChip>your context</FlowChip>
            </FlowNode>
            <FlowLink label="as needed" />
            <FlowNode
              icon={Wrench}
              title="Tools and skills"
              sub="each call shown as it runs"
              tone="storage"
            />
            <FlowLink label="finishes" />
            <FlowNode icon={Sparkles} title="What you get back" tone="consumer">
              <FlowChip>reply</FlowChip>
              <FlowChip>charts</FlowChip>
              <FlowChip>artifacts</FlowChip>
              <FlowChip>work items</FlowChip>
            </FlowNode>
          </FlowChain>
        </FlowDiagram>
        <p>
          A thread also has a <strong>mode</strong>, and it changes whether the
          agent answers by default:
        </p>
        <ul>
          <li>
            <strong>Agent mode</strong> — you and the agent. Every message you
            send dispatches a turn. This is the default while you are the only
            human in the thread.
          </li>
          <li>
            <strong>Multiplayer mode</strong> — a second person is in the
            thread. The agent stops answering automatically, so you can talk to
            each other; mention it explicitly to bring it back in.
          </li>
        </ul>
        <p>
          The mode is derived from how many people are in the thread, and it
          flips the moment a second one joins. You can pin it either way from
          the thread&apos;s info panel, and the pin applies to everyone in the
          thread, not just you.
        </p>
        <Callout tone="note" title="Mentioning someone lets them in">
          <p>
            @-mentioning a colleague makes them a participant of{" "}
            <em>that thread</em> — including a thread in a private space they
            are not a member of. It is thread-level access: they can read and
            reply here, and they still cannot start new work in the space. See{" "}
            <DocLink slug="spaces">Spaces</DocLink>.
          </p>
        </Callout>
        <Callout
          tone="warn"
          title="Task state lives in work items, not on the thread"
        >
          <p>
            Threads carry a status and a priority, and they are largely
            vestigial — the platform tracks real task state in{" "}
            <strong>work items</strong>, which belong to the space, carry
            statuses the space itself defines, and can link to the threads that
            discussed them. If you want to know whether something is actually
            done, look at the work item, not the thread.
          </p>
        </Callout>
      </Section>

      <Section id="live-progress" title="Live progress">
        <p>
          A turn is not a black box that eventually emits an answer. The thread
          streams while it works, and you see, in order:
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
            <strong>Each tool call</strong> — which tool, the arguments as they
            are assembled, and the result when it returns. Failures show as
            failures rather than vanishing.
          </li>
          <li>
            <strong>Step boundaries</strong>, so a turn that calls three tools
            reads as three steps rather than one long pause.
          </li>
        </ul>
        <p>
          Charts and artifacts appear inline as the turn emits them, and an
          artifact created during a turn is automatically attached to the thread
          — you do not have to save it anywhere. Because artifacts belong to the
          space rather than the thread, you can keep editing one from a later
          conversation. See{" "}
          <DocLink slug="charts-and-artifacts">Charts &amp; artifacts</DocLink>.
        </p>
        <Callout tone="note" title="One turn at a time, per thread">
          <p>
            A thread runs a single turn at a time. Send a second message while
            the first is still working and it is <em>saved immediately</em> —
            you will see it in the thread — but the agent picks it up after the
            running turn finishes rather than racing itself.
          </p>
          <p>
            If a turn dies without cleaning up, the thread unblocks itself after
            about ten minutes and the next message runs normally. A thread that
            appears stuck for longer than that is worth reporting, not waiting
            on.
          </p>
        </Callout>
      </Section>

      <Section id="history" title="History and resumption">
        <p>
          Threads are kept. There is no retention window, no expiry, and nothing
          that quietly prunes old conversations — a thread from last year still
          opens, still shows its messages, and still shows what the agent did in
          each turn.
        </p>
        <p>
          Resuming is just sending another message. The agent picks the
          conversation back up with its history intact, including work it did in
          tools rather than said out loud.
        </p>
        <p>
          What <em>does</em> change with time is speed, and only speed. While a
          thread is active, its session stays warm: follow-ups skip the setup
          the first message paid for — building the session, connecting tool
          servers, pulling the workspace down — and answer noticeably faster.
          Leave the thread alone for a while and that warmth expires. The next
          message pays the setup cost once more and then runs warm again.
        </p>
        <Callout tone="tip" title="Cold is slower, never lossier">
          <p>
            The distinction people worry about is whether a cold start means the
            agent &quot;forgot&quot;. It does not. Conversation history and
            session state are stored durably against the thread, so a cold turn
            reconstructs exactly what a warm one had. The only difference you
            can observe is how long the first reply takes.
          </p>
        </Callout>
        <p>
          Two things do move on between turns rather than freezing, and both are
          deliberate:
        </p>
        <ul>
          <li>
            <strong>Workspace edits apply to the next turn.</strong> Change a
            space file mid-conversation and the running turn finishes on what it
            already loaded; the following one picks up your edit. See{" "}
            <DocLink slug="workspace-context">Workspace context</DocLink>.
          </li>
          <li>
            <strong>Memory keeps compounding.</strong> What the agent learned in
            this thread is available to later ones through memory rather than by
            re-reading the transcript. See{" "}
            <DocLink slug="memory">How memory works</DocLink>.
          </li>
        </ul>
        <Callout
          tone="warn"
          title="A resumed thread carries its old context, for better and worse"
        >
          <p>
            Because history is preserved perfectly, a long thread that took a
            wrong turn keeps carrying that wrong turn. When a conversation has
            gone somewhere unhelpful, starting a fresh thread in the same space
            is usually faster than arguing the old one back on track — the space
            context is identical either way, and only the transcript is left
            behind.
          </p>
        </Callout>
      </Section>
    </DocArticle>
  );
}
