/**
 * The agent folder (Agents) — THINK-696.
 *
 * The load-bearing page of the section: everything else in Agents is a
 * consequence of "the folder is the agent". Verified against
 * CONCEPTS.md (Agent Folder / Grants-by-Presence / Eve Deviations),
 * packages/api/src/lib/agent-folder-format.ts (the strict frontmatter
 * grammar — ALLOWED_KEYS and ALLOWED_EXECUTION_KEYS), workspace-lanes.ts
 * (isAgentSourcePath: which paths the agent lane may write; agents/,
 * connections/ and tools/ deliberately absent), workspace-manifest.ts
 * (per-file ETag re-sync) and capabilities/manifest-compile.ts (the
 * withheld reasons: unsigned, invalid_definition, nested_agent_folder,
 * operation_not_permitted, missing_skill/missing_connection).
 *
 * Converted to the report restyle (Eric 2026-08-11): ReportArticle,
 * DocTable, one amber Invariant — presence declares, only a platform
 * signature activates, the trust rule the whole grant model hangs on.
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
    <ReportArticle
      eyebrow="Agents"
      title="The agent folder"
      lead="An agent is a folder. The same four things appear at every level of it, which is what makes agents compose instead of merely nest."
    >
      <ReportSection id="anatomy" title="Anatomy of the folder">
        <p>
          Everything an agent is — how it behaves, what it can reach, who it
          can hand work to — is files in one folder in S3, at{" "}
          <code>tenants/&lt;tenant&gt;/agents/&lt;agent&gt;/</code>. There is
          no second place where behavior is configured and no hidden state the
          folder does not show you.
        </p>
        <PullQuote who="the model, in one sentence">
          Read the folder and you have read the agent.
        </PullQuote>
        <p>Four things make up the shape:</p>
        <DocTable
          head={["Slot", "Holds", "Means"]}
          rows={[
            [
              <code>INSTRUCTIONS.md</code>,
              "YAML frontmatter above a prose body",
              "Who this agent is and how it works",
            ],
            [
              <code>skills/</code>,
              <>
                <code>&lt;slug&gt;/SKILL.md</code> per installed skill
              </>,
              "Procedures it knows how to run",
            ],
            [
              <code>connectors/</code>,
              <>
                <code>&lt;slug&gt;/CONNECTION.md</code> plus a signed sidecar
              </>,
              "External systems it can reach",
            ],
            [
              <code>agents/</code>,
              <>
                <code>&lt;slug&gt;/</code>, each the same shape again
              </>,
              "Narrower agents it can delegate to",
            ],
          ]}
        />
        <AgentFolderTreeDiagram />
        <p>
          A sub-agent folder is not a different format with fewer fields — it
          is the same anatomy one level down. That is the whole reason the
          model is worth learning once: what you know about the root folder is
          what you know about every folder inside it. The recursion stops
          there, though. Sub-agents cannot have sub-agents: an{" "}
          <code>agents/</code> folder found inside a sub-agent folder is
          rejected when the capabilities manifest compiles, with the reason{" "}
          <code>nested_agent_folder</code>. This is structural, not a
          configurable depth limit — there is no counter to raise. Delegation
          trees stay one hop deep on purpose, so a run always has an
          identifiable owner.
        </p>
        <p>
          One naming note: the connectors folder used to be spelled{" "}
          <code>connections/</code>. Readers accept both spellings during the
          migration window and old paths mentioned in memories or transcripts
          are covered by a tombstone file, but <code>connectors/</code> is the
          name to write. The <code>connections</code> database table was
          deliberately <em>not</em> renamed — it holds per-user OAuth rows and
          is a different concept that happened to share a word.
        </p>
      </ReportSection>

      <ReportSection id="instructions" title="INSTRUCTIONS.md">
        <p>
          <code>INSTRUCTIONS.md</code> is one file doing two jobs. Above the{" "}
          <code>---</code> fence, YAML frontmatter carries typed configuration.
          Below it, the body is instructions — plain prose, verbatim, with no
          synthetic headings and no machine sections mixed in. Root
          instructions used to live in <code>AGENTS.md</code>; that filename
          is still read during the migration window, but new work writes{" "}
          <code>INSTRUCTIONS.md</code>.
        </p>
        <p>
          The frontmatter grammar is strict from day one. These are the only
          keys it accepts:
        </p>
        <DocTable
          head={["Key", "Required", "What it does"]}
          rows={[
            [
              <code>description</code>,
              "Yes",
              "One line saying when to use this agent. On a sub-agent it is passed verbatim as the delegation tool's description — the parent model reads this string and nothing else when deciding whether to hand work over.",
            ],
            [
              <code>model</code>,
              "No",
              "Pin a model. Absent means inherit the platform or parent default at compile time.",
            ],
            [
              <code>enabled</code>,
              "No",
              <>
                <code>false</code> keeps the folder but takes the agent out of
                service.
              </>,
            ],
            [
              <code>builtInTools</code>,
              "No",
              "Which platform built-ins this agent may use. Configuration, not a grant — built-ins are ambient and this narrows them.",
            ],
            [
              <code>execution</code>,
              "No",
              <>
                Runtime limits: <code>maxRuntimeMs</code>,{" "}
                <code>maxTokens</code>, <code>costBudgetUsd</code>,{" "}
                <code>clarify</code>, <code>reviewGate</code> and the loop
                policy.
              </>,
            ],
            [
              <code>approval</code>,
              "No",
              <>
                <code>never</code>, <code>once</code> or <code>always</code> —
                whether invoking this needs a human to say yes. See{" "}
                <DocLink slug="approvals-and-guardrails">
                  approvals and guardrails
                </DocLink>
                .
              </>,
            ],
            [
              <code>operations</code>,
              "No",
              "The allowed operation list. Absent means unrestricted.",
            ],
          ]}
        />
        <p>
          Unknown keys are errors, not warnings. There are no field aliases
          and no silent tolerance: a misspelled key, a snake_case variant of
          an <code>execution</code> field, or a leftover <code>skills:</code>{" "}
          / <code>mcpServers:</code> list all fail validation, and the agent
          lands in the manifest as <code>withheld</code> with reason{" "}
          <code>invalid_definition</code>. Writing <code>instructions:</code>{" "}
          in the frontmatter is called out by name: instructions are the body
          of the file, never a field.
        </p>
        <p>
          This is deliberate. A tolerant parser that guesses what you meant is
          how two agents end up behaving differently for reasons nobody can
          find in the file.
        </p>
      </ReportSection>

      <ReportSection id="root-only" title="The root-only files">
        <p>
          The four recursive slots are the shape. The root folder additionally
          holds files that only make sense once, at the top:
        </p>
        <DocTable
          head={["File", "Class", "Notes"]}
          rows={[
            [
              <code>CONTEXT.md</code>,
              "live",
              "Operating context and the generated routing section.",
            ],
            [
              <code>GUARDRAILS.md</code>,
              "pinned",
              <>
                Policy baseline. Pinned by content hash — see{" "}
                <DocLink slug="workspace-composition">composition</DocLink>.
              </>,
            ],
            [
              <code>USER.md</code>,
              "managed",
              "Rendered from the paired human's profile rows. Edit the profile, not the file.",
            ],
            [
              <code>SPACE.md</code>,
              "live",
              <>
                Context for the active <Term>space</Term> at turn time.
              </>,
            ],
            [
              <code>MEMORY_GUIDE.md</code>,
              "live",
              "How this agent should use memory tools and notes.",
            ],
            [
              <>
                <code>TOOLS.md</code>, <code>ROUTER.md</code>
              </>,
              "live",
              "Tool-surface guidance and channel routing guidance.",
            ],
            [
              <code>mcp.json</code>,
              "config",
              "MCP server configuration metadata.",
            ],
            [
              <code>memory/*.md</code>,
              "writable",
              <>
                <code>lessons.md</code>, <code>preferences.md</code>,{" "}
                <code>contacts.md</code> — the three seeded notes; the agent
                may write anywhere under <code>memory/</code>.
              </>,
            ],
            [
              <code>manifest.json</code>,
              "generated",
              "Path, size and ETag per file. The runtime diffs it to decide what to re-sync.",
            ],
          ]}
        />
        <p>
          Retired filenames you may still see referenced in old material —{" "}
          <code>SOUL.md</code>, <code>IDENTITY.md</code>,{" "}
          <code>PLATFORM.md</code>, <code>CAPABILITIES.md</code> — carry
          nothing any more. Do not author them.
        </p>
      </ReportSection>

      <ReportSection id="grants-by-presence" title="Grants by presence">
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
            child&apos;s <code>permissions.operations</code> must be a subset
            of the root&apos;s effective operation set. Ask for more and the
            grant is withheld with <code>operation_not_permitted</code>,
            naming the operations that exceeded the root.
          </li>
          <li>
            <strong>Revocation cascades for free.</strong> Remove or disable
            the root connector and every child grant withers, with no edit to
            any child folder. A skill grant whose root install is gone shows
            up as <code>missing_skill</code> at compile — a visible absence in
            the manifest, rather than a tool that explodes mid-run.
          </li>
        </ul>
        <Invariant title="Presence declares; a signature activates">
          <p>
            The folder announces the grant. It does not turn it on. Every
            grant folder carries a platform-signed sidecar, and a folder whose
            sidecar is missing, unsigned, or fails verification is compiled
            into the <code>withheld</code> section with reason{" "}
            <code>unsigned</code> — visible in the manifest, invisible to the
            model. So dropping a folder into the tree by hand grants nothing;
            the platform has to sign it.
          </p>
        </Invariant>
        <p>
          This is a deliberate departure from the copy-everything approach
          other folder-agent systems take, where a sub-agent receives its own
          copies of the definitions it needs. Copies mean drift, and drift
          means a revocation that misses one of them. Single-point revocation
          was worth the deviation.
        </p>
      </ReportSection>

      <ReportSection id="who-can-write" title="Who is allowed to write what">
        <p>
          Files in the folder do not all have the same author. Three lanes
          write here, and they do not overlap:
        </p>
        <ul>
          <li>
            <strong>You, through the app.</strong> The Agent page at{" "}
            <strong>Settings → Agent</strong> edits the workspace tree
            directly — instructions, context, guardrails, skills. Operator
            edits are re-signed automatically.
          </li>
          <li>
            <strong>The platform.</strong> <code>USER.md</code> is rewritten
            whenever the paired human&apos;s profile changes;{" "}
            <code>manifest.json</code> and the generated sections of{" "}
            <code>CONTEXT.md</code> are regenerated on every write.
          </li>
          <li>
            <strong>The agent itself.</strong> Strictly bounded: its{" "}
            <code>memory/</code> notes, its own instruction and context prose,
            and installed skill files. It cannot write into{" "}
            <code>agents/</code>, <code>connectors/</code> or{" "}
            <code>tools/</code> through the ordinary file lane at all.
          </li>
        </ul>
        <p>
          The last exclusion is load-bearing. The sidecar on a sub-agent
          folder is optional, and a missing sidecar means enabled and
          operator-authored — so if the agent could write there, it could mint
          a live sub-agent that looks like you created it. Capability folders
          therefore have exactly one write channel — the gated
          capability-folder dispatch — and an agent-lane write to those paths
          is rejected outright.
        </p>
        <p>
          Whatever the lane, edits are compiled state. A change lands at the
          next capabilities compile and workspace sync, never mid-thread — see{" "}
          <DocLink slug="subagents-and-templates">
            sub-agents and templates
          </DocLink>{" "}
          for what that means for a run already in flight.
        </p>
      </ReportSection>
    </ReportArticle>
  );
}
