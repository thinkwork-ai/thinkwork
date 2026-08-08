/**
 * Compounding memory (Memory) — THINK-698.
 *
 * Documents what actually compounds today: the idle learner that reads a
 * thread once it goes quiet, and the nightly three-phase consolidation
 * pass that promotes, reflects and compacts. Both write versioned markdown
 * under the requester's `memory/` folder — that folder is the artifact of
 * compounding, and the page is written around it.
 */
import { Brain, Moon, Sparkles } from "lucide-react";
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
} from "../kit";
import type { DocTocEntry } from "../registry";

export const COMPOUNDING_MEMORY_TOC: DocTocEntry[] = [
  { id: "what-compounds", title: "What compounds" },
  { id: "the-loop", title: "The consolidation loop" },
  { id: "your-memory-files", title: "Your memory files" },
  { id: "correcting-it", title: "Reading and correcting it" },
];

export function CompoundingMemory() {
  return (
    <DocArticle
      eyebrow="Memory"
      title="Compounding memory"
      lead="Raw memories accumulate; left alone they only get longer. Compounding memory is the machinery that keeps re-reading them — promoting what proved durable, compacting what repeated, and writing the result somewhere you can read."
    >
      <Section id="what-compounds" title="What compounds">
        <p>
          An agent that remembers everything is barely better than one that
          remembers nothing: the tenth restatement of a preference is not ten
          times more useful than the first. What makes memory improve rather
          than merely accumulate is a second pass over it — and there are two,
          running at different rhythms.
        </p>
        <ul>
          <li>
            <strong>The idle learner</strong> runs per thread, shortly after
            that thread goes quiet. It reads the conversation once it is over,
            picks out what looked durable, and files it.
          </li>
          <li>
            <strong>The nightly pass</strong> runs per person, over the last two
            weeks of your work and your existing notes. It is the one that
            promotes, reflects and compacts.
          </li>
        </ul>
        <p>
          Underneath both, the engine itself compounds: alongside the facts and
          preferences described in{" "}
          <DocLink slug="memory">how memory works</DocLink>, it draws{" "}
          <strong>reflections</strong> across your past threads without anyone
          asking it to.
        </p>
        <Callout
          tone="note"
          title="Compounding produces prose, not a page graph"
        >
          <p>
            The output of all this is{" "}
            <strong>markdown in your workspace</strong> — files the agent can
            read and you can edit — rather than a browsable graph of entity and
            topic pages. That is a deliberate shape: notes in the workspace are
            the same thing the agent already reads every turn, so consolidation
            improves behaviour directly instead of populating a surface someone
            has to remember to open.
          </p>
        </Callout>
      </Section>

      <Section id="the-loop" title="The consolidation loop">
        <p>
          The nightly pass runs in three phases, named for the sleep stages they
          borrow from. Each one leaves a dated report behind, so a night&apos;s
          work is auditable rather than mysterious.
        </p>
        <FlowDiagram>
          <FlowChain>
            <FlowNode
              icon={Sparkles}
              title="Light — notice"
              sub="re-read the last two weeks and score what looks durable"
              tone="source"
            >
              <FlowChip>no model call</FlowChip>
              <FlowChip>candidates + rejects</FlowChip>
            </FlowNode>
            <FlowLink label="candidates" />
            <FlowNode
              icon={Moon}
              title="REM — reflect"
              sub="one model pass over the candidates and your existing notes"
              tone="compute"
            >
              <FlowChip>DREAMS.md</FlowChip>
            </FlowNode>
            <FlowLink label="what survived" />
            <FlowNode
              icon={Brain}
              title="Deep — promote and compact"
              sub="write the durable ones into your memory file, then tighten it"
              tone="graph"
            >
              <FlowChip>MEMORY.md</FlowChip>
            </FlowNode>
          </FlowChain>
        </FlowDiagram>
        <p>
          Only the middle phase calls a model. <strong>Light</strong> is
          deterministic scoring, which is what keeps a nightly pass over every
          person affordable, and <strong>deep</strong> is a rewrite of a file
          the previous two phases already decided the contents of. If light
          finds no candidates, the night ends there and nothing is written.
        </p>
        <p>
          The idle learner works the same way at thread scale, and sorts what it
          finds three ways:
        </p>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/20 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">What it found</th>
                <th className="px-3 py-2 font-medium">Where it goes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60 text-[13px] [&_td]:px-3 [&_td]:py-2">
              <tr>
                <td className="text-foreground/80">
                  A correction or a decision — high-signal, and expensive to
                  lose
                </td>
                <td className="text-foreground/80">
                  straight into <code>memory/MEMORY.md</code>
                </td>
              </tr>
              <tr>
                <td className="text-foreground/80">
                  A preference, a person, a project, a way you work
                </td>
                <td className="text-foreground/80">
                  staged in <code>memory/candidates/</code> to see whether it
                  recurs
                </td>
              </tr>
              <tr>
                <td className="text-foreground/80">
                  What the thread was and what came of it
                </td>
                <td className="text-foreground/80">
                  a digest in <code>memory/working/</code>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          Staging matters more than it looks. A thing said once in one thread is
          not yet a fact about you; promotion is what a candidate earns by
          surviving the nightly re-read.
        </p>
        <Callout
          tone="warn"
          title="The nightly pass is a deployment-level switch"
        >
          <p>
            Whether consolidation runs at all is decided when your stage is
            deployed, not per agent and not per user — so on a stage where it is
            off, no <code>DREAMS.md</code> appears and <code>MEMORY.md</code>{" "}
            only grows from the idle learner. If you are wondering why last
            night produced nothing, that is the first thing to check with your
            operator, ahead of anything about your own threads.
          </p>
          <p>
            Everything else keeps working either way: the idle learner still
            runs after threads go quiet, and the engine&apos;s own extraction
            and reflections are unaffected.
          </p>
        </Callout>
      </Section>

      <Section id="your-memory-files" title="Your memory files">
        <p>
          Everything both passes write lands under one folder, private to you,
          in your <DocLink slug="agent-folder">workspace</DocLink>:
        </p>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/20 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">File</th>
                <th className="px-3 py-2 font-medium">What it is</th>
                <th className="px-3 py-2 font-medium">Written by</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60 text-[13px] [&_td]:px-3 [&_td]:py-2">
              <tr>
                <td className="font-mono text-xs whitespace-nowrap">
                  memory/MEMORY.md
                </td>
                <td className="text-foreground/80">
                  the durable set — what has earned a permanent place
                </td>
                <td className="text-foreground/80">
                  both passes; the nightly one also compacts it
                </td>
              </tr>
              <tr>
                <td className="font-mono text-xs whitespace-nowrap">
                  memory/DREAMS.md
                </td>
                <td className="text-foreground/80">
                  a running diary of each night&apos;s reflection
                </td>
                <td className="text-foreground/80">the REM phase</td>
              </tr>
              <tr>
                <td className="font-mono text-xs whitespace-nowrap">
                  memory/candidates/&lt;date&gt;.md
                </td>
                <td className="text-foreground/80">
                  staged observations waiting to recur
                </td>
                <td className="text-foreground/80">the idle learner</td>
              </tr>
              <tr>
                <td className="font-mono text-xs whitespace-nowrap">
                  memory/working/&lt;date&gt;.md
                </td>
                <td className="text-foreground/80">
                  one digest per thread that went quiet that day
                </td>
                <td className="text-foreground/80">the idle learner</td>
              </tr>
              <tr>
                <td className="font-mono text-xs whitespace-nowrap">
                  memory/dreaming/&lt;phase&gt;/&lt;date&gt;.md
                </td>
                <td className="text-foreground/80">
                  the per-phase report for one night — what was considered,
                  rejected and promoted
                </td>
                <td className="text-foreground/80">the nightly pass</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          The same folder also holds notes you and the agent write directly —
          contacts, lessons, preferences, procedures. Consolidation reads those
          too, which is the cheapest way to steer it: a line you write by hand
          is a line the nightly pass will keep re-reading.
        </p>
        <Callout tone="tip" title="These are notes, not the memory store">
          <p>
            Memory files and{" "}
            <DocLink slug="memory">long-term memory records</DocLink> are two
            different things that both deserve the word memory. Records live in
            the managed engine and are found by searching; files live in the
            workspace and are found by reading. Consolidation is the bridge — it
            reads your work and writes the files.
          </p>
        </Callout>
      </Section>

      <Section id="correcting-it" title="Reading and correcting it">
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
            <strong>By reading the reports</strong> — when a promotion surprises
            you, the dated phase report says what evidence produced it.
          </li>
        </ul>
        <p>Two safety properties are worth knowing while you edit:</p>
        <ul>
          <li>
            <strong>Every write is snapshotted first.</strong> The previous
            version of a file is kept before it is replaced, and an
            idle-learning run can be rolled back wholesale if it made a mess.
          </li>
          <li>
            <strong>Writes are confined.</strong> Both passes can only write to
            an allowlist of paths under <code>memory/</code>, and files are size
            capped — consolidation cannot wander into the rest of your workspace
            or grow without bound.
          </li>
        </ul>
        <p>
          For how any of these files and records actually reach a running turn,
          continue to{" "}
          <DocLink slug="retrieval-and-context">
            retrieval &amp; context
          </DocLink>
          .
        </p>
      </Section>
    </DocArticle>
  );
}
