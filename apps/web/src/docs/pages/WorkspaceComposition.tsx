/**
 * Workspace composition & inheritance (Agents) — THINK-696.
 *
 * The correction this page exists to make: composition is a write-time
 * copy plus a turn-time mount, NOT a read-time ancestor walk. Verified
 * against packages/api/src/lib/workspace-bootstrap.ts ("what this is
 * NOT: an overlay composer"), workspace-copy.ts, pinned-versions.ts
 * (content-addressable version store, sha256 pins), workspace-overlay.ts
 * (pinLookupPaths; memory/ and skills/ as pin-inheritance boundaries),
 * workspace-lanes.ts (the Agent/, Spaces/, User/, Thread/ mounts and
 * their write lanes) and capabilities/manifest-compile.ts (the withheld
 * reasons, scopeSpecificity: user > space > sub-agent > agent root, and
 * the content-addressed fingerprint).
 *
 * Converted to the report restyle (Eric 2026-08-11). One amber
 * Invariant: the pinned-guardrail accept flow — the one place a human
 * decision gates propagation.
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
import { WorkspaceLayersDiagram } from "../figures/agents";
import type { DocTocEntry } from "../registry";

export const WORKSPACE_COMPOSITION_TOC: DocTocEntry[] = [
  { id: "layers", title: "The layers" },
  { id: "inheritance", title: "What inherits, what overrides" },
  { id: "pinned", title: "Pinned files and template updates" },
  { id: "turn-time", title: "What the runtime actually sees" },
  { id: "capabilities-manifest", title: "The capabilities manifest" },
];

export function WorkspaceComposition() {
  return (
    <ReportArticle
      eyebrow="Agents"
      title="Workspace composition & inheritance"
      lead="What an agent can actually see and do is composed from several layers; this page shows the layers, the order they apply, and what wins."
    >
      <ReportSection id="layers" title="The layers">
        <p>
          Two different mechanisms get called composition, and confusing them
          is the source of most surprises. One happens once, when an agent is
          created. The other happens on every turn.
        </p>
        <WorkspaceLayersDiagram />
        <p>
          <strong>At write time,</strong> canonical defaults from the{" "}
          <code>workspace-defaults</code> package are seeded into a tenant
          layer, copied forward into a template layer, and copied again into
          the new agent&apos;s own folder. From that moment the agent folder
          is a complete, standalone tree. Its files belong to it.
        </p>
        <p>
          <strong>At turn time,</strong> four sources — the agent folder, the
          active <Term>space</Term>, the requesting user, and the thread
          itself — mount into a single rendered workspace under{" "}
          <code>Agent/</code>, <code>Spaces/&lt;space&gt;/</code>,{" "}
          <code>User/</code> and <code>Thread/</code>. That rendered tree is
          what the runtime syncs and reads.
        </p>
        <DocTable
          head={["Layer", "When it applies", "What it contributes"]}
          rows={[
            [
              "Workspace defaults",
              "Tenant setup",
              "The canonical starting files — instructions, context, guardrails, the memory guide, the seeded skills.",
            ],
            [
              "Tenant template",
              "Agent creation",
              "Your house edits to those files, plus model and policy defaults for agents made from it.",
            ],
            [
              "Agent folder",
              "Always",
              "The agent's own files. After creation this is the source of truth for everything but the pinned files.",
            ],
            [
              "Space",
              "Per turn",
              "Project context, space-local files, and restrictive overrides — a space shapes behavior, it does not grant reach.",
            ],
            [
              "User",
              "Per turn",
              "The requester's profile and their own connections. Two people in one space can have different effective surfaces.",
            ],
            [
              "Thread",
              "Per turn",
              "Notes, goal and progress files for this piece of work — generated and read-only to the agent.",
            ],
          ]}
        />
      </ReportSection>

      <ReportSection id="inheritance" title="What inherits, what overrides">
        <PullQuote who="the correction this page exists to make">
          There is no read-time ancestor walk. Files are copied into the agent
          folder when the agent is created, and the folder is read flat from
          then on.
        </PullQuote>
        <p>
          Older material describes composition as resolving a file by walking
          from the deepest folder outward — agent override, then template,
          then defaults — on every read. That composer is gone. The practical
          consequence:{" "}
          <strong>editing a template does not change existing agents.</strong>{" "}
          A template edit changes what the <em>next</em> agent starts with.
          The only exception is the pinned class below, which has an explicit
          accept flow precisely because nothing else propagates.
        </p>
        <p>Every file in the workspace is in one of three classes:</p>
        <DocTable
          head={["Class", "Which files", "Behavior"]}
          rows={[
            [
              "Live",
              "Everything not named below",
              "The agent's copy is the truth. Edit it and the change is in effect on the next turn.",
            ],
            [
              "Pinned",
              <code>GUARDRAILS.md</code>,
              "Tracked by content hash. Upstream changes wait for an explicit accept.",
            ],
            [
              "Managed",
              <code>USER.md</code>,
              "Rewritten in full by the platform from profile data. Hand edits are overwritten.",
            ],
          ]}
        />
        <p>
          Within one turn, the layers do not fight over file contents — they
          mount in separate directories, so <code>Agent/CONTEXT.md</code> and{" "}
          <code>Spaces/&lt;space&gt;/CONTEXT.md</code> both exist and both get
          read. Where layers <em>can</em> disagree is capabilities, and that
          has its own rule: grants add up across scopes, restrictions are a
          union and always win, and when the same capability slug is granted
          at two scopes the most specific one supersedes the other whole.
          Specificity runs user, then space, then sub-agent, then agent root.
        </p>
      </ReportSection>

      <ReportSection id="pinned" title="Pinned files and template updates">
        <p>
          <code>GUARDRAILS.md</code> is the one file where silent inheritance
          would be dangerous, so it does the opposite of everything else.
          When an agent is created, the guardrail bytes are hashed, that
          exact content is written to a content-addressable version store,
          and the hash is recorded against the agent.
        </p>
        <p>
          The first thing that buys is permanence:{" "}
          <strong>the pinned content is resolvable forever.</strong> Even
          after the template moves on, the version store can still serve the
          exact bytes the agent was pinned to.
        </p>
        <Invariant title="An upstream change is an offer, not an event">
          <p>
            When the template-side guardrail no longer matches the pin, the
            agent surfaces a template-update prompt. A person accepts it per
            agent, or in bulk for the tenant — until then the agent keeps
            running the guardrails it was reviewed with. Guardrails never
            change under a running agent without someone looking.
          </p>
        </Invariant>
        <p>
          Pins are path-qualified, so a nested guardrail file is tracked
          separately from the root one and the update prompt points at the
          exact file needing review. <code>memory/</code> and{" "}
          <code>skills/</code> are boundaries in that lookup — a pin inside
          them never resolves to a different file at an outer scope.
        </p>
      </ReportSection>

      <ReportSection id="turn-time" title="What the runtime actually sees">
        <p>
          The rendered workspace is not just a merge of folders; parts of it
          are generated and the agent is not allowed to write them back. The
          mount points and their write lanes:
        </p>
        <DocTable
          head={["Mount", "Source", "Agent may write"]}
          rows={[
            [
              <code>Agent/</code>,
              "The agent folder",
              <>
                Instructions, context, <code>memory/</code>,{" "}
                <code>skills/</code> — but never <code>agents/</code>,{" "}
                <code>connectors/</code> or <code>tools/</code>.
              </>,
            ],
            [
              <code>Spaces/&lt;space&gt;/</code>,
              "The space folder",
              "Space source files, subject to membership checks.",
            ],
            [
              <code>User/</code>,
              "The requester's folder",
              <>
                <code>USER.md</code> is platform-managed and read-only here.
              </>,
            ],
            [
              <code>Thread/</code>,
              "This thread",
              <>
                Notes and goal files only; <code>PROGRESS.md</code> and{" "}
                <code>TASKS.md</code> are generated projections.
              </>,
            ],
          ]}
        />
        <p>
          A write that lands outside its lane is rejected when the workspace
          reconciles, which is why an agent cannot quietly grant itself
          anything. Every file in the render carries a manifest entry with an
          ETag, so the runtime re-syncs only what changed.
        </p>
      </ReportSection>

      <ReportSection id="capabilities-manifest" title="The capabilities manifest">
        <p>
          Files are only half the composition. The other half is the{" "}
          <strong>capabilities manifest</strong>: the compiled answer to what
          this agent can actually invoke. The compiler reads the workspace —
          built-ins, <code>skills/</code>, <code>connectors/</code>,{" "}
          <code>tools/</code>, <code>mcp/</code> and <code>agents/</code>{" "}
          folders — and emits one document with two sections.
        </p>
        <ul>
          <li>
            <strong>Active</strong> — entries the runtime registers. Each
            carries its class (<code>builtin</code>, <code>skill</code>,{" "}
            <code>connection</code>, <code>tool</code>, <code>mcp</code>,{" "}
            <code>agent</code>), its slug, and the scope it came from.
          </li>
          <li>
            <strong>Withheld</strong> — entries that were found but did not
            qualify, each with a typed reason. The app shows these; the
            runtime ignores them.
          </li>
        </ul>
        <DocTable
          head={["Withheld reason", "What happened"]}
          rows={[
            [
              <>
                <code>unsigned</code>, <code>invalid_signature</code>
              </>,
              "The folder is there but the platform has not signed it, or the signature does not verify.",
            ],
            [
              <code>definition_drift</code>,
              "The bytes changed after approval. Re-approve to restore it.",
            ],
            [
              <code>invalid_definition</code>,
              "The marker file failed strict validation.",
            ],
            [
              <code>collision</code>,
              "Two definitions claim the same tool name.",
            ],
            [
              <>
                <code>missing_connection</code>, <code>missing_skill</code>
              </>,
              "A child grant whose root install is gone or inactive.",
            ],
            [
              <code>operation_not_permitted</code>,
              "A child asked for operations the root does not grant.",
            ],
            [
              <code>nested_agent_folder</code>,
              <>
                A sub-agent folder contains its own <code>agents/</code>{" "}
                folder.
              </>,
            ],
            [
              <>
                <code>disabled</code>, <code>approval_gated</code>,{" "}
                <code>policy_blocked</code>
              </>,
              "Valid, but switched off or held behind a gate.",
            ],
          ]}
        />
        <p>
          The manifest is content-addressed: its fingerprint hashes only the
          meaningful body, so the fingerprint changes if and only if the
          capability surface changed. That is what makes the question
          &ldquo;did anything about this agent&apos;s reach change between
          these two runs?&rdquo; answerable by comparing two strings — and it
          is the join key that makes{" "}
          <DocLink slug="evaluations">evaluation results</DocLink> comparable
          across runs.
        </p>
        <p>
          Read the withheld list as a diagnosis, not an outage. A withheld
          entry is the system telling you where it stopped and why, in a
          place you can read: if a skill you installed is not in the active
          list, the reason beside it in the withheld list is the whole
          answer.
        </p>
      </ReportSection>
    </ReportArticle>
  );
}
