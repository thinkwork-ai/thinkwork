/**
 * Retrieval & context (Memory) — THINK-698.
 *
 * The page exists to kill one misconception: that memory is injected into
 * every turn. It is not — the composer emits a fixed set of blocks, and
 * memory reaches a turn only when the agent calls for it. Everything else
 * here (the order, the caps, the "why did it forget" checklist) follows
 * from that one fact.
 */
import { Callout, DocArticle, DocLink, Section, Term } from "../kit";
import { ContextCompositionDiagram } from "../figures/memory";
import type { DocTocEntry } from "../registry";

export const RETRIEVAL_AND_CONTEXT_TOC: DocTocEntry[] = [
  { id: "what-enters-a-turn", title: "What enters a turn" },
  { id: "the-order", title: "The order, and what beats what" },
  { id: "fetched-during-the-turn", title: "Fetched during the turn" },
  { id: "limits", title: "Limits" },
  { id: "when-it-forgets", title: "When it forgets something" },
];

export function RetrievalAndContext() {
  return (
    <DocArticle
      eyebrow="Memory"
      title="Retrieval & context"
      lead="Storing memory is the easy half. This page is about the other half: getting the right piece of it in front of the agent at the right moment."
    >
      <Section id="what-enters-a-turn" title="What enters a turn">
        <p>
          Every turn is assembled the same way, from two prompts and a set of
          tools. The <strong>system prompt</strong> is the stable part — policy
          blocks the platform writes, files you write, and a roster of what the
          agent can reach. The <strong>turn prompt</strong> is the part that
          changes: today&apos;s date, who is asking, the recent conversation,
          and the message itself.
        </p>
        <ContextCompositionDiagram />
        <p>
          The split is not cosmetic. Anything that changes per day or per person
          is kept out of the system prompt so the stable half can be cached
          between turns — which is why the date arrives with your message rather
          than in the instructions above it.
        </p>
        <Callout
          tone="warn"
          title="Memory is not injected — the agent has to ask"
        >
          <p>
            There is no retained-memory block in the prompt. Nothing searches
            your memory on your behalf before the turn starts; the agent
            decides, mid-turn, whether the question warrants a lookup and calls{" "}
            <strong>recall</strong> if so.
          </p>
          <p>
            That is the single most useful thing to know on this page. &ldquo;It
            forgot&rdquo; is very often &ldquo;it never looked&rdquo; — and the
            fix is a nudge (&ldquo;check what you know about this account
            first&rdquo;), not more memory.
          </p>
        </Callout>
      </Section>

      <Section id="the-order" title="The order, and what beats what">
        <p>
          The composer emits blocks in a fixed order, and the order is chosen
          around how models read: strongest attention at the start and the end,
          weakest in the middle.
        </p>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/20 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Block</th>
                <th className="px-3 py-2 font-medium">Who writes it</th>
                <th className="px-3 py-2 font-medium">Why it sits there</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60 text-[13px] [&_td]:px-3 [&_td]:py-2">
              <tr>
                <td className="font-medium whitespace-nowrap">
                  Profile and tool policy
                </td>
                <td className="text-foreground/80">the platform</td>
                <td className="text-foreground/80">
                  how to behave with the exact tools this turn has — recomputed
                  per turn, not a static list
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">
                  Sub-agent roster
                </td>
                <td className="text-foreground/80">
                  the <DocLink slug="subagents-and-templates">agents/</DocLink>{" "}
                  folders
                </td>
                <td className="text-foreground/80">
                  descriptions only, so delegation is a routing decision rather
                  than a second personality in the prompt
                </td>
              </tr>
              <tr>
                <td className="font-mono text-xs whitespace-nowrap">
                  INSTRUCTIONS.md
                </td>
                <td className="text-foreground/80">you</td>
                <td className="text-foreground/80">
                  first, because it is what the agent <em>is</em>
                </td>
              </tr>
              <tr>
                <td className="font-mono text-xs whitespace-nowrap">
                  GUARDRAILS.md
                </td>
                <td className="text-foreground/80">your operator</td>
                <td className="text-foreground/80">
                  the safety floor — must hold whatever else is in the prompt
                </td>
              </tr>
              <tr>
                <td className="font-mono text-xs whitespace-nowrap">
                  SPACE.md
                </td>
                <td className="text-foreground/80">
                  the <DocLink slug="spaces">Space</DocLink>
                </td>
                <td className="text-foreground/80">
                  what this room is for, and who is in it
                </td>
              </tr>
              <tr>
                <td className="font-mono text-xs whitespace-nowrap">USER.md</td>
                <td className="text-foreground/80">you, and the platform</td>
                <td className="text-foreground/80">
                  last, in the strong end position — your profile is what the
                  agent should never have to search for
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">Skill roster</td>
                <td className="text-foreground/80">
                  installed <DocLink slug="skills">skills</DocLink>
                </td>
                <td className="text-foreground/80">
                  names and descriptions, so the agent knows what exists without
                  paying for what it does not need
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>When two sources disagree, four rules settle it:</p>
        <ul>
          <li>
            <strong>Your workspace beats stored defaults.</strong> If the agent
            folder has instructions, they are what runs; the fallback prompt
            only appears when no workspace file loaded at all.
          </li>
          <li>
            <strong>Blocked beats allowed.</strong> A tool that appears on both
            an allow list and a block list is blocked, at every layer.
          </li>
          <li>
            <strong>
              An administrator&apos;s block beats an operator&apos;s pin.
            </strong>{" "}
            Pinning a skill for a turn cannot re-enable something the tenant has
            forbidden.
          </li>
          <li>
            <strong>Content is never authority.</strong> Instructions found
            inside a file, an issue body, tool output or a memory record are
            data to consider, not orders to follow. The live message and the
            guardrails outrank all of it — see{" "}
            <DocLink slug="approvals-and-guardrails">
              approvals &amp; guardrails
            </DocLink>
            .
          </li>
        </ul>
        <Callout
          tone="note"
          title="Guardrail updates do not arrive on their own"
        >
          <p>
            <code>GUARDRAILS.md</code> is pinned per agent rather than followed
            live. When your operator improves the tenant template, existing
            agents show an update as available and someone has to accept it —
            deliberately, so a safety file never changes under a running fleet
            without a person saying yes.
          </p>
        </Callout>
      </Section>

      <Section id="fetched-during-the-turn" title="Fetched during the turn">
        <p>
          Everything expensive is a roster entry first and a fetch second. The
          agent sees that a thing exists, and pays for its contents only when it
          decides the thing applies.
        </p>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/20 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">In the prompt</th>
                <th className="px-3 py-2 font-medium">Fetched when needed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60 text-[13px] [&_td]:px-3 [&_td]:py-2">
              <tr>
                <td className="text-foreground/80">
                  A skill&apos;s name and one-line description
                </td>
                <td className="text-foreground/80">
                  the full procedure, read before it is applied
                </td>
              </tr>
              <tr>
                <td className="text-foreground/80">
                  A sub-agent&apos;s description
                </td>
                <td className="text-foreground/80">
                  its own instructions, which it runs with — never merged into
                  the parent&apos;s prompt
                </td>
              </tr>
              <tr>
                <td className="text-foreground/80">
                  This Space&apos;s context
                </td>
                <td className="text-foreground/80">
                  another Space or teammate&apos;s shared workspace, mounted
                  read-only on request
                </td>
              </tr>
              <tr>
                <td className="text-foreground/80">
                  An attachment&apos;s name, type and a short preview
                </td>
                <td className="text-foreground/80">the whole file</td>
              </tr>
              <tr>
                <td className="text-foreground/80">That memory tools exist</td>
                <td className="text-foreground/80">
                  matching memory records, via a search the agent runs
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          One more block is worth recognising when you see it: if a capability
          was granted but could not be loaded for this turn, the prompt carries
          a <strong>notice of what was withheld and why</strong>, with an
          instruction to say so rather than improvise the missing tool&apos;s
          output. An agent that tells you a connector is unavailable is
          following that block, not failing.
        </p>
      </Section>

      <Section id="limits" title="Limits">
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/20 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">What</th>
                <th className="px-3 py-2 font-medium">Limit</th>
                <th className="px-3 py-2 font-medium">What happens past it</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60 text-[13px] [&_td]:px-3 [&_td]:py-2">
              <tr>
                <td className="font-medium whitespace-nowrap">
                  Conversation history
                </td>
                <td className="text-foreground/80">
                  the last 30 messages of the thread
                </td>
                <td className="text-foreground/80">
                  older turns are simply not in the prompt — they are still in
                  the thread record
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">
                  Memory results
                </td>
                <td className="text-foreground/80">
                  up to 10 records per recall
                </td>
                <td className="text-foreground/80">
                  the rest are ranked out; a narrower query beats a broader one
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">
                  Attachment preview
                </td>
                <td className="text-foreground/80">24 KB inline</td>
                <td className="text-foreground/80">
                  the agent reads the file with a tool to see the rest
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">
                  A single file read
                </td>
                <td className="text-foreground/80">512 KB</td>
                <td className="text-foreground/80">
                  the result is truncated, and says so
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <Callout tone="warn" title="Nothing trims the context to fit">
          <p>
            There is no budgeting pass that measures the assembled prompt and
            drops the least important part. The caps above are the whole
            mechanism, and past them the model&apos;s own window is the
            backstop.
          </p>
          <p>
            So context discipline is an authoring job, not a runtime one. A
            300-line <code>INSTRUCTIONS.md</code>, forty installed skills and a
            long <code>USER.md</code> are all paid for on every single turn, in
            every thread, forever. Trimming them is the highest-leverage tuning
            available to you.
          </p>
        </Callout>
      </Section>

      <Section id="when-it-forgets" title="When it forgets something">
        <p>
          Work down this list; the causes are ordered by how often they turn out
          to be the answer.
        </p>
        <ol>
          <li>
            <strong>It never looked.</strong> Recall is a choice the agent
            makes. Ask it directly — &ldquo;what do you remember about X?&rdquo;
            — and see whether the answer changes.
          </li>
          <li>
            <strong>You are past the history window.</strong> In a long{" "}
            <Term>thread</Term>, something from two hundred messages ago is not
            in front of the model. Restate it, or start a fresh thread.
          </li>
          <li>
            <strong>It is the wrong kind of memory.</strong> A recall reaches
            facts, preferences and things you asked it to remember — not the
            summary or episode of an old thread. See{" "}
            <DocLink slug="memory">how memory works</DocLink>.
          </li>
          <li>
            <strong>It has not been extracted yet.</strong> A fact from minutes
            ago may still be in flight; extraction is asynchronous.
          </li>
          <li>
            <strong>The turn had no memory to reach.</strong> Evaluation runs
            and unattended triggers with no person behind them run without
            memory by design.
          </li>
        </ol>
        <p>
          When a fact should never depend on any of the above, promote it out of
          memory entirely: put it in your profile or the agent&apos;s
          instructions, where it is read every turn without being asked for.
          That is the whole trade —{" "}
          <DocLink slug="workspace-context">workspace context</DocLink> costs
          tokens on every turn and is never missed;{" "}
          <DocLink slug="compounding-memory">compounding memory</DocLink> costs
          nothing until it is needed and is sometimes not found.
        </p>
      </Section>
    </DocArticle>
  );
}
