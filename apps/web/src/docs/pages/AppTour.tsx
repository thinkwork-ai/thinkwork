/**
 * App tour (Start here) — THINK-695.
 *
 * No screenshots this pass, by decision — so the map is a stage spine and
 * the surfaces are described by what they answer, not by what they look
 * like. Converted to the report restyle (Eric 2026-08-11), claims
 * re-verified against the shipped code: apps/web/src/components/shell/
 * ChatSidebar.tsx + SearchPalette.tsx + SearchAskView.tsx (sidebar
 * structure, Cmd+K rungs), apps/web/src/components/SpacesSidebar.tsx (the
 * settings gear footer), apps/web/src/context/PageHeaderContext.tsx +
 * components/AppTopBar.tsx (the per-page top bar; /new hides it),
 * apps/web/src/components/workbench/{SpacesComposer,SpacesThreadDetailRoute,
 * TaskThreadView,ThreadDetailActions}.tsx (composer, thread page, info and
 * artifact panels), apps/web/src/routes/_authed/_shell/spaces.$spaceId.tsx
 * + spaces.index.tsx (Space home, the /spaces redirect), apps/web/src/
 * components/work-items/* (URL-driven views, group-by set, detail layout),
 * apps/web/src/components/artifacts/* and agent-loops/* and approvals/*
 * (those surfaces), apps/web/src/components/profile/SelfProfilePage.tsx,
 * and apps/web/src/components/settings/settings-nav.tsx + OperatorGuard.tsx
 * (alphabetised nav, role gating).
 *
 * Dropped in that verification: "agents involved" as an info-panel row
 * (the data exists but no row renders it) and "cited" on palette Ask
 * answers (the citations slot is an unwired seam today).
 */
import {
  DocLink,
  DocTable,
  PullQuote,
  ReportArticle,
  ReportSection,
  Stage,
  Stages,
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

/** Surface heading inside a report section — the h3 the kit doesn't style. */
function SurfaceHeading({ children }: { children: string }) {
  return (
    <h3 className="pt-3 font-sans text-[17px] font-semibold tracking-tight">
      {children}
    </h3>
  );
}

export function AppTour() {
  return (
    <ReportArticle
      eyebrow="Start here"
      title="App tour"
      lead="A walk through the app in the order you meet it — the work surfaces first, then the settings that configure them. Read this once and the navigation stops being a guess."
    >
      <ReportSection id="the-map" title="A map of the app">
        <p>
          The app is arranged around one arc: you start something, you converse
          about it, you follow through on what came out, and occasionally you go
          and configure how all of that behaves. Every surface sits in one of
          those bands.
        </p>
        <Stages>
          <Stage num="1" title="Start" tag="where you land after sign-in">
            <p>
              <strong>New thread</strong> — the composer: Space, model,
              attachments, mentions. Sending creates a thread.
            </p>
          </Stage>
          <Stage num="2" title="Converse" tag="most of your time">
            <p>
              <strong>The thread</strong>, and the <strong>Space</strong> it
              belongs to — the conversation itself, an info panel, an artifact
              panel, and the Space&apos;s own home page.
            </p>
          </Stage>
          <Stage num="3" title="Follow through" tag="what the work became">
            <p>
              Three peers, not a sequence: <strong>Work Items</strong> (status,
              owner, due date — list or board), <strong>Artifacts</strong>{" "}
              (documents, canvases and applets), and <strong>Approvals</strong>{" "}
              (decisions the agent is waiting on).
            </p>
          </Stage>
          <Stage num="4" title="Delegate" tag="standing duties">
            <p>
              <strong>Automations</strong> — schedule or webhook triggers, and
              their run history. Some work should not need you.
            </p>
          </Stage>
          <Stage num="5" title="Configure" tag="behind all of it">
            <p>
              <strong>Profile</strong> for you; <strong>Settings</strong> for
              the tenant — your company&apos;s agents, Spaces and users.
            </p>
          </Stage>
        </Stages>
      </ReportSection>

      <ReportSection id="chrome" title="The sidebar and the top bar">
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
        <PullQuote who="the fastest thing in the app">
          Cmd+K opens the command palette from anywhere — and typing in it never
          silently spends a turn.
        </PullQuote>
        <p>
          Empty, the palette lists pinned and recent threads. Type, and it
          offers three escalating rungs: <strong>find</strong> (thread results
          as you type), <strong>Ask</strong> (an answer streamed inline in the
          palette), and <strong>Research this</strong> (a background errand that
          comes back as a thread you can open later). Escalating past find is
          always a deliberate act — a click, or Cmd+Enter.
        </p>
      </ReportSection>

      <ReportSection id="work-surfaces" title="The work surfaces">
        <p>
          Each surface answers one question. Descriptions below are what the
          page actually does, not what its name suggests.
        </p>

        <SurfaceHeading>New thread</SurfaceHeading>
        <p>
          The composer, and where you land after signing in. Prompt box with{" "}
          <code>@</code> mentions for people, <code>#</code> for agent profiles
          and <code>/</code> to pin a skill, attachment upload, a Space
          selector, a model selector, and a toggle for whether the agent answers
          at all. Sending creates the thread immediately and routes you into it.
        </p>

        <SurfaceHeading>A thread</SurfaceHeading>
        <p>
          The conversation and its workbench. The top bar carries breadcrumbs,
          an inline-editable title, and a <code>…</code> menu for pin, rename,
          archive and delete. Two panels slide in from the right: the{" "}
          <strong>info panel</strong> (who started it, attachments, thread mode
          and its override, and a goal block with completion actions) and the{" "}
          <strong>artifact panel</strong>, which appears only once the thread
          has produced an artifact.
        </p>

        <SurfaceHeading>A Space</SurfaceHeading>
        <p>
          A Space&apos;s home page is a workroom rather than a settings screen:
          a <strong>New chat</strong> button, three work-item tiles (open
          required, blocked, due soon) with a link into the board filtered to
          that Space, the Space&apos;s recent threads, and its saved canvases. A
          files icon in the top bar swaps the page for an editor over the
          Space&apos;s own context files.
        </p>
        <p>
          There is no Spaces list in the sidebar — visiting <code>/spaces</code>{" "}
          sends you to the new-thread screen. You reach a Space through its
          group in the sidebar, through the new-thread <code>…</code>{" "}
          menu&apos;s Open Space list, or through a thread that lives in it.
          Creating and administering Spaces is an operator job under Settings.
        </p>

        <SurfaceHeading>Work Items</SurfaceHeading>
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

        <SurfaceHeading>Artifacts</SurfaceHeading>
        <p>
          A searchable table of what the agent produced — name, type, the user
          it was for, when it was generated, and version. There is no &ldquo;new
          artifact&rdquo; button by design: artifacts come from threads, so the
          only header action is <strong>New thread</strong>.
        </p>
        <p>
          Opening one renders it by kind — an applet mounts and runs, a document
          renders, a canvas opens with its version history — with share,
          download, delete and a pin toggle in the header.
        </p>

        <SurfaceHeading>Automations</SurfaceHeading>
        <p>
          A table of standing duties: name (platform ones carry a{" "}
          <strong>Built-in</strong> badge), trigger, target, status and last
          run. Archived ones are filtered out. Detail has two tabs —{" "}
          <strong>Definition</strong> and <strong>Executions</strong> — and the
          header offers Run now, Pause/Resume, Refresh and Archive. There is no
          delete: pausing is the off-switch, and built-ins cannot be removed.
        </p>

        <SurfaceHeading>Approvals</SurfaceHeading>
        <p>
          A two-pane reading surface, like a mail client: pending decisions on
          the left, the full request on the right with <strong>Approve</strong>{" "}
          and <strong>Deny</strong>. Opening the section selects the newest
          pending item for you, and a link to an already-decided approval
          degrades to that same selection rather than erroring.
        </p>

        <SurfaceHeading>Profile</SurfaceHeading>
        <p>
          Your own account: name, email, role badge, account usage, and the
          models available to you. A toggle in the top bar swaps it for an
          editor over your <em>personal</em> workspace files — the ones that
          shape how the agent works with you specifically. Role, budget and
          model settings are read-only unless you are an owner or admin.
        </p>
      </ReportSection>

      <ReportSection id="settings" title="Settings and operator surfaces">
        <p>
          Settings has its own sidebar, alphabetised. Three sections are visible
          to everyone; the rest appear only for owners and admins, and if you
          are a member you will simply never see them listed.
        </p>
        <DocTable
          head={["Section", "Who sees it", "What it is for"]}
          rows={SETTINGS_ROWS.map((row) => [
            <strong key={row.section}>{row.section}</strong>,
            row.who,
            row.what,
          ])}
        />
        <p>
          Hidden is not the same as forbidden, and the reverse holds too. Role
          checks in the interface only decide what is rendered; every operator
          action is re-checked on the server, so pasting an operator URL as a
          member gets you redirected, not through. And a section missing from
          your sidebar means your role, not a broken deployment.
        </p>
      </ReportSection>

      <ReportSection id="shared-idioms" title="Shared idioms">
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
      </ReportSection>
    </ReportArticle>
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
