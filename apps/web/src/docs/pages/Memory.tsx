/**
 * How memory works (Memory) — THINK-698.
 *
 * Written against the shipped behaviour, not the historical design docs:
 * Bedrock AgentCore Memory is the only engine, memory is scoped to the
 * person rather than the agent or the thread, retention is a hand-off to
 * asynchronous background extraction, and recall is a tool call the model
 * chooses to make. Those four facts carry the whole page.
 */
import { Callout, DocArticle, DocLink, Section, Term } from "../kit";
import { MemoryFlowDiagram } from "../figures/memory";
import type { DocTocEntry } from "../registry";

export const MEMORY_TOC: DocTocEntry[] = [
  { id: "the-engine", title: "The engine" },
  { id: "what-gets-remembered", title: "What gets remembered" },
  { id: "whose-memory", title: "Whose memory it is" },
  { id: "retention", title: "Retention and forgetting" },
  { id: "seeing-and-steering", title: "Seeing and steering it" },
];

export function Memory() {
  return (
    <DocArticle
      eyebrow="Memory"
      title="How memory works"
      lead="Memory is what survives the end of a thread. This page covers the engine behind it, what gets written, and what deliberately does not."
    >
      <Section id="the-engine" title="The engine">
        <p>
          Long-term memory runs on <strong>Bedrock AgentCore Memory</strong>,
          the managed service. There is no engine to choose, no per-agent memory
          store to provision, and no vector database to operate: each deployment
          stage has exactly one memory resource, and every agent in it writes to
          the same place.
        </p>
        <p>
          What ThinkWork Agent contributes is the plumbing on either side —
          handing the engine each finished turn, and giving the agent two tools
          to work with what came back.
        </p>
        <MemoryFlowDiagram />
        <p>
          The write path is one hop, and it happens after you have your answer:
        </p>
        <ol>
          <li>
            A turn finishes in a <Term>thread</Term>.
          </li>
          <li>
            The runtime hands the transcript to the platform in the background.
            Nothing about this waits on your reply, and a failure here never
            fails the turn.
          </li>
          <li>
            AgentCore runs <strong>its own</strong> extraction over that
            transcript, on its own schedule, and decides what is worth keeping.
          </li>
        </ol>
        <Callout
          tone="warn"
          title="Handing over a turn is not the same as remembering it"
        >
          <p>
            This is the single thing people misread. Extraction is{" "}
            <strong>asynchronous and selective</strong>: a turn is accepted in
            milliseconds, but a fact from it may not be recallable for a minute
            or two — and a turn that asked a question rather than stated a fact
            often produces no record at all. That is the engine working
            correctly, not a dropped write.
          </p>
          <p>
            The practical consequence: never rely on memory to carry something
            within the conversation you are already having. The thread itself
            already holds it.
          </p>
        </Callout>
      </Section>

      <Section id="what-gets-remembered" title="What gets remembered">
        <p>
          Extraction fills four kinds of memory, and the agent can add a fifth
          on request. They differ in one way that matters more than any other:
          whether a later thread can reach them.
        </p>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/20 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Kind</th>
                <th className="px-3 py-2 font-medium">What it holds</th>
                <th className="px-3 py-2 font-medium">
                  Reachable from a later thread
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60 text-[13px] [&_td]:px-3 [&_td]:py-2">
              <tr>
                <td className="font-medium whitespace-nowrap">Facts</td>
                <td className="text-foreground/80">
                  durable statements about you and your work — &ldquo;the Austin
                  office moved to 2nd and Lavaca&rdquo;
                </td>
                <td className="text-foreground/80">Yes</td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">Preferences</td>
                <td className="text-foreground/80">
                  how you like things done — format, tone, channel, level of
                  detail
                </td>
                <td className="text-foreground/80">Yes</td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">
                  Asked-to-remember
                </td>
                <td className="text-foreground/80">
                  one fact stored immediately because you said &ldquo;remember
                  this&rdquo;
                </td>
                <td className="text-foreground/80">Yes</td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">
                  Session summaries
                </td>
                <td className="text-foreground/80">
                  a rolling summary of one thread
                </td>
                <td className="text-foreground/80">
                  No — it belongs to that thread
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">
                  Episodes and reflections
                </td>
                <td className="text-foreground/80">
                  what happened in a past thread, and patterns drawn across
                  several
                </td>
                <td className="text-foreground/80">
                  Recorded and visible to you, but not part of a recall
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <Callout
          tone="note"
          title="Recall is narrower than the memory list you can see"
        >
          <p>
            When an agent looks something up, it searches{" "}
            <strong>facts, preferences and asked-to-remember records</strong> —
            three shelves, up to ten results. Session summaries and episodes are
            deliberately left out: they are per-thread, and including them would
            drown a cross-thread lookup in transcript-shaped noise.
          </p>
          <p>
            So a record you can see on the memory page is not automatically a
            record the agent will find. If something must be reachable, state it
            as a fact — or say &ldquo;remember that&hellip;&rdquo; and have it
            written to the shelf that recall always reads.
          </p>
        </Callout>
        <p>Some turns are never handed over at all:</p>
        <ul>
          <li>
            <strong>Evaluation runs.</strong> An{" "}
            <DocLink slug="evaluations">eval</DocLink> must not teach the agent
            the answers, so eval traffic is dropped before it reaches the
            engine.
          </li>
          <li>
            <strong>Turns with no person behind them.</strong> Memory is scoped
            to a human requester; a webhook or inbound-email thread with no
            signed-in user has nowhere to write, and the agent runs that turn
            without memory tools rather than guessing an owner.
          </li>
          <li>
            <strong>Smoke and health-check threads.</strong> Suppressed at the
            door, so deployment checks never accumulate as facts about you.
          </li>
        </ul>
        <p>
          The agent is also told <em>not</em> to journal. It does not write a
          record per turn, does not copy recall results into files, and does not
          re-store things already written in its workspace — extraction covers
          the ordinary case, and <code>remember</code> is reserved for an
          explicit request or a fact that would be expensive to lose.
        </p>
      </Section>

      <Section id="whose-memory" title="Whose memory it is">
        <p>
          <strong>
            Memory belongs to a person, not to an agent and not to a thread.
          </strong>{" "}
          Every record is filed under the user who was talking, which produces
          three consequences worth internalising:
        </p>
        <ul>
          <li>
            <strong>Switching agents does not lose your memory.</strong> Two
            agents you work with draw on the same recall — the memory followed
            you, not them.
          </li>
          <li>
            <strong>
              Your colleague&apos;s agent does not know what you told yours.
            </strong>{" "}
            There is no team bank and no shared pool; a fact reaches someone
            else only if a person tells them or it is written somewhere shared,
            like a <DocLink slug="spaces">Space</DocLink> file.
          </li>
          <li>
            <strong>
              In a multiplayer thread, context follows the sender.
            </strong>{" "}
            Consecutive turns in one thread can carry different people&apos;s
            memory, because each turn is contextualised by whoever sent it.
          </li>
        </ul>
        <p>
          If you want knowledge shared by construction rather than by
          coincidence, that is what a Space&apos;s files and the agent&apos;s
          own <DocLink slug="agent-folder">INSTRUCTIONS.md</DocLink> are for.
          Memory is the personal layer;{" "}
          <DocLink slug="workspace-context">workspace context</DocLink> is the
          shared one.
        </p>
      </Section>

      <Section id="retention" title="Retention and forgetting">
        <p>
          Retained turns expire on a <strong>365-day</strong> clock. Individual
          records carry their own expiry, shown alongside them wherever memory
          is listed, so you can see what is aging out rather than discovering it
          later.
        </p>
        <p>Forgetting is a delete, and delete is the only write you get:</p>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/20 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Action</th>
                <th className="px-3 py-2 font-medium">Supported</th>
                <th className="px-3 py-2 font-medium">What to do instead</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60 text-[13px] [&_td]:px-3 [&_td]:py-2">
              <tr>
                <td className="font-medium whitespace-nowrap">
                  Delete one record
                </td>
                <td className="text-foreground/80">Yes</td>
                <td className="text-foreground/80">&mdash;</td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">
                  Edit a record in place
                </td>
                <td className="text-foreground/80">
                  No — records are immutable
                </td>
                <td className="text-foreground/80">
                  delete the wrong one and state the correct fact, which writes
                  a fresh record
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">
                  Clear everything at once
                </td>
                <td className="text-foreground/80">
                  No bulk path — deletion is one record at a time
                </td>
                <td className="text-foreground/80">
                  work down the list, or let expiry handle stale records
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <Callout tone="tip" title="Correct by deleting, not by arguing">
          <p>
            Telling the agent &ldquo;that&apos;s wrong, I moved teams&rdquo;
            adds a newer fact but does not remove the older one, and both stay
            recallable. When a record is actually wrong rather than merely out
            of date, delete it — a minute on the memory page beats a month of
            contradictory recalls.
          </p>
        </Callout>
      </Section>

      <Section id="seeing-and-steering" title="Seeing and steering it">
        <p>Three surfaces show the same records:</p>
        <ul>
          <li>
            <strong>Settings → Memory</strong> in the web app — search across
            memory, filter by kind, open a record to see where it came from, and
            delete. An operator can also read another member&apos;s bank; this
            page is operator-only for exactly that reason.
          </li>
          <li>
            <strong>
              Memory in the <DocLink slug="mobile-app">mobile app</DocLink>
            </strong>{" "}
            — your own records, searchable, with delete on each row. This is the
            everyday surface for &ldquo;what does it think it knows about
            me?&rdquo;.
          </li>
          <li>
            <strong>
              The <DocLink slug="cli-and-deployment">CLI</DocLink>
            </strong>{" "}
            — <code>thinkwork memory list</code>,{" "}
            <code>thinkwork memory search</code>,{" "}
            <code>thinkwork memory get</code> and{" "}
            <code>thinkwork memory delete</code> for scripted checks.
          </li>
        </ul>
        <p>To steer it rather than just read it:</p>
        <ul>
          <li>
            <strong>Say it plainly.</strong> &ldquo;Remember that our
            post-mortems live in <code>/docs/incidents/</code>&rdquo; writes one
            record immediately, and immediately searchable — no waiting on
            extraction.
          </li>
          <li>
            <strong>
              Put standing profile facts in your workspace instead.
            </strong>{" "}
            Things the agent should never have to search for — your role, your
            team, your working hours — belong in the workspace files it reads
            every turn. Memory is for what accumulates; the workspace is for
            what is simply true.
          </li>
          <li>
            <strong>Delete the wrong ones.</strong> See the callout above.
          </li>
        </ul>
        <p>
          What happens to these records next — consolidation, promotion and
          compaction — is{" "}
          <DocLink slug="compounding-memory">compounding memory</DocLink>. How
          any of it actually reaches a turn is{" "}
          <DocLink slug="retrieval-and-context">
            retrieval &amp; context
          </DocLink>
          .
        </p>
      </Section>
    </DocArticle>
  );
}
