/**
 * Getting started (Start here) — THINK-695.
 *
 * End-user first run, deliberately. Nothing about Terraform, stages or
 * deploying: by the time somebody reads this, someone else has already
 * stood the environment up and sent them a link. The operator path lives
 * on the CLI & deployment page.
 *
 * Converted to the report restyle (Eric 2026-08-11), claims re-verified
 * against the shipped code: apps/web/src/routes/sign-in.tsx (the "Log in
 * to ThinkWork" screen, auth options by deployment, the release/stage/
 * region footer), apps/web/src/components/auth/EmailPasswordForm.tsx (the
 * reset and forced-new-password flows), apps/web/src/components/workbench/
 * SpacesWorkbench.tsx + SpacesComposer.tsx (the composer, the no-workspace
 * string, file-only turns titled from the first attachment), packages/api/
 * src/lib/threads/thread-mode.ts + lib/mentions/thread-mention-targets.ts
 * (Agent vs Multiplayer, mention-as-invite), apps/web/src/components/
 * shell/ChatSidebar.tsx + settings/settings-nav.tsx (Approvals only while
 * pending, operator-only sections), and packages/agentcore-pi/
 * agent-container/src/runtime/workspace-skills.ts (the skill roster in
 * the prompt).
 */
import {
  CardGrid,
  DocLink,
  DocTable,
  InfoCard,
  PullQuote,
  ReportArticle,
  ReportSection,
  Stage,
  Stages,
  Term,
} from "../kit";
import { AgentAtWorkDiagram } from "../figures/start-here";
import type { DocTocEntry } from "../registry";

export const GETTING_STARTED_TOC: DocTocEntry[] = [
  { id: "what-it-is", title: "What ThinkWork Agent is" },
  { id: "signing-in", title: "Signing in" },
  { id: "your-first-thread", title: "Your first thread" },
  { id: "what-it-can-do", title: "What the agent can do" },
  { id: "where-things-live", title: "Where things live" },
  { id: "where-to-next", title: "Where to go next" },
];

export function GettingStarted() {
  return (
    <ReportArticle
      eyebrow="Start here"
      title="Getting started"
      lead="ThinkWork Agent gives your company agents that do real work — they hold a conversation, reach into the systems you already use, remember what they learn, and hand back something you can act on. This page is the shortest path from signing in to an agent that has answered for itself."
    >
      <ReportSection id="what-it-is" title="What ThinkWork Agent is">
        <p>
          You talk to an <Term>agent</Term>. It is not a chatbot bolted onto a
          search box: the agent has a{" "}
          <Term id="agent-folder">folder of its own</Term> holding the
          instructions it works from, the <Term id="skill">skills</Term> it has
          been taught, and the <Term id="connector">connectors</Term> that let
          it reach outside systems. Everything you see in the app is one of
          those pieces, or the record of the agent using them.
        </p>
        <p>
          Conversations happen in <Term id="thread">threads</Term>, and threads
          live in <Term id="space">Spaces</Term> — the container that decides
          who can see the work and what the agent can reach while it does it.
          Between turns the agent keeps <Term id="memory">memory</Term>, so the
          second week costs less to explain than the first.
        </p>
        <AgentAtWorkDiagram />
        <p>
          There is nothing to install to start. The web app is the whole product
          for a first session — you need a link and a sign-in, not a laptop
          setup. There is an <DocLink slug="mobile-app">iOS app</DocLink> and a{" "}
          <DocLink slug="slack">Slack integration</DocLink> once you want the
          agent where you already are, and a{" "}
          <DocLink slug="cli-and-deployment">CLI</DocLink> if you are the person
          who runs the environment.
        </p>
      </ReportSection>

      <ReportSection id="signing-in" title="Signing in">
        <p>
          Open the URL you were given and you land on{" "}
          <strong>Log in to ThinkWork</strong>. What the screen offers is
          decided by your deployment rather than by the product, so two
          companies&apos; sign-in pages legitimately look different:
        </p>
        <ul>
          <li>
            <strong>Single sign-on buttons</strong> — <strong>Google</strong> or{" "}
            <strong>Microsoft</strong>. These are the normal path. The button
            hands you to your identity provider and back again; the platform
            never sees a password.
          </li>
          <li>
            <strong>Email and password</strong>, when your deployment enables
            it. This form carries its own <strong>Reset password</strong> flow —
            request a code, enter the code and a new password — and will ask you
            to set a new password if an administrator forced one.
          </li>
        </ul>
        <p>
          The footer of the sign-in card always names the release, environment
          and region you are about to enter. It is the fastest way to confirm
          you are signing into the environment you meant to.
        </p>
        <p>
          After sign-in you land on the <strong>new thread</strong> screen. If
          you see{" "}
          <em>&ldquo;You do not have access to a workspace yet&rdquo;</em>{" "}
          instead, sign-in worked and provisioning has not: your account exists
          but no agent workspace has been assigned to it. That is an operator
          action, not something you can fix from here.
        </p>
        <p>
          One distinction is worth internalising on day one: signing in proves
          who you are, but what you can <em>see</em> is decided separately, by
          Space membership and by your role. Most operator surfaces simply are
          not in your navigation if you are a member rather than an owner or
          admin — so an empty-looking app is far more often a membership gap
          than a broken deployment.
        </p>
      </ReportSection>

      <ReportSection id="your-first-thread" title="Your first thread">
        <p>
          The new-thread screen is a composer and very little else, on purpose.
          Type what you want, press send, and you are in a thread.
        </p>
        <Stages>
          <Stage num="1" title="New thread" tag="the app's front door">
            <p>
              The composer: your message, plus a Space, a model and any
              attachments. Sending creates the thread immediately.
            </p>
          </Stage>
          <Stage num="2" title="The turn runs" tag="you watch it work">
            <p>
              While the turn runs you see the agent work rather than a spinner —
              steps appear as it takes them.
            </p>
          </Stage>
          <Stage num="3" title="The thread is the record">
            <p>
              When it finishes, the thread carries the conversation and anything
              it produced — artifacts, work items. Rename it, pin it, or leave
              it.
            </p>
          </Stage>
          <Stage num="4" title="It waits in the sidebar">
            <p>
              Threads persist. Pick one back up any time; the agent still has
              the context.
            </p>
          </Stage>
        </Stages>
        <p>Four controls on the composer are worth knowing before you send:</p>
        <CardGrid>
          <InfoCard title="The Space selector">
            <p>
              Which <Term id="space">Space</Term> the thread belongs to, which
              decides who else can see it and what context the agent gets. Leave
              it alone for a first try; the default Space is yours.
            </p>
          </InfoCard>
          <InfoCard title="The model selector">
            <p>
              Which model answers. The default is chosen for you and is usually
              right — see <DocLink slug="model-catalog">Model catalog</DocLink>{" "}
              before overriding it.
            </p>
          </InfoCard>
          <InfoCard title="Mentions">
            <p>
              <code>@</code> addresses a <em>person</em> — mentioning a
              colleague adds them to the thread, even a thread inside a Space
              they are not a member of. <code>#</code> addresses an{" "}
              <em>agent profile</em>, which routes the work to that
              profile&apos;s lane. The two sigils are not interchangeable.
            </p>
          </InfoCard>
          <InfoCard title="Attachments">
            <p>
              Files ride along with the message. A file-only message is a valid
              turn — the thread takes its title from the first attachment.
            </p>
          </InfoCard>
        </CardGrid>
        <PullQuote who="the single most common &ldquo;why did it stop replying?&rdquo;">
          A thread with exactly one human in it dispatches every message to the
          agent. The moment a second person joins, the agent only answers when
          it is asked to.
        </PullQuote>
        <p>
          In full: a thread with one human is an <strong>Agent</strong> thread —
          every message you send dispatches to the agent. The moment a second
          person becomes a participant, because you <code>@</code>-mentioned
          them or they were added, the thread becomes{" "}
          <strong>Multiplayer</strong> and the agent answers only when it is
          explicitly mentioned or asked. The thread info panel shows the current
          mode and lets you override it per thread.
        </p>
      </ReportSection>

      <ReportSection id="what-it-can-do" title="What the agent can do">
        <p>
          Capability is per-agent and per-Space rather than global — the honest
          answer to &ldquo;can it do X?&rdquo; is always &ldquo;open a thread
          and ask it&rdquo;. What follows is the shape of the answer, and where
          each capability is configured.
        </p>
        <DocTable
          head={["It can…", "Which means"]}
          rows={CAPABILITY_ROWS.map((row) => [
            <strong key={row.can}>{row.can}</strong>,
            row.means,
          ])}
        />
        <p>
          A shortcut worth knowing: the agent&apos;s own prompt lists its
          installed skills, so &ldquo;what skills do you have?&rdquo; is a
          supported question — and often faster than reading a settings page you
          may not have access to. It can also tell you what it can reach in the
          current turn, by looking at the tools it has been handed.
        </p>
      </ReportSection>

      <ReportSection id="where-things-live" title="Where things live">
        <p>
          The left sidebar is the whole navigation. Each entry answers one
          question:
        </p>
        <DocTable
          head={["Where", "The question it answers"]}
          rows={WHERE_ROWS.map((row) => [
            <strong key={row.where}>{row.where}</strong>,
            row.question,
          ])}
        />
        <p>
          Two entries appear only when they are relevant:{" "}
          <strong>Approvals</strong> is hidden until something is actually
          waiting on you, and the Settings menu shows operator sections only to
          owners and admins. <DocLink slug="app-tour">App tour</DocLink> walks
          every surface in order.
        </p>
      </ReportSection>

      <ReportSection id="where-to-next" title="Where to go next">
        <ul>
          <li>
            <DocLink slug="concepts">Core concepts</DocLink> — the dozen words
            the rest of these docs use. Read this one next; it is short.
          </li>
          <li>
            <DocLink slug="app-tour">App tour</DocLink> — every surface of the
            app, and the idioms they share.
          </li>
          <li>
            <DocLink slug="spaces">Spaces</DocLink> and{" "}
            <DocLink slug="threads">Threads</DocLink> — where the work actually
            happens, in depth.
          </li>
          <li>
            <DocLink slug="agent-folder">The agent folder</DocLink> — what the
            agent is made of, if you are the one shaping it.
          </li>
          <li>
            <DocLink slug="memory">How memory works</DocLink> — what the agent
            keeps between conversations, and what it never keeps.
          </li>
          <li>
            <DocLink slug="connectors-and-mcp">
              Connectors &amp; MCP tools
            </DocLink>{" "}
            — how the agent reaches your systems, and the fence around it.
          </li>
          <li>
            <DocLink slug="automations">Automations &amp; scheduling</DocLink> —
            turning a thing you asked for once into a standing duty.
          </li>
        </ul>
      </ReportSection>
    </ReportArticle>
  );
}

const CAPABILITY_ROWS = [
  {
    can: "Answer from what it knows",
    means:
      "Its own instructions, the Space's context files, and its memory of earlier conversations — no external call needed.",
  },
  {
    can: "Reach your systems",
    means:
      "Through connectors such as Slack, GitHub and Google Workspace, scoped to the operations it has been granted.",
  },
  {
    can: "Follow a taught procedure",
    means:
      "Skills are packaged procedures installed onto an agent — a repeatable job written down once instead of re-explained per thread.",
  },
  {
    can: "Hand back more than text",
    means:
      "Charts inline in the conversation, and artifacts — documents, canvases and small apps — that live on after the thread.",
  },
  {
    can: "Track work",
    means:
      "Work items carry status, owner and due date, and link back to the thread that created them.",
  },
  {
    can: "Run without you",
    means:
      "An automation gives the agent a standing duty on a schedule or a webhook, and it reports back into a thread.",
  },
  {
    can: "Ask permission",
    means:
      "Actions that leave the building — sending an email, for one — can be gated so a human approves before anything is sent.",
  },
];

const WHERE_ROWS = [
  {
    where: "New thread",
    question: "How do I start something? (also the page you land on)",
  },
  {
    where: "The thread list",
    question: "What have I been working on — pinned, recent, by Space?",
  },
  {
    where: "Automations",
    question: "What is the agent doing on its own, and did it run?",
  },
  {
    where: "Work Items",
    question: "What is assigned, blocked, or due?",
  },
  {
    where: "Approvals",
    question: "What is waiting on my decision right now?",
  },
  {
    where: "Artifacts",
    question: "What did the agent produce that outlived its thread?",
  },
  {
    where: "Profile",
    question: "Who am I here, what am I spending, what are my own files?",
  },
  {
    where: "Settings",
    question: "How is all of the above configured? (mostly operator-only)",
  },
];
