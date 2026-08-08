/**
 * Spaces (Spaces & threads) — THINK-697 content pass.
 *
 * Every claim here is checked against the shipped surfaces rather than the
 * older Starlight MDX, which still describes a tabbed "Space Studio" admin
 * app that does not exist in this repo. Notably: create takes three fields,
 * Delete archives, and the member list has server mutations but no screen.
 */
import { DocArticle, Callout, DocLink, Section, Term } from "../kit";
import type { DocTocEntry } from "../registry";
import { SpaceCompositionDiagram } from "../figures/spaces-threads";

export const SPACES_TOC: DocTocEntry[] = [
  { id: "what-a-space-is", title: "What a space is" },
  { id: "membership", title: "Membership and visibility" },
  { id: "organizing-work", title: "Organizing work" },
];

export function Spaces() {
  return (
    <DocArticle
      eyebrow="Spaces & threads"
      title="Spaces"
      lead="A space is the container your work lives in: a set of people, an agent, and everything that agent is allowed to read on their behalf."
    >
      <Section id="what-a-space-is" title="What a space is">
        <p>
          Your tenant has <strong>one agent</strong>. A space does not give you
          a second one — it wraps the one you have in a local context, so the
          same agent arrives at a Support question and a Finance question
          knowing different things. That is the whole idea, and everything below
          is a consequence of it.
        </p>
        <SpaceCompositionDiagram />
        <p>A space carries four kinds of thing, and nothing else:</p>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/20 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">What it carries</th>
                <th className="px-3 py-2 font-medium">What that means</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60 text-[13px] [&_td]:px-3 [&_td]:py-2">
              <tr>
                <td className="font-medium whitespace-nowrap">Members</td>
                <td className="text-foreground/80">
                  Who can open the space and start work in it. Public means
                  everyone in your tenant; private means a named list.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">
                  Workspace context
                </td>
                <td className="text-foreground/80">
                  Markdown files that belong to this room — procedures, customer
                  notes, team norms.{" "}
                  <DocLink slug="workspace-context">Workspace context</DocLink>{" "}
                  covers what to put in them.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">Triggers</td>
                <td className="text-foreground/80">
                  The ways work arrives here without anyone typing — a schedule,
                  an inbound email, a webhook. See{" "}
                  <DocLink slug="triggers-and-channels">
                    Triggers &amp; channels
                  </DocLink>
                  .
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">Threads</td>
                <td className="text-foreground/80">
                  Everything that has actually happened in the room, plus the
                  work items and canvases those conversations produced.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          Creating one is deliberately small.{" "}
          <strong>Settings → Spaces → New Space</strong> asks for three things:
          a <strong>name</strong>, a <strong>description</strong>, and{" "}
          <strong>access</strong> — Public or Private. There is no agent to
          pick, no model, no tool list. Those come from the Enterprise Agent,
          and the space narrows them afterwards.
        </p>
        <Callout tone="warn" title="A space is not a second agent">
          <p>
            The most common wrong mental model is &quot;a space is where I
            configure a different bot&quot;. It is not. There is one agent per
            tenant; a space supplies local context and an access boundary around
            it. If what you want is genuinely different <em>behaviour</em> — a
            research specialist, a QA reviewer — that is a sub-agent in the
            agent folder, not a space. See{" "}
            <DocLink slug="subagents-and-templates">
              Sub-agents &amp; templates
            </DocLink>
            .
          </p>
        </Callout>
      </Section>

      <Section id="membership" title="Membership and visibility">
        <p>
          Access has exactly two settings, and the difference between them is
          whether a member list exists at all.
        </p>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/20 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Access</th>
                <th className="px-3 py-2 font-medium">Who can open it</th>
                <th className="px-3 py-2 font-medium">Use it when</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60 text-[13px] [&_td]:px-3 [&_td]:py-2">
              <tr>
                <td className="font-medium whitespace-nowrap">Public</td>
                <td className="text-foreground/80">
                  Every active person in your tenant. No member list is kept.
                </td>
                <td className="text-foreground/80">
                  Broad internal rooms — general support, product questions,
                  company operations.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">Private</td>
                <td className="text-foreground/80">
                  Only people on the space&apos;s member list.
                </td>
                <td className="text-foreground/80">
                  Customer rooms, finance and legal work, incident response —
                  anything the whole tenant should not read.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          Creating, renaming and deleting a space is an{" "}
          <strong>operator action</strong>: Settings → Spaces is operator-only,
          and the underlying mutations require a tenant admin. Whoever creates a
          space is recorded as its owner.
        </p>
        <Callout tone="note" title="The member list has no screen yet">
          <p>
            Adding and removing members is currently a server-side operation —
            the mutations exist and are enforced, but no page in the web or
            mobile app calls them. In practice private spaces get their members
            through provisioning rather than through a Members tab. If you read
            older docs describing one, that tab was never built.
          </p>
          <p>
            Two related rules worth knowing: members can only be managed on a
            private space (the call is rejected on a public one), and a
            space&apos;s owner cannot be removed.
          </p>
        </Callout>
        <p>
          Three things widen visibility beyond the member list, all of them
          narrow on purpose:
        </p>
        <ul>
          <li>
            <strong>A mention is a thread-level invite.</strong> @-mentioning
            someone in a thread inside a private space lets them see and reply
            to <em>that thread</em>, and the space appears in their sidebar so
            the thread has somewhere to live. It does not make them a member,
            and they still cannot start new threads there.
          </li>
          <li>
            <strong>An assigned work item surfaces its space.</strong> If you
            own an open work item in a space, that space shows up for you.
          </li>
          <li>
            <strong>Archived spaces disappear.</strong> Once a space is
            archived, access is refused regardless of membership.
          </li>
        </ul>
        <Callout tone="warn" title="Private is an access boundary, not a vault">
          <p>
            A private space keeps a room out of the rest of the tenant&apos;s
            view. It is not a place to keep secrets — credentials and OAuth
            tokens belong to the connector that owns them, never in a space
            file. See{" "}
            <DocLink slug="security-and-tenancy">
              Security &amp; tenancy
            </DocLink>
            .
          </p>
        </Callout>
      </Section>

      <Section id="organizing-work" title="Organizing work">
        <p>
          Every <Term>thread</Term> belongs to exactly one space — there is no
          such thing as a thread without one. When you start a chat without
          choosing a room, it lands in your tenant&apos;s automatically-created
          general space, which the sidebar shows as <strong>Chats</strong>{" "}
          rather than under a name. That is why casual conversations feel like
          they have no space: they have one, it is just not interesting enough
          to label.
        </p>
        <p>Create a new space when the difference is about the room:</p>
        <ul>
          <li>
            <strong>A different audience.</strong> The people who should read
            this work are not the people who should read the rest.
          </li>
          <li>
            <strong>A different standing context.</strong> There is a set of
            procedures, account facts or norms that should be true for
            everything here and wrong everywhere else.
          </li>
          <li>
            <strong>A different way work arrives.</strong> An inbox, a schedule,
            or a webhook feeding one stream of work.
          </li>
          <li>
            <strong>A board of its own.</strong> Work items and their statuses
            are defined per space, so a team that tracks its own pipeline wants
            its own room.
          </li>
        </ul>
        <p>Reuse an existing space when the difference is only the topic.</p>
        <Callout tone="tip" title="Fewer, thicker spaces beat many thin ones">
          <p>
            A space earns its keep through the context it carries. A room with
            no local files, no members of its own and no triggers is a label —
            it costs you a navigation step and buys nothing. If you cannot name
            what the agent should know here that it should not know elsewhere,
            you want a thread, not a space.
          </p>
        </Callout>
        <p>Once a space exists, it accumulates more than conversation:</p>
        <ul>
          <li>
            <strong>Threads</strong> — the conversations and automated runs that
            happened here, newest first on the space&apos;s home.
          </li>
          <li>
            <strong>Work items</strong> — durable task state owned by the space,
            with statuses the space itself defines. The space home shows
            open-required, blocked and due-soon counts and links to the board.
          </li>
          <li>
            <strong>Canvases and artifacts</strong> — an artifact belongs to the
            space, not to the thread that first produced it, so it survives and
            stays editable across later conversations. See{" "}
            <DocLink slug="charts-and-artifacts">
              Charts &amp; artifacts
            </DocLink>
            .
          </li>
          <li>
            <strong>Space files</strong> — reachable from the space home through
            the files toggle in the header, and from Settings → Spaces.
          </li>
        </ul>
        <Callout tone="note" title="Delete archives; it does not erase">
          <p>
            The Delete button on a space sets its status to archived. Its
            threads and its workspace files are kept — the room is removed from
            active use, not destroyed. There is no self-service way to
            hard-delete a space&apos;s history.
          </p>
        </Callout>
      </Section>
    </DocArticle>
  );
}
