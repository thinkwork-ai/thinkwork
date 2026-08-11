/**
 * Retrieval & context (Memory) — THINK-698.
 *
 * The page exists to kill one misconception: that memory is injected into
 * every turn. It is not — the composer emits a fixed set of blocks, and
 * memory reaches a turn only when the agent calls for it.
 *
 * Report restyle (Eric 2026-08-11), verified against the shipped code:
 * packages/pi-extensions/src/system-prompt-compose.ts (the block order —
 * profile policy, tool policy, sub-agent roster, then INSTRUCTIONS.md /
 * CONTEXT.md / GUARDRAILS.md / SPACE.md / User/USER.md, then the skill
 * roster; fallback prompt only when zero files load; date + requester ride
 * the turn prompt so the system half stays cacheable), agentcore-pi
 * server.ts (attachment preamble + withheld notice as the system-prompt
 * suffix; end-of-turn retain), runtime/withheld-capabilities-notice.ts,
 * runtime/workspace-skills.ts (roster is name + description; body read via
 * workspace_skill), packages/api/src/handlers/chat-agent-invoke.ts
 * (HISTORY_LIMIT = 30), lib/memory/config.ts (default recall limit 10),
 * pi-extensions/attachments.ts + runtime/message-attachments.ts (24 KB
 * preview, 512 KB full read with a truncation notice), handlers/
 * workspace-fetch-source.ts (Space source folders and participant User
 * folders, fetched read-only mid-turn), lib/workspace-renderer/
 * effective-policy-composer.ts (blocked beats allowed), lib/skills/
 * message-pinned-skills.ts (KD4 — an admin blocklist filters operator
 * pins), and packages/workspace-defaults/src/index.ts (GUARDRAILS.md is a
 * PINNED_FILE with explicit per-agent accept; embedded instructions are
 * never higher-priority authority).
 */
import {
  DocLink,
  DocTable,
  Invariant,
  PullQuote,
  ReportArticle,
  ReportSection,
  Term,
} from "../kit";
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
    <ReportArticle
      eyebrow="Memory"
      title="Retrieval & context"
      lead="Storing memory is the easy half. This page is about the other half: getting the right piece of it in front of the agent at the right moment."
    >
      <ReportSection id="what-enters-a-turn" title="What enters a turn">
        <p>
          Every turn is assembled the same way, from two prompts and a set of
          tools. The <strong>system prompt</strong> is the stable part —
          policy blocks the platform writes, files you write, and a roster of
          what the agent can reach. The <strong>turn prompt</strong> is the
          part that changes: today&apos;s date, who is asking, the recent
          conversation, and the message itself.
        </p>
        <ContextCompositionDiagram />
        <p>
          The split is not cosmetic. Anything that changes per day or per
          person is kept out of the system prompt so the stable half can be
          cached between turns — which is why the date arrives with your
          message rather than in the instructions above it.
        </p>
        <PullQuote who="the single most useful thing to know on this page">
          Memory is not injected — the agent has to ask.
        </PullQuote>
        <p>
          There is no retained-memory block in the prompt. Nothing searches
          your memory on your behalf before the turn starts; the agent
          decides, mid-turn, whether the question warrants a lookup and calls{" "}
          <strong>recall</strong> if so. &ldquo;It forgot&rdquo; is very
          often &ldquo;it never looked&rdquo; — and the fix is a nudge
          (&ldquo;check what you know about this account first&rdquo;), not
          more memory.
        </p>
      </ReportSection>

      <ReportSection id="the-order" title="The order, and what beats what">
        <p>
          The composer emits blocks in a fixed order, and the order is chosen
          around how models read: strongest attention at the start and the
          end, weakest in the middle.
        </p>
        <DocTable
          head={["Block", "Who writes it", "Why it sits there"]}
          rows={[
            [
              <strong>Profile and tool policy</strong>,
              "the platform",
              "how to behave with the exact tools this turn has — recomputed per turn, not a static list",
            ],
            [
              <strong>Sub-agent roster</strong>,
              <>
                the <DocLink slug="subagents-and-templates">agents/</DocLink>{" "}
                folders
              </>,
              "descriptions only, so delegation is a routing decision rather than a second personality in the prompt",
            ],
            [
              <code>INSTRUCTIONS.md</code>,
              "you",
              <>
                first of the files, because it is what the agent <em>is</em>
              </>,
            ],
            [
              <code>CONTEXT.md</code>,
              "the agent folder (seeded with a default)",
              "the task router — which part of the workspace to load for which kind of task",
            ],
            [
              <code>GUARDRAILS.md</code>,
              "your operator",
              "the safety floor — must hold whatever else is in the prompt",
            ],
            [
              <code>SPACE.md</code>,
              <>
                the <DocLink slug="spaces">Space</DocLink>
              </>,
              "what this room is for, and who is in it",
            ],
            [
              <code>USER.md</code>,
              "you, and the platform",
              "last of the files, in the strong end position — your profile is what the agent should never have to search for",
            ],
            [
              <strong>Skill roster</strong>,
              <>
                installed <DocLink slug="skills">skills</DocLink>
              </>,
              "names and descriptions, so the agent knows what exists without paying for what it does not need",
            ],
          ]}
        />
        <p>When two sources disagree, four rules settle it:</p>
        <ul>
          <li>
            <strong>Your workspace beats stored defaults.</strong> If the
            agent folder has instructions, they are what runs; the fallback
            prompt only appears when no workspace file loaded at all.
          </li>
          <li>
            <strong>Blocked beats allowed.</strong> A tool that appears on
            both an allow list and a block list is blocked.
          </li>
          <li>
            <strong>
              An administrator&apos;s block beats an operator&apos;s pin.
            </strong>{" "}
            Pinning a skill for a turn cannot re-enable something the tenant
            has forbidden.
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
        <Invariant title="Guardrail updates wait for a person">
          <p>
            <code>GUARDRAILS.md</code> is pinned per agent rather than
            followed live. When your operator improves the tenant template,
            existing agents show an update as available and someone has to
            accept it — deliberately, so a safety file never changes under a
            running fleet without a person saying yes.
          </p>
        </Invariant>
      </ReportSection>

      <ReportSection id="fetched-during-the-turn" title="Fetched during the turn">
        <p>
          Everything expensive is a roster entry first and a fetch second.
          The agent sees that a thing exists, and pays for its contents only
          when it decides the thing applies.
        </p>
        <DocTable
          head={["In the prompt", "Fetched when needed"]}
          rows={[
            [
              "A skill's name and one-line description",
              "the full procedure, read before it is applied",
            ],
            [
              "A sub-agent's description",
              "its own instructions, which it runs with — never merged into the parent's prompt",
            ],
            [
              "This Space's context",
              "another Space's source folder or a participant's shared User folder, fetched read-only on request",
            ],
            [
              "An attachment's name, type and a short preview",
              "the whole file",
            ],
            [
              "That memory tools exist",
              "matching memory records, via a search the agent runs",
            ],
          ]}
        />
        <p>
          One more block is worth recognising when you see it: if a
          capability was granted but could not be loaded for this turn, the
          prompt carries a{" "}
          <strong>notice of what was withheld and why</strong>, with an
          instruction to say so rather than improvise the missing
          tool&apos;s output. An agent that tells you a connector is
          unavailable is following that block, not failing.
        </p>
      </ReportSection>

      <ReportSection id="limits" title="Limits">
        <DocTable
          head={["What", "Limit", "What happens past it"]}
          rows={[
            [
              <strong>Conversation history</strong>,
              "the last 30 messages of the thread",
              "older turns are simply not in the prompt — they are still in the thread record",
            ],
            [
              <strong>Memory results</strong>,
              "up to 10 records per recall",
              "the rest are ranked out; a narrower query beats a broader one",
            ],
            [
              <strong>Attachment preview</strong>,
              "24 KB inline",
              "the agent reads the file with a tool to see the rest",
            ],
            [
              <strong>Reading an attachment in full</strong>,
              "512 KB",
              "the result is truncated, and says so",
            ],
          ]}
        />
        <p>
          Nothing trims the context to fit. There is no budgeting pass that
          measures the assembled prompt and drops the least important part —
          the caps above are the whole mechanism, and past them the
          model&apos;s own window is the backstop. So context discipline is
          an authoring job, not a runtime one: a 300-line{" "}
          <code>INSTRUCTIONS.md</code>, forty installed skills and a long{" "}
          <code>USER.md</code> are all paid for on every single turn, in
          every thread, forever. Trimming them is the highest-leverage tuning
          available to you.
        </p>
      </ReportSection>

      <ReportSection id="when-it-forgets" title="When it forgets something">
        <p>
          Work down this list; the causes are ordered by how often they turn
          out to be the answer.
        </p>
        <ol>
          <li>
            <strong>It never looked.</strong> Recall is a choice the agent
            makes. Ask it directly — &ldquo;what do you remember about
            X?&rdquo; — and see whether the answer changes.
          </li>
          <li>
            <strong>You are past the history window.</strong> In a long{" "}
            <Term>thread</Term>, something from two hundred messages ago is
            not in front of the model. Restate it, or start a fresh thread.
          </li>
          <li>
            <strong>It is the wrong kind of memory.</strong> A recall
            reaches facts, preferences and things you asked it to remember —
            not the summary or episode of an old thread. See{" "}
            <DocLink slug="memory">how memory works</DocLink>.
          </li>
          <li>
            <strong>It has not been extracted yet.</strong> A fact from
            minutes ago may still be in flight; extraction is asynchronous.
          </li>
          <li>
            <strong>The turn had no memory to reach.</strong> Evaluation runs
            and turns with no person behind them run without memory by
            design.
          </li>
        </ol>
        <p>
          When a fact should never depend on any of the above, promote it out
          of memory entirely: put it in your profile or the agent&apos;s
          instructions, where it is read every turn without being asked for.
          That is the whole trade —{" "}
          <DocLink slug="workspace-context">workspace context</DocLink> costs
          tokens on every turn and is never missed;{" "}
          <DocLink slug="compounding-memory">compounding memory</DocLink>{" "}
          costs nothing until it is needed and is sometimes not found.
        </p>
      </ReportSection>
    </ReportArticle>
  );
}
