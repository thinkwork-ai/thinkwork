/**
 * Spaces (Spaces & threads) — report restyle (2026-08-11 docs overhaul).
 *
 * Claims verified against the shipped code:
 * apps/web/src/components/settings/SettingsSpaces.tsx (New Space asks for
 * exactly name, description, access), packages/api/src/graphql/resolvers/
 * spaces/createSpace.mutation.ts + updateSpace.mutation.ts +
 * deleteSpace.mutation.ts (tenant-admin gated; creator recorded as owner;
 * Delete sets status to archived and deletes nothing),
 * spaces/shared.ts (public = any active tenant member, private = the
 * space_members list; archived spaces fail the member/public access check),
 * addSpaceMember/removeSpaceMember mutations (server-side only — no web or
 * mobile screen calls them; private-only; owner cannot be removed),
 * packages/api/src/lib/mentions/thread-participant-mentions.ts +
 * spaces/spaces.query.ts (mention → thread-only participant rows; the
 * participant-thread and assigned-work-item predicates that surface a
 * space in your sidebar), packages/database-pg/src/schema/threads.ts
 * (space_id NOT NULL — every thread has a space),
 * packages/api/src/lib/spaces/default-space.ts + apps/web/src/components/
 * spaces/space-utils.ts (the auto-created General space, labelled "Chats"
 * in the client), packages/database-pg/src/schema/work-items.ts
 * (work items and their statuses are per-space), packages/database-pg/
 * src/schema/artifacts.ts (a saved canvas belongs to a space; the thread
 * is provenance), and apps/web/src/routes/_authed/_shell/
 * spaces.$spaceId.tsx (space home: counts, files toggle).
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
import { SpaceCompositionDiagram } from "../figures/spaces-threads";

export const SPACES_TOC: DocTocEntry[] = [
  { id: "what-a-space-is", title: "What a space is" },
  { id: "membership", title: "Membership and visibility" },
  { id: "organizing-work", title: "Organizing work" },
];

export function Spaces() {
  return (
    <ReportArticle
      eyebrow="Spaces & threads"
      title="Spaces"
      lead="A space is the container your work lives in: a set of people, an agent, and everything that agent is allowed to read on their behalf."
    >
      <ReportSection id="what-a-space-is" title="What a space is">
        <p>
          Your tenant has <strong>one agent</strong>. A space does not give
          you a second one — it wraps the one you have in a local context, so
          the same agent arrives at a Support question and a Finance question
          knowing different things. That is the whole idea, and everything
          below is a consequence of it.
        </p>
        <SpaceCompositionDiagram />
        <p>A space carries four kinds of thing, and nothing else:</p>
        <DocTable
          head={["What it carries", "What that means"]}
          rows={[
            [
              <strong>Members</strong>,
              "Who can open the space and start work in it. Public means everyone in your tenant; private means a named list.",
            ],
            [
              <strong>Workspace context</strong>,
              <>
                Markdown files that belong to this room — procedures, customer
                notes, team norms.{" "}
                <DocLink slug="workspace-context">Workspace context</DocLink>{" "}
                covers what to put in them.
              </>,
            ],
            [
              <strong>Triggers</strong>,
              <>
                The ways work arrives here without anyone typing — a schedule,
                an inbound email, a webhook. See{" "}
                <DocLink slug="triggers-and-channels">
                  Triggers &amp; channels
                </DocLink>
                .
              </>,
            ],
            [
              <strong>Threads</strong>,
              "Everything that has actually happened in the room, plus the work items and canvases those conversations produced.",
            ],
          ]}
        />
        <p>
          Creating one is deliberately small.{" "}
          <strong>Settings → Spaces → New Space</strong> asks for three
          things: a <strong>name</strong>, a <strong>description</strong>, and{" "}
          <strong>access</strong> — Public or Private. There is no agent to
          pick, no model, no tool list. Those come from the Enterprise Agent,
          and the space shapes how they are used afterwards.
        </p>
        <PullQuote who="the mental model to keep">
          A space is not where you configure a different bot. There is one
          agent per tenant; a space supplies local context and an access
          boundary around it.
        </PullQuote>
        <p>
          If what you want is genuinely different <em>behaviour</em> — a
          research specialist, a QA reviewer — that is a sub-agent in the
          agent folder, not a space. See{" "}
          <DocLink slug="subagents-and-templates">
            Sub-agents &amp; templates
          </DocLink>
          .
        </p>
      </ReportSection>

      <ReportSection id="membership" title="Membership and visibility">
        <p>
          Access has exactly two settings, and the difference between them is
          whether a member list exists at all.
        </p>
        <DocTable
          head={["Access", "Who can open it", "Use it when"]}
          rows={[
            [
              <strong>Public</strong>,
              "Every active person in your tenant. No member list is kept.",
              "Broad internal rooms — general support, product questions, company operations.",
            ],
            [
              <strong>Private</strong>,
              "Only people on the space's member list.",
              "Customer rooms, finance and legal work, incident response — anything the whole tenant should not read.",
            ],
          ]}
        />
        <p>
          Creating, renaming and deleting a space is an{" "}
          <strong>operator action</strong>: Settings → Spaces is
          operator-only, and the underlying mutations require a tenant admin.
          Whoever creates a space is recorded as its owner.
        </p>
        <p>
          The member list itself has no screen yet. Adding and removing
          members is currently a server-side operation — the mutations exist
          and are enforced, but no page in the web or mobile app calls them,
          so in practice private spaces get their members through provisioning
          rather than through a Members tab. If you read older docs describing
          one, that tab was never built. Two related rules worth knowing:
          members can only be managed on a private space (the call is rejected
          on a public one), and a space&apos;s owner cannot be removed.
        </p>
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
            archived, membership no longer opens it.
          </li>
        </ul>
        <Invariant title="Private is an access boundary, not a vault">
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
        </Invariant>
      </ReportSection>

      <ReportSection id="organizing-work" title="Organizing work">
        <p>
          Every <Term>thread</Term> belongs to exactly one space — there is no
          such thing as a thread without one. When you start a chat without
          choosing a room, it lands in your tenant&apos;s automatically
          created General space, which the sidebar labels{" "}
          <strong>Chats</strong> rather than showing under a name. That is why
          casual conversations feel like they have no space: they have one, it
          is just not interesting enough to label.
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
            <strong>A different way work arrives.</strong> An inbox, a
            schedule, or a webhook feeding one stream of work.
          </li>
          <li>
            <strong>A board of its own.</strong> Work items and their statuses
            are defined per space, so a team that tracks its own pipeline
            wants its own room.
          </li>
        </ul>
        <p>
          Reuse an existing space when the difference is only the topic.
          Fewer, thicker spaces beat many thin ones: a space earns its keep
          through the context it carries, and a room with no local files, no
          members of its own and no triggers is a label — it costs you a
          navigation step and buys nothing. If you cannot name what the agent
          should know here that it should not know elsewhere, you want a
          thread, not a space.
        </p>
        <p>Once a space exists, it accumulates more than conversation:</p>
        <ul>
          <li>
            <strong>Threads</strong> — the conversations and automated runs
            that happened here, newest first on the space&apos;s home.
          </li>
          <li>
            <strong>Work items</strong> — durable task state owned by the
            space, with statuses the space itself defines. The space home
            shows open-required, blocked and due-soon counts and links to the
            board.
          </li>
          <li>
            <strong>Canvases and artifacts</strong> — a saved artifact belongs
            to the space, not to the thread that first produced it, so it
            survives and stays editable across later conversations. See{" "}
            <DocLink slug="charts-and-artifacts">
              Charts &amp; artifacts
            </DocLink>
            .
          </li>
          <li>
            <strong>Space files</strong> — reachable from the space home
            through the files toggle in the header, and from Settings →
            Spaces.
          </li>
        </ul>
        <p>
          A last thing about the Delete button: it archives, it does not
          erase. Deleting a space sets its status to archived; its threads and
          its workspace files are kept — the room is removed from active use,
          not destroyed. There is no self-service way to hard-delete a
          space&apos;s history.
        </p>
      </ReportSection>
    </ReportArticle>
  );
}
