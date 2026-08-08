/**
 * Workspace context (Spaces & threads) — THINK-697 content pass.
 *
 * Deliberate accuracy notes, because the older MDX gets these wrong:
 *  - the active space mounts at `Space/` (singular). `Spaces/<slug>/` is only
 *    for other authorized spaces, which are pointers rather than content.
 *  - the space file is SPACE.md. A space `INSTRUCTIONS.md` is not a thing.
 *  - SPACE.md frontmatter does not grant capabilities; only name/description
 *    auto-apply, the rest is parsed for review.
 *  - space memory banks and space "Brain Sources" are retired; don't mention.
 */
import { Callout, DocArticle, DocLink, Section, Term } from "../kit";
import type { DocTocEntry } from "../registry";

export const WORKSPACE_CONTEXT_TOC: DocTocEntry[] = [
  { id: "what-the-agent-sees", title: "What the agent sees" },
  { id: "files-and-artifacts", title: "Files and artifacts" },
  { id: "scoping", title: "Scoping context to a thread" },
];

export function WorkspaceContext() {
  return (
    <DocArticle
      eyebrow="Spaces & threads"
      title="Workspace context"
      lead="Context is not everything the agent could reach — it is what is placed in front of it for this turn. This page is about that selection."
    >
      <Section id="what-the-agent-sees" title="What the agent sees">
        <p>
          Before a turn runs, the platform assembles a small filesystem for the
          agent to work from. It is not your whole tenant — it is four layers,
          picked for this turn:
        </p>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/20 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Layer</th>
                <th className="px-3 py-2 font-medium">Where it appears</th>
                <th className="px-3 py-2 font-medium">What belongs in it</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60 text-[13px] [&_td]:px-3 [&_td]:py-2">
              <tr>
                <td className="font-medium whitespace-nowrap">
                  The agent itself
                </td>
                <td className="text-foreground/80">
                  the root of the workspace
                </td>
                <td className="text-foreground/80">
                  Who the agent is and how it works everywhere — its
                  instructions, guardrails and installed skills. Tenant-wide,
                  and true in every room. See{" "}
                  <DocLink slug="agent-folder">The agent folder</DocLink>.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">
                  The active space
                </td>
                <td className="text-foreground/80">
                  <code>Space/</code>
                </td>
                <td className="text-foreground/80">
                  Everything true of <em>this room</em> — procedures, customer
                  facts, team norms, the way work is done here.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">You</td>
                <td className="text-foreground/80">
                  <code>User/</code>
                </td>
                <td className="text-foreground/80">
                  Whoever sent the message: their preferences, their memory,
                  their connected accounts.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">This thread</td>
                <td className="text-foreground/80">
                  <code>Thread/</code>
                </td>
                <td className="text-foreground/80">
                  Scratch space for the conversation in progress — working notes
                  and files the turn produces.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          The middle two layers are the interesting ones, and they are what
          makes the &quot;one agent&quot; model workable. The same agent
          answering a Support question and a Finance question is genuinely the
          same agent — same instructions, same skills — but <code>Space/</code>{" "}
          is different, so it arrives already knowing this team&apos;s
          escalation path rather than the other team&apos;s close-of-books
          checklist. You do not clone an agent to specialise it; you give the
          room better files.
        </p>
        <Callout tone="tip" title="Spaces shape, they do not grant">
          <p>
            Hold this line and most decisions about where to put something
            answer themselves. <strong>Reach</strong> — which tools, which
            connectors, which skills the agent may use — is granted on the
            agent. A <Term>space</Term> shapes how that reach is used: what to
            care about here, what the house style is, which procedure applies.
            If your instinct is &quot;this space should be allowed to use
            X&quot;, that is an agent-level change, not a space file.
          </p>
        </Callout>
        <p>
          The layer for &quot;you&quot; re-resolves per message, not per thread.
          In a thread with two people, consecutive turns can carry different
          personal context, because each turn is contextualised by whoever sent
          the message that started it.
        </p>
      </Section>

      <Section id="files-and-artifacts" title="Files and artifacts">
        <p>
          A space&apos;s context is plain markdown you write. Every new space
          starts with a <code>SPACE.md</code>, seeded from a template with the
          headings worth filling in:
        </p>
        <ul>
          <li>
            <strong>What this space is</strong> — one paragraph naming the work
            that happens here.
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
            <strong>Operating agreements</strong> and{" "}
            <strong>what not to do</strong> — the local rules, including the
            ones that only make sense in this room.
          </li>
        </ul>
        <p>
          Beyond <code>SPACE.md</code>, a space folder can hold{" "}
          <code>CONTEXT.md</code>, <code>docs/</code>, <code>knowledge/</code>,{" "}
          <code>plans/</code>, <code>goals/</code>, <code>workflows/</code> and{" "}
          <code>skills/</code>. All of it hydrates under <code>Space/</code>{" "}
          when work runs here, so a long runbook can live in <code>docs/</code>{" "}
          and be pointed at from the load table rather than pasted into the main
          file.
        </p>
        <p>Two places edit these files, and they edit the same thing:</p>
        <ul>
          <li>
            <strong>From the space</strong> — the files toggle in the space home
            header opens the editor on the space&apos;s own files.
          </li>
          <li>
            <strong>From settings</strong> — Settings → Spaces → a space → the
            files icon.
          </li>
        </ul>
        <Callout
          tone="warn"
          title="Frontmatter in SPACE.md does not grant anything"
        >
          <p>
            You can write <code>tools:</code>, <code>mcp:</code>,{" "}
            <code>model:</code> or <code>bash:</code> keys at the top of{" "}
            <code>SPACE.md</code>, and they will be read and shown back to you —
            but they are <strong>parsed for review, not applied</strong>. The
            only fields that take effect are the space&apos;s name and
            description. A file that says the agent may use a tool does not make
            it so; the grant lives on the agent.
          </p>
          <p>
            This is on purpose. A capability that could be granted by editing a
            markdown file would make every space file a security surface.
          </p>
        </Callout>
        <Callout tone="note" title="Space files are text, not a document store">
          <p>
            The space folder is for markdown you author. It is not an upload
            target for PDFs and spreadsheets — file attachments belong to a
            thread, and durable outputs belong to{" "}
            <DocLink slug="charts-and-artifacts">artifacts</DocLink>, which are
            owned by the space and survive the thread that made them.
          </p>
        </Callout>
      </Section>

      <Section id="scoping" title="Scoping context to a thread">
        <p>
          A thread runs in exactly one space, and only that space is loaded.
          Other spaces you have access to are not hidden — the agent is told
          they exist and where they live — but their contents are not in front
          of it. If a question genuinely needs another room&apos;s material, the
          agent fetches that folder read-only, mid-turn, and says so.
        </p>
        <p>
          That is the mechanism behind the isolation you actually want:
          Finance&apos;s procedures do not leak into Support&apos;s answers, not
          because they are forbidden, but because they were never in the room.
        </p>
        <Callout tone="tip" title="Widen and narrow with files, not settings">
          <p>
            There is no context slider. To narrow a space, delete or tighten its
            files — an accurate <em>what to load</em> table does more than any
            amount of prompt instruction. To widen it, add the missing document
            to the space that needs it, rather than promoting it to the agent
            where every room inherits it.
          </p>
        </Callout>
        <p>Two timing rules are worth knowing, because both surprise people:</p>
        <ul>
          <li>
            <strong>Edits land on the next turn, not this one.</strong> A turn
            already in flight finishes on the context it loaded. Save your
            change, then send the next message.
          </li>
          <li>
            <strong>A cold thread reads the same files as a warm one.</strong>{" "}
            Whether the agent answers instantly or takes a moment to spin up, it
            is looking at the current files either way — see{" "}
            <DocLink slug="threads">Threads</DocLink>.
          </li>
        </ul>
        <Callout
          tone="warn"
          title="If two rooms need the same paragraph, it belongs on the agent"
        >
          <p>
            Copying a policy into four spaces guarantees that in six months
            three of them are wrong. Space files should be things that are true{" "}
            <em>here and not elsewhere</em>. Anything universal goes in the
            agent&apos;s own instructions, where there is one copy to keep right
            — see{" "}
            <DocLink slug="workspace-composition">
              Workspace composition &amp; inheritance
            </DocLink>
            .
          </p>
        </Callout>
      </Section>
    </DocArticle>
  );
}
