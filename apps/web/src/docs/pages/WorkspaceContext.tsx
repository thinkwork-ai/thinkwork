/**
 * Workspace context (Spaces & threads) — report restyle (2026-08-11 docs
 * overhaul).
 *
 * Claims verified against the shipped code:
 * packages/api/src/lib/workspace-renderer/compose-tuple.ts (the per-turn
 * hydration layers: agent at the root, the active space at `Space/`
 * singular, the requester at `User/`, thread scratch at `Thread/`; other
 * authorized spaces mounted as `Spaces/<slug>/` pointers) with
 * agents-md-composer.ts (the agent is told other spaces are fetchable) and
 * packages/api/src/handlers/workspace-fetch-source.ts (the read-only
 * mid-turn fetch), packages/api/src/handlers/chat-agent-invoke.ts
 * (identity resolves from the message sender first — per message, not per
 * thread — and the tuple renders once during turn setup, so edits land on
 * the next turn), packages/workspace-defaults/files/SPACE.md +
 * packages/api/src/lib/spaces/space-md-source-file.ts (the seeded
 * template and its headings), packages/api/src/lib/workspace-lanes.ts
 * (the folders a space may own), and packages/api/src/lib/
 * workspace-renderer/space-md-parser.ts + effective-policy-composer.ts
 * (THINK-302 U6 R21: space tool/mcp policy is retired; frontmatter
 * security fields are parsed for review only; exactly name and
 * description auto-apply; space-scoped skills are grants-by-presence —
 * a skills/<slug>/SKILL.md folder — never a frontmatter list).
 *
 * Deliberately not mentioned, because they are retired: space memory
 * banks, space "Brain Sources", a space INSTRUCTIONS.md, and any live
 * space-level tool restriction.
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
import type { DocTocEntry } from "../registry";

export const WORKSPACE_CONTEXT_TOC: DocTocEntry[] = [
  { id: "what-the-agent-sees", title: "What the agent sees" },
  { id: "files-and-artifacts", title: "Files and artifacts" },
  { id: "scoping", title: "Scoping context to a thread" },
];

export function WorkspaceContext() {
  return (
    <ReportArticle
      eyebrow="Spaces & threads"
      title="Workspace context"
      lead="Context is not everything the agent could reach — it is what is placed in front of it for this turn. This page is about that selection."
    >
      <ReportSection id="what-the-agent-sees" title="What the agent sees">
        <p>
          Before a turn runs, the platform assembles a small filesystem for
          the agent to work from. It is not your whole tenant — it is four
          layers, picked for this turn:
        </p>
        <DocTable
          head={["Layer", "Where it appears", "What belongs in it"]}
          rows={[
            [
              <strong>The agent itself</strong>,
              "the root of the workspace",
              <>
                Who the agent is and how it works everywhere — its
                instructions, guardrails and installed skills. Tenant-wide,
                and true in every room. See{" "}
                <DocLink slug="agent-folder">The agent folder</DocLink>.
              </>,
            ],
            [
              <strong>The active space</strong>,
              <code>Space/</code>,
              <>
                Everything true of <em>this room</em> — procedures, customer
                facts, team norms, the way work is done here.
              </>,
            ],
            [
              <strong>You</strong>,
              <code>User/</code>,
              "Whoever sent the message: their preferences, their memory, their connected accounts.",
            ],
            [
              <strong>This thread</strong>,
              <code>Thread/</code>,
              "Scratch space for the conversation in progress — working notes and files the turn produces.",
            ],
          ]}
        />
        <p>
          The middle two layers are the interesting ones, and they are what
          makes the &quot;one agent&quot; model workable. The same agent
          answering a Support question and a Finance question is genuinely the
          same agent — same instructions, same skills — but{" "}
          <code>Space/</code> is different, so it arrives already knowing this
          team&apos;s escalation path rather than the other team&apos;s
          close-of-books checklist. You do not clone an agent to specialise
          it; you give the room better files.
        </p>
        <PullQuote who="the line that settles most placement questions">
          Spaces shape, they do not grant. Reach — which tools, which
          connectors the agent may use — is granted on the agent; a{" "}
          <Term>space</Term> shapes how that reach is used here.
        </PullQuote>
        <p>
          Hold that line and most decisions about where to put something
          answer themselves: what to care about here, what the house style
          is, which procedure applies — those are space files. If your
          instinct is &quot;this space should be allowed to use X&quot;, that
          is an agent-level change, not a space file.
        </p>
        <p>
          The layer for &quot;you&quot; re-resolves per message, not per
          thread. In a thread with two people, consecutive turns can carry
          different personal context, because each turn is contextualised by
          whoever sent the message that started it.
        </p>
      </ReportSection>

      <ReportSection id="files-and-artifacts" title="Files and artifacts">
        <p>
          A space&apos;s context is plain markdown you write. Every new space
          starts with a <code>SPACE.md</code>, seeded from a template with the
          headings worth filling in:
        </p>
        <ul>
          <li>
            <strong>What this space is</strong> — one paragraph naming the
            work that happens here.
          </li>
          <li>
            <strong>What to load</strong> — which of the space&apos;s other
            files matter for which kind of request, and which to skip. This is
            the highest-value section: it is how the agent avoids reading
            everything.
          </li>
          <li>
            <strong>Working context</strong> — the standing facts. Accounts,
            systems, names, numbers that do not change per conversation.
          </li>
          <li>
            <strong>The process</strong> — how work is actually done here, in
            order.
          </li>
          <li>
            <strong>Skills &amp; tools</strong> — which of the agent&apos;s
            capabilities matter here, as prose the agent reads. The template
            itself reminds you this section describes; it does not grant.
          </li>
          <li>
            <strong>Operating agreements</strong> and{" "}
            <strong>what not to do</strong> — the local rules, including the
            ones that only make sense in this room.
          </li>
        </ul>
        <p>
          Beyond <code>SPACE.md</code>, a space folder can hold{" "}
          <code>CONTEXT.md</code>, <code>docs/</code>, <code>knowledge/</code>
          , <code>plans/</code>, <code>goals/</code>, <code>workflows/</code>,{" "}
          <code>artifacts/</code> and <code>skills/</code>. All of it hydrates
          under <code>Space/</code> when work runs here, so a long runbook can
          live in <code>docs/</code> and be pointed at from the load table
          rather than pasted into the main file.
        </p>
        <p>Two places edit these files, and they edit the same thing:</p>
        <ul>
          <li>
            <strong>From the space</strong> — the files toggle in the space
            home header opens the editor on the space&apos;s own files.
          </li>
          <li>
            <strong>From settings</strong> — Settings → Spaces → a space → the
            files icon.
          </li>
        </ul>
        <Invariant title="Frontmatter in SPACE.md does not grant anything">
          <p>
            You can write <code>tools:</code>, <code>mcp:</code>,{" "}
            <code>model:</code>, <code>bash:</code> or <code>skills:</code>{" "}
            keys at the top of <code>SPACE.md</code>, and they will be read
            and shown back to you — but they are{" "}
            <strong>parsed for review, not applied</strong>. The only fields
            that take effect are the space&apos;s name and description. A
            skill that should be available in this space is a{" "}
            <code>skills/&lt;slug&gt;/</code> folder placed in the space —
            granted by presence, like everywhere else — never a frontmatter
            list. This is on purpose: a capability that could be granted by
            editing a markdown file would make every space file a security
            surface.
          </p>
        </Invariant>
        <p>
          One more boundary: the space folder is for markdown you author. It
          is not an upload target for PDFs and spreadsheets — file attachments
          belong to a thread, and durable outputs belong to{" "}
          <DocLink slug="charts-and-artifacts">artifacts</DocLink>, which are
          owned by the space and survive the thread that made them.
        </p>
      </ReportSection>

      <ReportSection id="scoping" title="Scoping context to a thread">
        <p>
          A thread runs in exactly one space, and only that space is loaded.
          Other spaces you have access to are not hidden — the agent is told
          they exist and where they live — but their contents are not in front
          of it. If a question genuinely needs another room&apos;s material,
          the agent fetches that folder read-only, mid-turn, and says so.
        </p>
        <p>
          That is the mechanism behind the isolation you actually want:
          Finance&apos;s procedures do not leak into Support&apos;s answers,
          not because they are forbidden, but because they were never in the
          room.
        </p>
        <p>
          There is no context slider — you widen and narrow with files, not
          settings. To narrow a space, delete or tighten its files; an
          accurate <em>what to load</em> table does more than any amount of
          prompt instruction. To widen it, add the missing document to the
          space that needs it, rather than promoting it to the agent where
          every room inherits it.
        </p>
        <p>
          Two timing rules are worth knowing, because both surprise people:
        </p>
        <ul>
          <li>
            <strong>Edits land on the next turn, not this one.</strong> A turn
            already in flight finishes on the context it loaded. Save your
            change, then send the next message.
          </li>
          <li>
            <strong>A cold thread reads the same files as a warm one.</strong>{" "}
            Whether the agent answers instantly or takes a moment to spin up,
            it is looking at the current files either way — see{" "}
            <DocLink slug="threads">Threads</DocLink>.
          </li>
        </ul>
        <p>
          And a rule of thumb for the opposite direction: if two rooms need
          the same paragraph, it belongs on the agent. Copying a policy into
          four spaces guarantees that in six months three of them are wrong.
          Space files should be things that are true{" "}
          <em>here and not elsewhere</em>; anything universal goes in the
          agent&apos;s own instructions, where there is one copy to keep right
          — see{" "}
          <DocLink slug="workspace-composition">
            Workspace composition &amp; inheritance
          </DocLink>
          .
        </p>
      </ReportSection>
    </ReportArticle>
  );
}
