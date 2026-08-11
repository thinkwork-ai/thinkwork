/**
 * Compounding memory (Memory) — THINK-698.
 *
 * Documents what actually compounds today, verified against the shipped
 * code: packages/api/src/handlers/thread-idle-memory-learning.ts (the
 * idle learner's after-quiet trigger), packages/api/src/lib/
 * requester-memory/learner.ts (sorting: corrections/decisions straight to
 * MEMORY.md, the rest staged in candidates/, digests in working/),
 * requester-memory/dreaming.ts (the light/REM/deep nightly phases and
 * their dated reports; only REM calls a model; no candidates → the night
 * ends), requester-memory/storage.ts (the memory/ write allowlist, the
 * 256 KB size cap, pre-write snapshots under memory/.snapshots/),
 * requester-memory/rollback.ts (wholesale rollback of a run), and
 * terraform/modules/thinkwork/variables.tf
 * `requester_memory_dreaming_enabled` (the deployment-level switch).
 *
 * First page converted to the report restyle (Eric 2026-08-11 — the same
 * treatment the Brain docs got; "easy to read" is the bar): ReportArticle,
 * the numbered stage spine, and the ConsolidationLoopFigure drawing the
 * loop as a loop.
 */
import {
  CardGrid,
  DocLink,
  DocTable,
  InfoCard,
  Invariant,
  PullQuote,
  ReportArticle,
  ReportSection,
  Stage,
  Stages,
} from "../kit";
import { ConsolidationLoopFigure } from "../figures/memory";
import type { DocTocEntry } from "../registry";

export const COMPOUNDING_MEMORY_TOC: DocTocEntry[] = [
  { id: "what-compounds", title: "What compounds" },
  { id: "the-loop", title: "The consolidation loop" },
  { id: "your-memory-files", title: "Your memory files" },
  { id: "correcting-it", title: "Reading and correcting it" },
];

export function CompoundingMemory() {
  return (
    <ReportArticle
      eyebrow="Memory"
      title="Compounding memory"
      lead="Raw memories accumulate; left alone they only get longer. Compounding memory is the machinery that keeps re-reading them — promoting what proved durable, compacting what repeated, and writing the result somewhere you can read."
    >
      <ReportSection id="what-compounds" title="What compounds">
        <p>
          An agent that remembers everything is barely better than one that
          remembers nothing: the tenth restatement of a preference is not ten
          times more useful than the first. What makes memory improve rather
          than merely accumulate is a second pass over it — and there are two,
          running at different rhythms.
        </p>
        <CardGrid>
          <InfoCard title="The idle learner">
            <p>
              Runs per thread, shortly after that thread goes quiet. It reads
              the conversation once it is over, picks out what looked durable,
              and files it.
            </p>
          </InfoCard>
          <InfoCard title="The nightly pass">
            <p>
              Runs per person, over the last two weeks of your work and your
              existing notes. It is the one that promotes, reflects and
              compacts.
            </p>
          </InfoCard>
        </CardGrid>
        <p>
          Underneath both, the engine itself compounds: alongside the facts and
          preferences described in{" "}
          <DocLink slug="memory">how memory works</DocLink>, it draws{" "}
          <strong>reflections</strong> across your past threads without anyone
          asking it to.
        </p>
        <PullQuote who="the shape of the output, in one sentence">
          Compounding produces markdown in your workspace — files the agent
          already reads every turn — rather than a browsable graph a person has
          to remember to open.
        </PullQuote>
        <p>
          That shape is deliberate. Notes in the workspace are the same thing
          the agent reads before answering, so consolidation improves behaviour
          directly: a better <code>memory/MEMORY.md</code> is a better next
          turn, with no extra surface in between.
        </p>
      </ReportSection>

      <ReportSection id="the-loop" title="The consolidation loop">
        <ConsolidationLoopFigure />
        <p>
          The nightly pass itself runs in three phases, named for the sleep
          stages they borrow from. Each one leaves a dated report behind, so a
          night&apos;s work is auditable rather than mysterious.
        </p>
        <Stages>
          <Stage num="1" title="Light — notice" tag="no model call">
            <p>
              A deterministic pass re-reads the last two weeks and scores what
              looks durable, splitting it into candidates and rejects. This is
              what keeps a nightly pass over every person affordable — and if
              light finds no candidates, the night ends here and nothing is
              written.
            </p>
          </Stage>
          <Stage num="2" title="REM — reflect" tag="the only model call">
            <p>
              One model pass reads the candidates against your existing notes
              and writes its reflection into <code>memory/DREAMS.md</code> —
              a running diary of what each night made of your week.
            </p>
          </Stage>
          <Stage num="3" title="Deep — promote and compact" tag="rewrites the file">
            <p>
              What survived reflection is written into{" "}
              <code>memory/MEMORY.md</code>, and the file is tightened — a
              rewrite of contents the previous two phases already decided.
            </p>
          </Stage>
        </Stages>
        <p>
          The idle learner works the same way at thread scale, and sorts what
          it finds three ways:
        </p>
        <DocTable
          head={["What it found", "Where it goes"]}
          rows={[
            [
              "A correction or a decision — high-signal, and expensive to lose",
              <>
                straight into <code>memory/MEMORY.md</code>
              </>,
            ],
            [
              "A preference, a person, a project, a way you work",
              <>
                staged in <code>memory/candidates/</code> to see whether it
                recurs
              </>,
            ],
            [
              "What the thread was and what came of it",
              <>
                a digest in <code>memory/working/</code>
              </>,
            ],
          ]}
        />
        <p>
          Staging matters more than it looks. A thing said once in one thread
          is not yet a fact about you; promotion is what a candidate earns by
          surviving the nightly re-read.
        </p>
        <p>
          One operational note: whether the nightly pass runs at all is decided
          when your stage is deployed — not per agent, and not per user. On a
          stage where it is off, no <code>DREAMS.md</code> appears and{" "}
          <code>MEMORY.md</code> only grows from the idle learner. If you are
          wondering why last night produced nothing, that is the first thing to
          check with your operator, ahead of anything about your own threads.
          Everything else keeps working either way: the idle learner still runs
          after threads go quiet, and the engine&apos;s own extraction and
          reflections are unaffected.
        </p>
      </ReportSection>

      <ReportSection id="your-memory-files" title="Your memory files">
        <p>
          Everything both passes write lands under one folder, private to you,
          in your <DocLink slug="agent-folder">workspace</DocLink>:
        </p>
        <DocTable
          head={["File", "What it is", "Written by"]}
          rows={[
            [
              <code>memory/MEMORY.md</code>,
              "the durable set — what has earned a permanent place",
              "both passes; the nightly one also compacts it",
            ],
            [
              <code>memory/DREAMS.md</code>,
              "a running diary of each night's reflection",
              "the REM phase",
            ],
            [
              <code>memory/candidates/&lt;date&gt;.md</code>,
              "staged observations waiting to recur",
              "the idle learner",
            ],
            [
              <code>memory/working/&lt;date&gt;.md</code>,
              "one digest per thread that went quiet that day",
              "the idle learner",
            ],
            [
              <code>memory/dreaming/&lt;phase&gt;/&lt;date&gt;.md</code>,
              "the per-phase report for one night — what was considered, rejected and promoted",
              "the nightly pass",
            ],
          ]}
        />
        <p>
          The same folder also holds notes you and the agent write directly —
          contacts, lessons, preferences, procedures. Consolidation reads those
          too, which is the cheapest way to steer it: a line you write by hand
          is a line the nightly pass will keep re-reading.
        </p>
        <p>
          Memory files and{" "}
          <DocLink slug="memory">long-term memory records</DocLink> are two
          different things that both deserve the word memory. Records live in
          the managed engine and are found by searching; files live in the
          workspace and are found by reading. Consolidation is the bridge — it
          reads your work and writes the files.
        </p>
      </ReportSection>

      <ReportSection id="correcting-it" title="Reading and correcting it">
        <p>
          The point of writing consolidation to markdown is that correcting it
          needs no special tooling — you edit the file.
        </p>
        <ul>
          <li>
            <strong>On mobile</strong> — the Memory section lists your memory
            files and opens each one for editing. This is the fastest way to
            delete a line that was never true.
          </li>
          <li>
            <strong>In a thread</strong> — ask the agent to fix its notes. It
            can write anywhere under <code>memory/</code>, and it is told to
            keep durable facts there rather than scattering them.
          </li>
          <li>
            <strong>By reading the reports</strong> — when a promotion
            surprises you, the dated phase report says what evidence produced
            it.
          </li>
        </ul>
        <Invariant title="Confined and reversible, by construction">
          <p>
            Every write is snapshotted first — the previous version of a file
            is kept before it is replaced, and an idle-learning run can be
            rolled back wholesale if it made a mess. And writes are confined:
            both passes can only write to an allowlist of paths under{" "}
            <code>memory/</code>, with files size-capped, so consolidation
            cannot wander into the rest of your workspace or grow without
            bound.
          </p>
        </Invariant>
        <p>
          For how any of these files and records actually reach a running turn,
          continue to{" "}
          <DocLink slug="retrieval-and-context">
            retrieval &amp; context
          </DocLink>
          .
        </p>
      </ReportSection>
    </ReportArticle>
  );
}
