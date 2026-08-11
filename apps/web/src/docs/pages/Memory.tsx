/**
 * How memory works (Memory) — THINK-698.
 *
 * Report restyle (Eric 2026-08-11), verified against the shipped code:
 * packages/api/src/lib/memory/config.ts (AgentCore is the only engine —
 * loadMemoryConfig throws without AGENTCORE_MEMORY_ID; MEMORY_ENGINE is
 * normalized at env-parse; default recall limit 10), memory/adapters/
 * agentcore-adapter.ts (actor-scoped namespaces; recall fans out over
 * assistant/preferences/user shelves and deliberately excludes session +
 * episode namespaces; delete works, update throws — records are
 * immutable), handlers/memory-retain.ts (smoke-thread suppression,
 * MISSING_USER_CONTEXT), agentcore-pi server.ts (fire-and-forget end-of-
 * turn retain; memory_skipped_no_user / memory_skipped_eval_mode), the
 * runtime's memory-retain-client.ts (explicit eval suppression),
 * packages/workspace-defaults MEMORY_GUIDE (don't journal; remember is for
 * explicit requests), terraform/modules/app/agentcore-memory/scripts/
 * create_or_find_memory.sh (365-day event expiry), web SettingsMemory +
 * settings-nav (operator-only; any member via filter), apps/mobile/app/
 * memory/ and apps/cli/src/commands/memory.ts (the surfaces).
 *
 * Dropped as unverifiable: per-record expiry shown in listings (the
 * resolver returns expiresAt: null).
 */
import {
  CardGrid,
  DocLink,
  DocTable,
  InfoCard,
  PullQuote,
  ReportArticle,
  ReportSection,
  Stage,
  Stages,
  Term,
} from "../kit";
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
    <ReportArticle
      eyebrow="Memory"
      title="How memory works"
      lead="Memory is what survives the end of a thread. This page covers the engine behind it, what gets written, and what deliberately does not."
    >
      <ReportSection id="the-engine" title="The engine">
        <p>
          Long-term memory runs on <strong>Bedrock AgentCore Memory</strong>,
          the managed service. There is no engine to choose, no per-agent
          memory store to provision, and no vector database to operate: each
          deployment stage has exactly one memory resource, and every agent in
          it writes to the same place.
        </p>
        <p>
          What ThinkWork Agent contributes is the plumbing on either side —
          handing the engine each finished turn, and giving the agent tools to
          work with what came back.
        </p>
        <MemoryFlowDiagram />
        <p>
          The write path is one hop, and it happens after you have your
          answer:
        </p>
        <Stages>
          <Stage num="1" title="A turn finishes">
            <p>
              You send a message in a <Term>thread</Term>; the agent answers.
              The turn is complete before anything below begins.
            </p>
          </Stage>
          <Stage num="2" title="The transcript is handed off" tag="background">
            <p>
              The runtime passes the transcript to the platform in a
              fire-and-forget call. Nothing about this waits on your reply,
              and a failure here never fails the turn.
            </p>
          </Stage>
          <Stage num="3" title="The engine extracts" tag="its own schedule">
            <p>
              AgentCore runs <strong>its own</strong> extraction over the
              transcript and decides what is worth keeping.
            </p>
          </Stage>
        </Stages>
        <PullQuote who="the single thing people misread">
          Handing over a turn is not the same as remembering it.
        </PullQuote>
        <p>
          Extraction is <strong>asynchronous and selective</strong>: a turn is
          accepted in milliseconds, but a fact from it may not be recallable
          for a minute or two — and a turn that asked a question rather than
          stated a fact often produces no record at all. That is the engine
          working correctly, not a dropped write. The practical consequence:
          never rely on memory to carry something within the conversation you
          are already having. The thread itself already holds it.
        </p>
      </ReportSection>

      <ReportSection id="what-gets-remembered" title="What gets remembered">
        <p>
          Extraction fills four kinds of memory, and the agent can add a fifth
          on request. They differ in one way that matters more than any
          other: whether a later thread can reach them.
        </p>
        <DocTable
          head={["Kind", "What it holds", "Reachable from a later thread"]}
          rows={[
            [
              <strong>Facts</strong>,
              <>
                durable statements about you and your work — &ldquo;the Austin
                office moved to 2nd and Lavaca&rdquo;
              </>,
              "Yes",
            ],
            [
              <strong>Preferences</strong>,
              "how you like things done — format, tone, channel, level of detail",
              "Yes",
            ],
            [
              <strong>Asked-to-remember</strong>,
              <>
                one fact stored because you said &ldquo;remember this&rdquo;
              </>,
              "Yes",
            ],
            [
              <strong>Session summaries</strong>,
              "a rolling summary of one thread",
              "No — it belongs to that thread",
            ],
            [
              <strong>Episodes and reflections</strong>,
              "what happened in a past thread, and patterns drawn across several",
              "Recorded and visible to you, but not part of a recall",
            ],
          ]}
        />
        <p>
          Recall is narrower than the memory list you can see. When an agent
          looks something up, it searches{" "}
          <strong>facts, preferences and asked-to-remember records</strong> —
          three shelves, up to ten results. Session summaries and episodes
          are deliberately left out: they are per-thread, and including them
          would drown a cross-thread lookup in transcript-shaped noise. So a
          record you can see on the memory page is not automatically a record
          the agent will find. If something must be reachable, state it as a
          fact — or say &ldquo;remember that&hellip;&rdquo; and have it
          written to a shelf that recall always reads.
        </p>
        <p>Some turns are never handed over at all:</p>
        <ul>
          <li>
            <strong>Evaluation runs.</strong> An{" "}
            <DocLink slug="evaluations">eval</DocLink> must not teach the
            agent the answers, so eval traffic is suppressed before it
            reaches the engine.
          </li>
          <li>
            <strong>Turns with no person behind them.</strong> Memory is
            scoped to a human requester; a turn with no signed-in user has
            nowhere to write, and the agent runs it without memory tools
            rather than guessing an owner.
          </li>
          <li>
            <strong>Smoke and health-check threads.</strong> Suppressed at
            the door, so deployment checks never accumulate as facts about
            you.
          </li>
        </ul>
        <p>
          The agent is also told <em>not</em> to journal. It does not write a
          record per turn, and it does not re-store things already written in
          its workspace — extraction covers the ordinary case, and{" "}
          <code>remember</code> is reserved for an explicit request or a fact
          that would be expensive to lose.
        </p>
      </ReportSection>

      <ReportSection id="whose-memory" title="Whose memory it is">
        <p>
          <strong>
            Memory belongs to a person, not to an agent and not to a thread.
          </strong>{" "}
          Every record is filed under the user who was talking, which
          produces three consequences worth internalising.
        </p>
        <CardGrid>
          <InfoCard title="Switching agents does not lose your memory">
            <p>
              Two agents you work with draw on the same recall — the memory
              followed you, not them.
            </p>
          </InfoCard>
          <InfoCard title="Your colleague's agent does not know what you told yours">
            <p>
              There is no team bank and no shared pool; a fact reaches
              someone else only if a person tells them or it is written
              somewhere shared, like a <DocLink slug="spaces">Space</DocLink>{" "}
              file.
            </p>
          </InfoCard>
          <InfoCard title="In a multiplayer thread, context follows the sender">
            <p>
              Consecutive turns in one thread can carry different
              people&apos;s memory, because each turn is contextualised by
              whoever sent it.
            </p>
          </InfoCard>
        </CardGrid>
        <p>
          If you want knowledge shared by construction rather than by
          coincidence, that is what a Space&apos;s files and the agent&apos;s
          own <DocLink slug="agent-folder">INSTRUCTIONS.md</DocLink> are for.
          Memory is the personal layer;{" "}
          <DocLink slug="workspace-context">workspace context</DocLink> is the
          shared one.
        </p>
      </ReportSection>

      <ReportSection id="retention" title="Retention and forgetting">
        <p>
          Retained turns expire on a <strong>365-day</strong> clock, set when
          the stage&apos;s memory store is provisioned — memory ages out
          rather than accumulating forever.
        </p>
        <p>Forgetting is a delete, and delete is the only write you get:</p>
        <DocTable
          head={["Action", "Supported", "What to do instead"]}
          rows={[
            [<strong>Delete one record</strong>, "Yes", "—"],
            [
              <strong>Edit a record in place</strong>,
              "No — records are immutable",
              "delete the wrong one and state the correct fact, which writes a fresh record",
            ],
            [
              <strong>Clear everything at once</strong>,
              "No bulk path — deletion is one record at a time",
              "work down the list, or let expiry handle stale records",
            ],
          ]}
        />
        <p>
          Correct by deleting, not by arguing. Telling the agent
          &ldquo;that&apos;s wrong, I moved teams&rdquo; adds a newer fact
          but does not remove the older one, and both stay recallable. When a
          record is actually wrong rather than merely out of date, delete it
          — a minute on the memory page beats a month of contradictory
          recalls.
        </p>
      </ReportSection>

      <ReportSection id="seeing-and-steering" title="Seeing and steering it">
        <p>Three surfaces show the same records:</p>
        <DocTable
          head={["Surface", "What it offers"]}
          rows={[
            [
              <strong>Settings → Memory (web)</strong>,
              "search across memory, filter by kind, open a record, delete. An operator can also read another member's bank; the page is operator-only for exactly that reason.",
            ],
            [
              <>
                <strong>
                  Memory in the{" "}
                  <DocLink slug="mobile-app">mobile app</DocLink>
                </strong>
              </>,
              <>
                your own records, with delete on each card. This is the
                everyday surface for &ldquo;what does it think it knows about
                me?&rdquo;.
              </>,
            ],
            [
              <>
                <strong>
                  The <DocLink slug="cli-and-deployment">CLI</DocLink>
                </strong>
              </>,
              <>
                <code>thinkwork memory list</code>,{" "}
                <code>thinkwork memory search</code>,{" "}
                <code>thinkwork memory get</code> and{" "}
                <code>thinkwork memory delete</code> for scripted checks.
              </>,
            ],
          ]}
        />
        <p>To steer it rather than just read it:</p>
        <ul>
          <li>
            <strong>Say it plainly.</strong> &ldquo;Remember that our
            post-mortems live in <code>/docs/incidents/</code>&rdquo; writes
            one record right away — no waiting on extraction, straight onto a
            shelf recall reads.
          </li>
          <li>
            <strong>
              Put standing profile facts in your workspace instead.
            </strong>{" "}
            Things the agent should never have to search for — your role,
            your team, your working hours — belong in the workspace files it
            reads every turn. Memory is for what accumulates; the workspace
            is for what is simply true.
          </li>
          <li>
            <strong>Delete the wrong ones.</strong> See above.
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
      </ReportSection>
    </ReportArticle>
  );
}
