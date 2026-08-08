/**
 * App tour (Start here) — THINK-695.
 *
 * No screenshots this pass, by decision — so the map is a diagram and the
 * surfaces are described by what they answer, not by what they look like.
 * Everything here is grounded in apps/web/src/routes/_authed/_shell/* and
 * components/settings/settings-nav.tsx; if a route moves, this page moves.
 */
import {
  CalendarClock,
  FileBox,
  ListChecks,
  MessageSquarePlus,
  Settings as SettingsIcon,
  ShieldCheck,
} from "lucide-react";
import {
  Callout,
  DocArticle,
  DocLink,
  FlowChain,
  FlowChip,
  FlowDiagram,
  FlowJoint,
  FlowLane,
  FlowLegend,
  FlowNode,
  Section,
  Term,
} from "../kit";
import type { DocTocEntry } from "../registry";

export const APP_TOUR_TOC: DocTocEntry[] = [
  { id: "the-map", title: "A map of the app" },
  { id: "chrome", title: "The sidebar and the top bar" },
  { id: "work-surfaces", title: "The work surfaces" },
  { id: "settings", title: "Settings and operator surfaces" },
  { id: "shared-idioms", title: "Shared idioms" },
];

export function AppTour() {
  return (
    <DocArticle
      eyebrow="Start here"
      title="App tour"
      lead="A walk through the app in the order you meet it — the work surfaces first, then the settings that configure them. Read this once and the navigation stops being a guess."
    >
      <Section id="the-map" title="A map of the app">
        <p>
          The app is arranged around one arc: you start something, you converse
          about it, you follow through on what came out, and occasionally you go
          and configure how all of that behaves. Every surface sits in one of
          those bands.
        </p>
        <FlowDiagram>
          <FlowLane step="01" label="Start" note="where you land after sign-in">
            <FlowChain>
              <FlowNode
                icon={MessageSquarePlus}
                title="New thread"
                sub="the composer — Space, model, attachments, mentions"
                tone="consumer"
              />
            </FlowChain>
          </FlowLane>

          <FlowJoint label="sending creates a thread" />

          <FlowLane step="02" label="Converse" note="most of your time">
            <FlowChain>
              <FlowNode
                icon={MessageSquarePlus}
                title="Thread & Space"
                sub="the conversation, and the room it belongs to"
                tone="graph"
              >
                <FlowChip>info panel</FlowChip>
                <FlowChip>artifact panel</FlowChip>
                <FlowChip>Space home</FlowChip>
              </FlowNode>
            </FlowChain>
          </FlowLane>

          <FlowJoint label="turns leave things behind" />

          <FlowLane
            step="03"
            label="Follow through"
            note="what the work became"
          >
            {/* Three peers, not a sequence — spaced rather than chained, so
                no arrow implies an order that does not exist. */}
            <div className="mx-auto flex w-full max-w-md flex-col gap-2">
              <FlowNode
                icon={ListChecks}
                title="Work Items"
                sub="status, owner, due date — list or board"
                tone="storage"
              />
              <FlowNode
                icon={FileBox}
                title="Artifacts"
                sub="documents, canvases and applets"
                tone="storage"
              />
              <FlowNode
                icon={ShieldCheck}
                title="Approvals"
                sub="decisions the agent is waiting on"
                tone="storage"
              />
            </div>
          </FlowLane>

          <FlowJoint label="some work should not need you" />

          <FlowLane step="04" label="Delegate" note="standing duties">
            <FlowChain>
              <FlowNode
                icon={CalendarClock}
                title="Automations"
                sub="schedule or webhook triggers, and their run history"
                tone="compute"
              />
            </FlowChain>
          </FlowLane>

          <FlowJoint label="and behind all of it" />

          <FlowLane
            step="05"
            label="Configure"
            note="Profile for you, Settings for the tenant"
          >
            <FlowChain>
              <FlowNode
                icon={SettingsIcon}
                title="Profile & Settings"
                sub="your account and files; your company's agents, Spaces and users"
                tone="source"
              />
            </FlowChain>
          </FlowLane>
        </FlowDiagram>
        <FlowLegend
          items={[
            { tone: "consumer", label: "You, starting work" },
            { tone: "graph", label: "Where the conversation lives" },
            { tone: "storage", label: "What the work produced" },
            { tone: "compute", label: "Work that runs itself" },
            { tone: "source", label: "Configuration" },
          ]}
        />
      </Section>

      <Section id="chrome" title="The sidebar and the top bar">
        <p>
          Two pieces of chrome are on every screen. The <strong>sidebar</strong>{" "}
          on the left is the navigation and your thread history; the{" "}
          <strong>top bar</strong> is thin and belongs to whatever page you are
          on.
        </p>
        <p>The sidebar reads top to bottom as:</p>
        <ul>
          <li>
            <strong>The action group</strong> — New thread, Automations, Work
            Items, and Approvals. Work Items carries a count of items assigned
            to you; Approvals appears only while something is pending, so a
            sidebar without it is not a missing feature.
          </li>
          <li>
            <strong>Your threads</strong> — a <strong>Pinned</strong> section
            you can drag to reorder, then the default Space&apos;s threads, then
            one collapsible group per <Term id="space">Space</Term>. Space
            groups start collapsed. Right-click a thread to rename or mute it;
            each section&apos;s <code>…</code> menu offers show-unread, mark all
            read, and a full thread list.
          </li>
          <li>
            <strong>The settings gear</strong> at the bottom — your name and
            email, Profile, Settings, Documentation (this site), Log out, and
            the deployed release version in small type. That version string is
            the thing to quote when reporting a bug.
          </li>
        </ul>
        <p>
          The top bar is not a fixed toolbar: each page publishes its own
          contents into it — a back arrow, breadcrumbs or an inline-editable
          title, sometimes a tab strip, and the page&apos;s actions on the
          right. The new-thread screen hides it entirely, which is why the app
          looks barer there than anywhere else.
        </p>
        <Callout tone="tip" title="Cmd+K is the fastest thing in the app">
          <p>
            The command palette opens from anywhere. Empty, it lists pinned and
            recent threads. Type, and it offers three escalating rungs:{" "}
            <strong>find</strong> (thread results as you type),{" "}
            <strong>Ask</strong> (a cited answer streamed inline in the
            palette), and <strong>Research this</strong> (a background errand
            that comes back as a thread you can open later). Escalation is
            always a deliberate click — typing never silently spends a turn.
          </p>
        </Callout>
      </Section>

      <Section id="work-surfaces" title="The work surfaces">
        <p>
          Each surface answers one question. Descriptions below are what the
          page actually does, not what its name suggests.
        </p>

        <h3 className="pt-2 text-base font-semibold">New thread</h3>
        <p>
          The composer, and where you land after signing in. Prompt box with{" "}
          <code>@</code> mentions for people and <code>#</code> for agent
          profiles, skill pinning, attachment upload, a Space selector, a model
          selector, and a toggle for whether the agent answers at all. Sending
          creates the thread immediately and routes you into it.
        </p>

        <h3 className="pt-2 text-base font-semibold">A thread</h3>
        <p>
          The conversation and its workbench. The top bar carries breadcrumbs,
          an inline-editable title, and a <code>…</code> menu for pin, rename,
          archive and delete. Two panels slide in from the right: the{" "}
          <strong>info panel</strong> (who started it, agents involved,
          attachments, thread mode and its override, and a goal block with
          completion actions) and the <strong>artifact panel</strong>, which
          appears only once the thread has produced an artifact.
        </p>

        <h3 className="pt-2 text-base font-semibold">A Space</h3>
        <p>
          A Space&apos;s home page is a workroom rather than a settings screen:
          a <strong>New chat</strong> button, three work-item tiles (open
          required, blocked, due soon) with a link into the board filtered to
          that Space, the Space&apos;s recent threads, and its saved canvases. A
          files icon in the top bar swaps the page for an editor over the
          Space&apos;s own context files.
        </p>
        <Callout tone="note" title="There is no Spaces list in the sidebar">
          <p>
            Visiting <code>/spaces</code> sends you to the new-thread screen.
            You reach a Space through its group in the sidebar, through the
            new-thread <code>…</code> menu&apos;s Open Space list, or through a
            thread that lives in it. Creating and administering Spaces is an
            operator job under Settings.
          </p>
        </Callout>

        <h3 className="pt-2 text-base font-semibold">Work Items</h3>
        <p>
          The task surface, in two views chosen from the URL:{" "}
          <strong>list</strong> and <strong>board</strong>. Grouping, sorting,
          visible columns and filters all live in the URL too, so a view you
          arranged is a link you can send. Group by status, priority, owner,
          Space, due state, blocked, required or source. A <strong>Done</strong>{" "}
          toggle hides completed items in list view.
        </p>
        <p>
          A <Term id="work-item">work item</Term>&apos;s detail page is the
          usual two-column shape: description, attached documents and a merged
          comment-and-event activity feed on the left; editable properties on
          the right, plus a &ldquo;resolve blocker&rdquo; card when the item is
          blocked or on human hold.
        </p>

        <h3 className="pt-2 text-base font-semibold">Artifacts</h3>
        <p>
          A searchable table of what the agent produced — name, type, who it was
          for, when, and version. There is no &ldquo;new artifact&rdquo; button
          by design: artifacts come from threads, so the only header action is{" "}
          <strong>New thread</strong>.
        </p>
        <p>
          Opening one renders it by kind — an applet mounts and runs, a document
          renders, a canvas opens with its version history — with share,
          download, delete and a pin toggle in the header.
        </p>

        <h3 className="pt-2 text-base font-semibold">Automations</h3>
        <p>
          A table of standing duties: name (platform ones carry a{" "}
          <strong>Built-in</strong> badge), trigger, target, status and last
          run. Archived ones are filtered out. Detail has two tabs —{" "}
          <strong>Definition</strong> and <strong>Executions</strong> — and the
          header offers Run now, Pause/Resume, Refresh and Archive. There is no
          delete: pausing is the off-switch, and built-ins cannot be removed.
        </p>

        <h3 className="pt-2 text-base font-semibold">Approvals</h3>
        <p>
          A two-pane reading surface, like a mail client: pending decisions on
          the left, the full request on the right with <strong>Approve</strong>{" "}
          and <strong>Deny</strong>. Opening the section selects the newest
          pending item for you, and a link to an already-decided approval
          degrades to that same selection rather than erroring.
        </p>

        <h3 className="pt-2 text-base font-semibold">Profile</h3>
        <p>
          Your own account: name, email, role badge, account usage, and the
          models available to you. A toggle in the top bar swaps it for an
          editor over your <em>personal</em> workspace files — the ones that
          shape how the agent works with you specifically. Role, budget and
          model settings are read-only unless you are an owner or admin.
        </p>
      </Section>

      <Section id="settings" title="Settings and operator surfaces">
        <p>
          Settings has its own sidebar, alphabetised. Three sections are visible
          to everyone; the rest appear only for owners and admins, and if you
          are a member you will simply never see them listed.
        </p>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/20 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Section</th>
                <th className="px-3 py-2 font-medium">Who sees it</th>
                <th className="px-3 py-2 font-medium">What it is for</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60 text-[13px]">
              {SETTINGS_ROWS.map((row) => (
                <tr key={row.section}>
                  <td className="px-3 py-2 font-medium whitespace-nowrap">
                    {row.section}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                    {row.who}
                  </td>
                  <td className="px-3 py-2 text-foreground/80">{row.what}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Callout tone="warn" title="Hidden is not the same as forbidden">
          <p>
            Role checks in the interface only decide what is rendered. Every
            operator action is re-checked on the server, so pasting an operator
            URL as a member gets you redirected, not through. The reverse also
            holds: a section missing from your sidebar means your role, not a
            broken deployment.
          </p>
        </Callout>
      </Section>

      <Section id="shared-idioms" title="Shared idioms">
        <p>
          A handful of patterns repeat everywhere. Learning them once saves
          relearning each surface:
        </p>
        <ul>
          <li>
            <strong>The top bar belongs to the page.</strong> Breadcrumbs on the
            left, tabs in the middle, actions on the right — same geometry on
            every surface, different contents.
          </li>
          <li>
            <strong>
              <code>…</code> menus hold the destructive and the occasional.
            </strong>{" "}
            Rename, archive, delete and mute are behind them rather than on the
            surface; deletions confirm before they act.
          </li>
          <li>
            <strong>Detail opens in a side sheet or a second pane</strong>,
            rather than navigating away — thread info, artifact panels,
            approvals and work-item properties all follow it.
          </li>
          <li>
            <strong>View state lives in the URL.</strong> Filters, grouping,
            tabs and Space scoping are all search params, so any arrangement you
            like is a link you can paste to a colleague.
          </li>
          <li>
            <strong>Badges count things that need you</strong> — assigned work
            items, pending approvals. A badge is an inbox, not a decoration.
          </li>
          <li>
            <strong>Empty states are answers.</strong> &ldquo;No pending
            approvals&rdquo; and a Space with no canvases are both correct
            states, not failures to load.
          </li>
        </ul>
        <p>
          Next: <DocLink slug="spaces">Spaces</DocLink> and{" "}
          <DocLink slug="threads">Threads</DocLink> go deeper on the two
          surfaces you will spend the most time in, and{" "}
          <DocLink slug="mobile-app">Mobile app</DocLink> covers what changes
          when the same work is on a phone.
        </p>
      </Section>
    </DocArticle>
  );
}

const SETTINGS_ROWS = [
  {
    section: "General",
    who: "Everyone",
    what: "Your tenant's basics, plus the color-mode control.",
  },
  {
    section: "Activity",
    who: "Everyone",
    what: "The record of what ran — threads and their traces, by day.",
  },
  {
    section: "Connectors",
    who: "Everyone",
    what: "Your own OAuth connections, the tenant's MCP servers, and data sources.",
  },
  {
    section: "Agents",
    who: "Operators",
    what: "The single agent-configuration surface: the workspace file tree plus config, profiles and extensions.",
  },
  {
    section: "Spaces",
    who: "Operators",
    what: "Creating Spaces, their membership, context and work-item statuses.",
  },
  {
    section: "Users",
    who: "Operators",
    what: "Who is in the tenant, and what role each person holds.",
  },
  {
    section: "Skill Library",
    who: "Operators",
    what: "The tenant's skill catalog, drafts, and what is installed where.",
  },
  {
    section: "Tool Library",
    who: "Operators",
    what: "The built-in and workspace-defined tools available to agents.",
  },
  {
    section: "Workflows",
    who: "Operators",
    what: "Workflow definitions and their runs — automations and routines both live here.",
  },
  {
    section: "Evaluations",
    who: "Operators",
    what: "Test cases, datasets, profiles and run history.",
  },
  {
    section: "Memory",
    who: "Operators",
    what: "How memory and the compounding-memory wiki are configured for the tenant.",
  },
  {
    section: "Artifacts",
    who: "Operators",
    what: "Every artifact in the tenant, plus document plates and share links.",
  },
  {
    section: "Model Catalog",
    who: "Operators",
    what: "Which models are available, and what each one costs.",
  },
];
