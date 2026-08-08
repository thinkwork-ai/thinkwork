/**
 * Core concepts (Start here) — THINK-695.
 *
 * THE glossary page: every <Term> anywhere in these docs deep-links to a
 * GlossaryEntry anchor here, so an id on this page is a published contract.
 * Rename one and you break links from other sections — add an alias entry
 * rather than renaming.
 *
 * Vocabulary is sourced from CONCEPTS.md and from the shipped surfaces, not
 * from the older Starlight MDX, which still describes retired designs.
 */
import { Bot, FileBox, MessageSquare, Orbit, Sparkles } from "lucide-react";
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
  FlowLink,
  FlowNode,
  GlossaryEntry,
  Section,
} from "../kit";
import type { DocTocEntry } from "../registry";

export const CONCEPTS_TOC: DocTocEntry[] = [
  { id: "how-the-pieces-fit", title: "How the pieces fit" },
  { id: "agents", title: "Agents and what they carry" },
  { id: "spaces-and-threads", title: "Spaces, threads and output" },
  { id: "memory-terms", title: "Memory" },
  { id: "standing-work", title: "Standing work and quality" },
  { id: "naming-notes", title: "Naming notes" },
];

export function Concepts() {
  return (
    <DocArticle
      eyebrow="Start here"
      title="Core concepts"
      lead="Every other page in these docs leans on the same handful of words. This page defines them once, in the order they build on each other — an agent is made of things, it works inside a Space, and it leaves something behind."
    >
      <Section id="how-the-pieces-fit" title="How the pieces fit">
        <p>
          Two sentences carry the whole model.{" "}
          <strong>
            An agent is a folder of files — instructions, skills, connectors and
            sub-agents — and that folder is what the runtime loads.
          </strong>{" "}
          <strong>
            The work happens in a Space, one thread at a time, and each thread
            can leave behind artifacts, work items and memory.
          </strong>
        </p>
        <FlowDiagram>
          <FlowLane
            step="01"
            label="What an agent is"
            note="files, all the way down"
          >
            <FlowChain>
              <FlowNode
                icon={Bot}
                title="The agent"
                sub="one folder, one set of instructions"
                tone="compute"
              >
                <FlowChip>INSTRUCTIONS.md</FlowChip>
              </FlowNode>
              <FlowLink label="holds" />
              <FlowNode
                icon={Sparkles}
                title="Its capabilities"
                sub="what it can do, reach, and delegate to"
                tone="source"
              >
                <FlowChip>skills/</FlowChip>
                <FlowChip>connectors/</FlowChip>
                <FlowChip>agents/</FlowChip>
              </FlowNode>
            </FlowChain>
          </FlowLane>

          <FlowJoint label="the agent works inside a Space" />

          <FlowLane
            step="02"
            label="Where the work happens"
            note="and what it leaves"
          >
            <FlowChain>
              <FlowNode
                icon={Orbit}
                title="A Space"
                sub="membership, context, and limits"
                tone="graph"
              />
              <FlowLink label="contains" />
              <FlowNode
                icon={MessageSquare}
                title="A thread"
                sub="one conversation, one durable record"
                tone="consumer"
              />
              <FlowLink label="produces" />
              <FlowNode
                icon={FileBox}
                title="What outlives it"
                sub="artifacts, work items, memory"
                tone="storage"
              >
                <FlowChip>artifacts</FlowChip>
                <FlowChip>work items</FlowChip>
                <FlowChip>memory</FlowChip>
              </FlowNode>
            </FlowChain>
          </FlowLane>
        </FlowDiagram>
        <FlowLegend
          items={[
            { tone: "compute", label: "The agent" },
            { tone: "source", label: "What it can reach" },
            { tone: "graph", label: "Where work lives" },
            { tone: "consumer", label: "People talking" },
            { tone: "storage", label: "What persists" },
          ]}
        />
      </Section>

      <Section id="agents" title="Agents and what they carry">
        <div className="space-y-8">
          <GlossaryEntry
            id="agent"
            term="Agent"
            example={
              <>
                The agent you meet on the new-thread screen is your{" "}
                <strong>Enterprise Agent</strong> — your company runs one, and
                Spaces, skills and sub-agents shape it for each job.
              </>
            }
            seeAlso={[
              { id: "agent-folder", label: "Agent folder" },
              { id: "sub-agent", label: "Sub-agent" },
              { id: "space", label: "Space" },
            ]}
          >
            <p>
              The thing you talk to. An agent is a named worker with its own
              folder of instructions, skills and connectors; every thread is a
              conversation with one. One agent serves many people and many
              Spaces at once, and what it can do in any given turn depends on
              who asked and where.
            </p>
          </GlossaryEntry>

          <GlossaryEntry
            id="agent-folder"
            term="Agent folder (the workspace)"
            example={
              <>
                <code>INSTRUCTIONS.md</code> beside{" "}
                <code>skills/expense-report/</code>,{" "}
                <code>connectors/slack/</code> and{" "}
                <code>agents/researcher/</code>.
              </>
            }
            seeAlso={[
              { id: "skill", label: "Skill" },
              { id: "connector", label: "Connector" },
              { id: "sub-agent", label: "Sub-agent" },
            ]}
          >
            <p>
              Everything an agent is, expressed as files.{" "}
              <code>INSTRUCTIONS.md</code> holds the prose it works from;{" "}
              <code>skills/</code>, <code>connectors/</code> and{" "}
              <code>agents/</code> hold what it can do, what it can reach, and
              what it can hand off to. The shape is recursive — a sub-agent is
              the same folder one level down — and it is what the runtime
              actually loads, so editing the folder is how you change behavior.
            </p>
            <p>
              &ldquo;Workspace&rdquo; is the everyday word for the same thing.
              Note it is <em>not</em> a <a href="#space">Space</a>: the
              workspace is what the agent is, the Space is where it works.
            </p>
          </GlossaryEntry>

          <GlossaryEntry
            id="skill"
            term="Skill"
            example={
              <>
                A &ldquo;monthly close checklist&rdquo; skill: the steps, the
                format of the output, and the systems to check — written down
                once instead of re-explained every month.
              </>
            }
            seeAlso={[
              { id: "agent-folder", label: "Agent folder" },
              { id: "connector", label: "Connector" },
            ]}
          >
            <p>
              A packaged procedure an agent can follow — a repeatable job
              written down. Skills are published into a per-tenant catalog
              through a trust pipeline (publish, scan, sign), then{" "}
              <em>installed</em> onto an agent, which copies the files into that
              agent&apos;s own folder.
            </p>
            <p>
              The copy matters: the runtime reads the installed copy and never
              the catalog, so republishing a skill changes nothing for an agent
              that already has it until the skill is explicitly reinstalled.
            </p>
          </GlossaryEntry>

          <GlossaryEntry
            id="connector"
            term="Connector"
            example={
              <>
                A GitHub connector granted only read operations: the agent can
                summarize a pull request and cannot merge one.
              </>
            }
            seeAlso={[
              { id: "skill", label: "Skill" },
              { id: "approval", label: "Approval" },
            ]}
          >
            <p>
              An external system the agent can reach — Slack, GitHub, Google
              Workspace, a database. A connector is declared as a folder in the
              agent&apos;s workspace, but declaring it is not switching it on:
              it activates only through platform-signed state that also fixes
              which operations are permitted.
            </p>
            <p>
              Credentials are referenced, never written into the definition, and
              some connectors are wired per person rather than per company — so
              two colleagues in the same Space can genuinely have different
              reach.
            </p>
          </GlossaryEntry>

          <GlossaryEntry
            id="sub-agent"
            term="Sub-agent"
            example={
              <>
                A <code>researcher</code> sub-agent granted the web connector
                and nothing else, so long lookups never occupy the main thread.
              </>
            }
            seeAlso={[
              { id: "agent-folder", label: "Agent folder" },
              { id: "agent-profile", label: "Agent profile" },
            ]}
          >
            <p>
              A narrower agent living inside another agent&apos;s folder, at{" "}
              <code>agents/&lt;slug&gt;/</code>. It has the same shape as its
              parent and a required <code>description</code>, which is passed
              verbatim as the description of the tool that delegates to it.
            </p>
            <p>
              A sub-agent gets capabilities by <em>presence</em> — a connector
              or skill folder inside it — and those grants can only narrow what
              the parent already holds. Nothing is copied down, so revoking a
              capability at the parent withers every child grant with no child
              edit.
            </p>
          </GlossaryEntry>

          <GlossaryEntry
            id="agent-profile"
            term="Agent profile"
            example={
              <>
                <code>#analyst</code> in the composer routes the message to the
                analyst profile&apos;s lane.
              </>
            }
            seeAlso={[
              { id: "sub-agent", label: "Sub-agent" },
              { id: "evaluation", label: "Evaluation" },
            ]}
          >
            <p>
              A named configuration of the agent for a role — its model and
              prompt presets — that you can address directly. In a composer,{" "}
              <code>#</code> mentions a profile and <code>@</code> mentions a
              person; the two are not interchangeable, and a name that matches
              both resolves <code>@</code> to the person.
            </p>
          </GlossaryEntry>
        </div>
      </Section>

      <Section id="spaces-and-threads" title="Spaces, threads and output">
        <div className="space-y-8">
          <GlossaryEntry
            id="space"
            term="Space"
            example={
              <>
                A &ldquo;Customer onboarding&rdquo; Space: its own context
                files, its own work-item statuses, and only the people running
                onboarding in it.
              </>
            }
            seeAlso={[
              { id: "thread", label: "Thread" },
              { id: "work-item", label: "Work item" },
              { id: "agent-folder", label: "Agent folder" },
            ]}
          >
            <p>
              The container work happens in. A Space holds threads, work items
              and canvases, carries its own context files, and its membership
              decides who can see any of that.
            </p>
            <p>
              A Space also <em>shapes</em> the agent without granting it new
              reach: it can add context and skills and can restrict what the
              agent may do inside it. That asymmetry is the point — a Space can
              confine an agent, never widen it.
            </p>
          </GlossaryEntry>

          <GlossaryEntry
            id="thread"
            term="Thread"
            example={
              <>
                &ldquo;Draft the Q3 board update&rdquo; — one thread, four
                turns, one document artifact, still in your sidebar next
                quarter.
              </>
            }
            seeAlso={[
              { id: "space", label: "Space" },
              { id: "artifact", label: "Artifact" },
            ]}
          >
            <p>
              One conversation, and the durable record of it. Threads belong to
              a Space; they can be pinned, renamed, archived or deleted, and
              they carry everything a turn produced — attachments, artifacts,
              linked work items.
            </p>
            <p>
              A thread with a single human is an <strong>Agent</strong> thread
              and every message dispatches automatically. A second participant
              makes it <strong>Multiplayer</strong>, and the agent then answers
              only when mentioned. Mentioning someone in a thread grants them
              access to that one thread — not to its Space.
            </p>
          </GlossaryEntry>

          <GlossaryEntry
            id="work-item"
            term="Work item"
            example={
              <>
                &ldquo;Collect the signed MSA&rdquo; — owned, due Friday,
                blocked on the customer, linked to the thread where it came up.
              </>
            }
            seeAlso={[
              { id: "space", label: "Space" },
              { id: "thread", label: "Thread" },
            ]}
          >
            <p>
              The unit of durable work. A work item belongs to a Space and
              carries status, priority, owner, due date, labels and its own
              activity log; it can link to the thread it came from.
            </p>
            <p>
              Threads are the collaboration record, work items are the source of
              truth for task state. Statuses are defined per Space, so two
              Spaces can run genuinely different workflows — cross-Space views
              fall back to normalized categories (to do, active, blocked, done,
              skipped) rather than flattening them into a fiction.
            </p>
          </GlossaryEntry>

          <GlossaryEntry
            id="artifact"
            term="Artifact"
            example={
              <>
                A weekly report document that a scheduled automation revises in
                place, keeping each prior week as a snapshot.
              </>
            }
            seeAlso={[
              { id: "thread", label: "Thread" },
              { id: "automation", label: "Automation" },
            ]}
          >
            <p>
              Something the agent produced that outlives its thread. Three kinds
              you will meet: <strong>documents</strong> (a markdown record plus
              a self-contained HTML render), <strong>canvases</strong> (living
              and editable across threads, versioned by snapshot), and{" "}
              <strong>applets</strong> (a small generated app).
            </p>
            <p>
              Artifacts belong to a Space rather than to the thread that
              produced them, keep a version history, and can be downloaded or
              shared — documents can also get a revocable public link.
            </p>
          </GlossaryEntry>
        </div>
      </Section>

      <Section id="memory-terms" title="Memory">
        <div className="space-y-8">
          <GlossaryEntry
            id="memory"
            term="Memory"
            example={
              <>
                You explain your reporting cadence once in March; in June the
                agent still formats to it without being reminded.
              </>
            }
            seeAlso={[
              { id: "compounding-memory", label: "Compounding memory" },
              { id: "thread", label: "Thread" },
            ]}
          >
            <p>
              What the agent carries between conversations. Memory is managed by
              Bedrock AgentCore — the only engine — and is scoped{" "}
              <strong>per requester</strong>: what you tell the agent lands
              against you, not against the whole company.
            </p>
            <p>
              A recurring nightly pass consolidates what accumulated, collapsing
              repeats and dropping stale notes, and rewrites the agent&apos;s
              own memory files. Memory is therefore a moving summary of what
              matters, not a transcript archive.
            </p>
          </GlossaryEntry>

          <GlossaryEntry
            id="compounding-memory"
            term="Compounding memory (the wiki)"
            example={
              <>
                An Entity page for a customer, assembled from a dozen threads
                nobody would think to re-read.
              </>
            }
            seeAlso={[{ id: "memory", label: "Memory" }]}
          >
            <p>
              The browsable layer above raw memory: scattered memories distilled
              into <strong>Entity</strong>, <strong>Topic</strong> and{" "}
              <strong>Decision</strong> pages, consolidated at the company level
              rather than per person.
            </p>
            <p>
              The agent reads it first and drills into raw recall only when it
              needs detail. Pages are earned mechanically — an entity is
              promoted when it crosses evidence thresholds such as being
              mentioned across enough distinct threads — so the absence of a
              page means &ldquo;not yet established&rdquo;, not
              &ldquo;unknown&rdquo;.
            </p>
          </GlossaryEntry>
        </div>
      </Section>

      <Section id="standing-work" title="Standing work and quality">
        <div className="space-y-8">
          <GlossaryEntry
            id="automation"
            term="Automation"
            example={
              <>
                &ldquo;Email me the pipeline summary each weekday at 9am&rdquo;
                — a schedule trigger, one agent step, one maintained document.
              </>
            }
            seeAlso={[
              { id: "artifact", label: "Artifact" },
              { id: "approval", label: "Approval" },
            ]}
          >
            <p>
              A standing duty: work that starts without anyone typing. Under the
              hood an automation is a workflow with a trigger — a schedule or a
              webhook — and the Automations surface lists each one with its
              trigger, its target and its last run.
            </p>
            <p>
              Pausing is the supported off-switch; platform built-ins can be
              paused but not deleted or hand-edited. An automation can be bound
              to one living document so a recurring report revises the same
              artifact instead of forking a new one each week.
            </p>
          </GlossaryEntry>

          <GlossaryEntry
            id="approval"
            term="Approval"
            example={
              <>
                The agent drafts an outbound email and stops; you read it in
                Approvals and press <strong>Approve &amp; send</strong> or{" "}
                <strong>Deny</strong>.
              </>
            }
            seeAlso={[
              { id: "connector", label: "Connector" },
              { id: "automation", label: "Automation" },
            ]}
          >
            <p>
              A pause the agent takes before an action a human should authorize.
              The gated action is still available to the agent — calling it
              checkpoints the turn and surfaces a card instead of executing.
            </p>
            <p>
              Approving resumes the turn exactly where it stopped; denying
              returns the refusal to the agent as the result of that call, so it
              can carry on sensibly rather than crashing. The sidebar shows
              Approvals only while something is pending.
            </p>
          </GlossaryEntry>

          <GlossaryEntry
            id="evaluation"
            term="Evaluation"
            example={
              <>
                A flagged production thread becomes a case: &ldquo;here is what
                should have happened&rdquo;, replayed against today&apos;s agent
                and scored.
              </>
            }
            seeAlso={[
              { id: "agent-profile", label: "Agent profile" },
              { id: "skill", label: "Skill" },
            ]}
          >
            <p>
              A stored question with a checkable expectation, run against the
              real agent and scored. Cases collect into per-tenant datasets;
              runs execute against a pinned profile so two runs are comparable
              exactly when they share dataset version, scoring version and
              judge.
            </p>
            <p>
              Every result is exactly one of <strong>pass</strong>,{" "}
              <strong>fail</strong> or <strong>error</strong> — error being
              infrastructure trouble (a timeout, a throttle), reported as run
              health and excluded from the pass rate rather than counted against
              the agent.
            </p>
          </GlossaryEntry>
        </div>
      </Section>

      <Section id="naming-notes" title="Naming notes">
        <p>
          A few places where the product, the docs and the interface use
          different words for one thing — worth knowing so you do not go looking
          for a second feature that does not exist.
        </p>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/20 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">You may see</th>
                <th className="px-3 py-2 font-medium">Read it as</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60 text-[13px]">
              {NAMING_ROWS.map((row) => (
                <tr key={row.seen}>
                  <td className="px-3 py-2 font-medium whitespace-nowrap">
                    {row.seen}
                  </td>
                  <td className="px-3 py-2 text-foreground/80">{row.means}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Callout tone="note" title="Terms link back here">
          <p>
            A dotted underline anywhere in these docs jumps to its definition on
            this page. If you arrived by clicking one, the entry you wanted is
            the heading just above the fold.{" "}
            <DocLink slug="app-tour">App tour</DocLink> is the next page if you
            would rather see where all of this appears in the interface.
          </p>
        </Callout>
      </Section>
    </DocArticle>
  );
}

const NAMING_ROWS = [
  {
    seen: "Workflow",
    means:
      "The platform noun behind an automation. An automation is a workflow that has a trigger; there is no separate workflow feature to learn.",
  },
  {
    seen: "Connection",
    means:
      "The former name for a connector. Older labels and file paths may still say connections; it is the same thing.",
  },
  {
    seen: "Task",
    means:
      "The interface sometimes says task where the platform noun is work item. One concept, two labels.",
  },
  {
    seen: "Workspace",
    means:
      "The agent's own folder of files — not a Space. If someone says 'edit the workspace', they mean the agent's instructions and capabilities.",
  },
  {
    seen: "Brain, wiki",
    means:
      "Both names for compounding memory — the Entity, Topic and Decision pages distilled from raw memory.",
  },
  {
    seen: "Canvas",
    means:
      "One kind of artifact — a living, editable document surface — rather than a separate feature alongside artifacts.",
  },
  {
    seen: "Profile",
    means:
      "Ambiguous on its own. Your profile is your own account page; an agent profile is a named agent configuration you address with #.",
  },
];
