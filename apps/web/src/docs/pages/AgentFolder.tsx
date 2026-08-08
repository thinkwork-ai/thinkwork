/**
 * The agent folder (Agents) — THINK-696.
 *
 * The load-bearing page of the section: everything else in Agents is a
 * consequence of "the folder is the agent". Verified against
 * CONCEPTS.md (Agent Folder / Grants-by-Presence / Eve Deviations),
 * packages/api/src/lib/agent-folder-format.ts (the strict frontmatter
 * grammar), workspace-lanes.ts (which paths an agent may write) and
 * capabilities/manifest-compile.ts (what admission actually rejects).
 */
import { Callout, DocArticle, DocLink, Section, Term } from "../kit";
import {
  AgentFolderTreeDiagram,
  GrantsByPresenceDiagram,
} from "../figures/agents";
import type { DocTocEntry } from "../registry";

export const AGENT_FOLDER_TOC: DocTocEntry[] = [
  { id: "anatomy", title: "Anatomy of the folder" },
  { id: "instructions", title: "INSTRUCTIONS.md" },
  { id: "root-only", title: "The root-only files" },
  { id: "grants-by-presence", title: "Grants by presence" },
  { id: "who-can-write", title: "Who is allowed to write what" },
];

export function AgentFolder() {
  return (
    <DocArticle
      eyebrow="Agents"
      title="The agent folder"
      lead="An agent is a folder. The same four things appear at every level of it, which is what makes agents compose instead of merely nest."
    >
      <Section id="anatomy" title="Anatomy of the folder">
        <p>
          Everything an agent is — how it behaves, what it can reach, who it can
          hand work to — is files in one folder in S3, at{" "}
          <code>tenants/&lt;tenant&gt;/agents/&lt;agent&gt;/</code>. There is no
          second place where behavior is configured and no hidden state the
          folder does not show you. Read the folder and you have read the agent.
        </p>
        <p>Four things make up the shape:</p>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/20 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Slot</th>
                <th className="px-3 py-2 font-medium">Holds</th>
                <th className="px-3 py-2 font-medium">Means</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60 text-[13px] [&_td]:px-3 [&_td]:py-2">
              <tr>
                <td className="font-medium whitespace-nowrap">
                  <code>INSTRUCTIONS.md</code>
                </td>
                <td className="text-foreground/80">
                  YAML frontmatter above a prose body
                </td>
                <td className="text-foreground/80">
                  Who this agent is and how it works
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">
                  <code>skills/</code>
                </td>
                <td className="text-foreground/80">
                  <code>&lt;slug&gt;/SKILL.md</code> per installed skill
                </td>
                <td className="text-foreground/80">
                  Procedures it knows how to run
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">
                  <code>connectors/</code>
                </td>
                <td className="text-foreground/80">
                  <code>&lt;slug&gt;/CONNECTION.md</code> plus a signed sidecar
                </td>
                <td className="text-foreground/80">
                  External systems it can reach
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">
                  <code>agents/</code>
                </td>
                <td className="text-foreground/80">
                  <code>&lt;slug&gt;/</code>, each the same shape again
                </td>
                <td className="text-foreground/80">
                  Narrower agents it can delegate to
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <AgentFolderTreeDiagram />
        <p>
          A sub-agent folder is not a different format with fewer fields — it is
          the same anatomy one level down. That is the whole reason the model is
          worth learning once: what you know about the root folder is what you
          know about every folder inside it.
        </p>
        <Callout tone="note" title="The recursion stops at one level">
          <p>
            Sub-agents cannot have sub-agents. An <code>agents/</code> folder
            found inside a sub-agent folder is rejected when the capabilities
            manifest compiles, with the reason <code>nested_agent_folder</code>.
            This is structural, not a configurable depth limit — there is no
            counter to raise. Delegation trees stay one hop deep on purpose, so
            a run always has an identifiable owner.
          </p>
        </Callout>
        <Callout tone="warn" title="connections/ is now connectors/">
          <p>
            The folder was renamed. Readers accept both spellings during the
            migration window and old paths mentioned in memories or transcripts
            are covered by a tombstone file, but <code>connectors/</code> is the
            name to write. The <code>connections</code> database table was
            deliberately <em>not</em> renamed — it holds per-user OAuth rows and
            is a different concept that happened to share a word.
          </p>
        </Callout>
      </Section>

      <Section id="instructions" title="INSTRUCTIONS.md">
        <p>
          <code>INSTRUCTIONS.md</code> is one file doing two jobs. Above the{" "}
          <code>---</code> fence, YAML frontmatter carries typed configuration.
          Below it, the body is instructions — plain prose, verbatim, with no
          synthetic headings and no machine sections mixed in. Root instructions
          used to live in <code>AGENTS.md</code>; that filename is still read
          during the migration window, but new work writes{" "}
          <code>INSTRUCTIONS.md</code>.
        </p>
        <p>
          The frontmatter grammar is strict from day one. These are the only
          keys it accepts:
        </p>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/20 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Key</th>
                <th className="px-3 py-2 font-medium">Required</th>
                <th className="px-3 py-2 font-medium">What it does</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60 text-[13px] [&_td]:px-3 [&_td]:py-2">
              <tr>
                <td className="font-medium whitespace-nowrap">
                  <code>description</code>
                </td>
                <td className="text-foreground/80">Yes</td>
                <td className="text-foreground/80">
                  One line saying when to use this agent. On a sub-agent it is
                  passed verbatim as the delegation tool&apos;s description —
                  the parent model reads this string and nothing else when
                  deciding whether to hand work over.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">
                  <code>model</code>
                </td>
                <td className="text-foreground/80">No</td>
                <td className="text-foreground/80">
                  Pin a model. Absent means inherit the platform or parent
                  default at compile time.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">
                  <code>enabled</code>
                </td>
                <td className="text-foreground/80">No</td>
                <td className="text-foreground/80">
                  <code>false</code> keeps the folder but takes the agent out of
                  service.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">
                  <code>builtInTools</code>
                </td>
                <td className="text-foreground/80">No</td>
                <td className="text-foreground/80">
                  Which platform built-ins this agent may use. Configuration,
                  not a grant — built-ins are ambient and this narrows them.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">
                  <code>execution</code>
                </td>
                <td className="text-foreground/80">No</td>
                <td className="text-foreground/80">
                  Runtime limits: <code>maxRuntimeMs</code>,{" "}
                  <code>maxTokens</code>, <code>costBudgetUsd</code>,{" "}
                  <code>clarify</code>, <code>reviewGate</code> and the loop
                  policy.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">
                  <code>approval</code>
                </td>
                <td className="text-foreground/80">No</td>
                <td className="text-foreground/80">
                  <code>never</code>, <code>once</code> or <code>always</code> —
                  whether invoking this needs a human to say yes. See{" "}
                  <DocLink slug="approvals-and-guardrails">
                    approvals and guardrails
                  </DocLink>
                  .
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">
                  <code>operations</code>
                </td>
                <td className="text-foreground/80">No</td>
                <td className="text-foreground/80">
                  The allowed operation list. Absent means unrestricted.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <Callout tone="warn" title="Unknown keys are errors, not warnings">
          <p>
            There are no field aliases and no silent tolerance. A misspelled
            key, a snake_case variant of an <code>execution</code> field, or a
            leftover <code>skills:</code> / <code>mcpServers:</code> list all
            fail validation and the agent lands in the manifest as{" "}
            <code>withheld</code> with reason <code>invalid_definition</code>.
            Writing <code>instructions:</code> in the frontmatter is called out
            by name: instructions are the body of the file, never a field.
          </p>
          <p>
            This is deliberate. A tolerant parser that guesses what you meant is
            how two agents end up behaving differently for reasons nobody can
            find in the file.
          </p>
        </Callout>
      </Section>

      <Section id="root-only" title="The root-only files">
        <p>
          The four recursive slots are the shape. The root folder additionally
          holds files that only make sense once, at the top:
        </p>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/20 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">File</th>
                <th className="px-3 py-2 font-medium">Class</th>
                <th className="px-3 py-2 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60 text-[13px] [&_td]:px-3 [&_td]:py-2">
              <tr>
                <td className="font-medium whitespace-nowrap">
                  <code>CONTEXT.md</code>
                </td>
                <td className="text-foreground/80">live</td>
                <td className="text-foreground/80">
                  Operating context and the generated routing section.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">
                  <code>GUARDRAILS.md</code>
                </td>
                <td className="text-foreground/80">pinned</td>
                <td className="text-foreground/80">
                  Policy baseline. Pinned by content hash — see{" "}
                  <DocLink slug="workspace-composition">composition</DocLink>.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">
                  <code>USER.md</code>
                </td>
                <td className="text-foreground/80">managed</td>
                <td className="text-foreground/80">
                  Rendered from the paired human&apos;s profile rows. Edit the
                  profile, not the file.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">
                  <code>SPACE.md</code>
                </td>
                <td className="text-foreground/80">live</td>
                <td className="text-foreground/80">
                  Context for the active <Term>space</Term> at turn time.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">
                  <code>MEMORY_GUIDE.md</code>
                </td>
                <td className="text-foreground/80">live</td>
                <td className="text-foreground/80">
                  How this agent should use memory tools and notes.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">
                  <code>TOOLS.md</code>, <code>ROUTER.md</code>
                </td>
                <td className="text-foreground/80">live</td>
                <td className="text-foreground/80">
                  Tool-surface guidance and channel routing guidance.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">
                  <code>mcp.json</code>
                </td>
                <td className="text-foreground/80">config</td>
                <td className="text-foreground/80">
                  MCP server configuration metadata.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">
                  <code>memory/*.md</code>
                </td>
                <td className="text-foreground/80">writable</td>
                <td className="text-foreground/80">
                  <code>lessons.md</code>, <code>preferences.md</code>,{" "}
                  <code>contacts.md</code> — the three notes the agent may write
                  itself.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">
                  <code>manifest.json</code>
                </td>
                <td className="text-foreground/80">generated</td>
                <td className="text-foreground/80">
                  Path, size and ETag per file. The runtime diffs it to decide
                  what to re-sync.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          Retired filenames you may still see referenced in old material —{" "}
          <code>SOUL.md</code>, <code>IDENTITY.md</code>,{" "}
          <code>PLATFORM.md</code>, <code>CAPABILITIES.md</code> — carry nothing
          any more. Do not author them.
        </p>
      </Section>

      <Section id="grants-by-presence" title="Grants by presence">
        <p>
          A sub-agent gets a capability because a folder for it exists inside
          the sub-agent&apos;s folder. Not because a name appears in a list —
          the format rejects those lists outright.
        </p>
        <GrantsByPresenceDiagram />
        <p>The rule has three parts, and each one buys something:</p>
        <ul>
          <li>
            <strong>The child folder holds no definition.</strong> A connector
            grant at <code>agents/&lt;slug&gt;/connectors/&lt;conn&gt;/</code>{" "}
            contains only a platform-signed <code>.assignment.json</code>. The
            definition and the credential reference stay at the root. Nothing
            copies down, so nothing can drift.
          </li>
          <li>
            <strong>Narrowing is checked when it compiles.</strong> The
            child&apos;s <code>permissions.operations</code> must be a subset of
            the root&apos;s effective operation set. Ask for more and the grant
            is withheld with <code>operation_not_permitted</code>, naming the
            operations that exceeded the root.
          </li>
          <li>
            <strong>Revocation cascades for free.</strong> Remove or disable the
            root connector and every child grant withers, with no edit to any
            child folder. A skill grant whose root install is gone shows up as{" "}
            <code>missing_skill</code> at compile — a visible absence in the
            manifest, rather than a tool that explodes mid-run.
          </li>
        </ul>
        <Callout tone="warn" title="Presence declares; a signature activates">
          <p>
            The folder announces the grant. It does not turn it on. Every grant
            folder carries a platform-signed sidecar, and a folder whose sidecar
            is missing, unsigned, or fails verification is compiled into the{" "}
            <code>withheld</code> section with reason <code>unsigned</code> —
            visible in the manifest, invisible to the model. So dropping a
            folder into the tree by hand grants nothing; the platform has to
            sign it.
          </p>
        </Callout>
        <p>
          This is a deliberate departure from the copy-everything approach other
          folder-agent systems take, where a sub-agent receives its own copies
          of the definitions it needs. Copies mean drift, and drift means a
          revocation that misses one of them. Single-point revocation was worth
          the deviation.
        </p>
      </Section>

      <Section id="who-can-write" title="Who is allowed to write what">
        <p>
          Files in the folder do not all have the same author. Three lanes write
          here, and they do not overlap:
        </p>
        <ul>
          <li>
            <strong>You, through the app.</strong> The Agent page at{" "}
            <strong>Settings → Agent</strong> edits the workspace tree directly
            — instructions, context, guardrails, skills. Operator edits are
            re-signed automatically.
          </li>
          <li>
            <strong>The platform.</strong> <code>USER.md</code> is rewritten
            whenever the paired human&apos;s profile changes;{" "}
            <code>manifest.json</code> and the generated sections of{" "}
            <code>CONTEXT.md</code> are regenerated on every write.
          </li>
          <li>
            <strong>The agent itself.</strong> Strictly bounded: the three{" "}
            <code>memory/</code> notes, its own instruction and context prose,
            and installed skill files. It cannot write into <code>agents/</code>
            , <code>connectors/</code> or <code>tools/</code> through the
            ordinary file lane at all.
          </li>
        </ul>
        <Callout tone="note" title="Why the agent cannot touch agents/">
          <p>
            The sidecar on a sub-agent folder is optional, and a missing sidecar
            means enabled and operator-authored. If the agent could write there,
            it could mint a live sub-agent that looks like you created it. So
            capability folders have exactly one write channel — the gated
            capability-folder dispatch — and an agent-lane write to those paths
            is rejected outright.
          </p>
        </Callout>
        <p>
          Whatever the lane, edits are compiled state. A change lands at the
          next capabilities compile and workspace sync, never mid-thread — see{" "}
          <DocLink slug="subagents-and-templates">
            sub-agents and templates
          </DocLink>{" "}
          for what that means for a run already in flight.
        </p>
      </Section>
    </DocArticle>
  );
}
