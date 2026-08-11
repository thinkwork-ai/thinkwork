/**
 * Sub-agents & templates (Agents) — THINK-696.
 *
 * Verified against packages/api/src/lib/agent-folder-format.ts (the
 * strict format, description required), capabilities/manifest-compile.ts
 * (admission, nested_agent_folder, child grants, the instruction-hash
 * pin), packages/agentcore-pi/agent-container/src/
 * agent-profile-delegation.ts (the closed delegated loop: discovery,
 * one needs_clarification escalation with max 4 questions, the verifier
 * pass, enforced runtime/token/cost budgets with an explicit stop
 * message) and packages/database-pg/src/schema/agent-templates.ts (what
 * a template row still carries: workspace tree, model, guardrail,
 * blocked tools, built-in opt-ins, skills).
 *
 * Converted to the report restyle (Eric 2026-08-11). The old FlowChain
 * figure was a straight chain, so it is now an inline vertical Flow. No
 * amber on this page: the pinned-guardrail accept flow is the
 * composition page's Invariant, and repeating it here would dilute it.
 */
import {
  DocLink,
  DocTable,
  Flow,
  FlowArrow,
  FlowBox,
  PullQuote,
  ReportArticle,
  ReportSection,
  Term,
} from "../kit";
import type { DocTocEntry } from "../registry";

export const SUBAGENTS_AND_TEMPLATES_TOC: DocTocEntry[] = [
  { id: "subagent-folders", title: "Sub-agent folders" },
  { id: "delegation", title: "How delegation works" },
  { id: "freshness", title: "When an edit takes effect" },
  { id: "templates", title: "Templates and fleet rollout" },
];

export function SubagentsAndTemplates() {
  return (
    <ReportArticle
      eyebrow="Agents"
      title="Sub-agents & templates"
      lead="Sub-agents are folders inside an agent folder: a narrower agent with its own instructions and grants, that the parent can delegate to."
    >
      <ReportSection id="subagent-folders" title="Sub-agent folders">
        <p>
          A sub-agent is a folder at <code>agents/&lt;slug&gt;/</code> inside
          an agent&apos;s workspace. It has the same anatomy as the folder
          that contains it — <code>INSTRUCTIONS.md</code>, and optionally{" "}
          <code>skills/</code> and <code>connectors/</code> — which is the
          point of the recursive shape described in{" "}
          <DocLink slug="agent-folder">the agent folder</DocLink>. There is no
          separate sub-agent format to learn.
        </p>
        <p>
          Create one when a slice of work wants a different posture: narrower
          instructions, a smaller tool surface, a cheaper or a stronger model,
          a tighter budget. A reviewer that must not touch production. A
          researcher allowed to browse but not to write. Do <em>not</em>{" "}
          create one merely to organize prose — that is what context files are
          for.
        </p>
        <p>
          The one frontmatter field that carries real weight is{" "}
          <code>description</code>. It is required, and it is handed to the
          parent model verbatim as the delegation tool&apos;s description. It
          is the whole basis on which the parent decides to hand work over, so
          write it as a routing rule and not as a job title:
        </p>
        <ul>
          <li>
            <strong>Weak</strong> — &ldquo;The research specialist.&rdquo;
          </li>
          <li>
            <strong>Strong</strong> — &ldquo;Use for open-ended external
            research that needs multiple sources compared; returns a sourced
            summary, never a final customer-facing answer.&rdquo;
          </li>
        </ul>
        <p>
          Grants are folder presence, never a list in the frontmatter — a
          leftover <code>skills:</code> key is a hard validation error, not an
          ignored field. A sub-agent&apos;s connector grant is a signed
          sidecar narrowing the root grant, and its operations must be a
          subset of the root&apos;s. Revoke at the root and every child grant
          withers without any child being edited.
        </p>
        <p>
          The depth is one level, on purpose. Sub-agents cannot own
          sub-agents, and the delegated run cannot delegate onward: a nested{" "}
          <code>agents/</code> folder is rejected at compile as{" "}
          <code>nested_agent_folder</code>. The result is that every run has
          one owner and a bounded fan-out, which is what makes cost and audit
          legible.
        </p>
      </ReportSection>

      <ReportSection id="delegation" title="How delegation works">
        <p>
          Compiled sub-agents show up to the parent as a single tool that
          takes a slug and a task. The parent picks a sub-agent by matching
          the request against those descriptions, states a concrete task, and
          waits.
        </p>
        <Flow vertical>
          <FlowBox
            title="Parent agent"
            sub="reads each sub-agent's description, picks one"
          />
          <FlowArrow down label="slug + task" />
          <FlowBox
            title="Sub-agent run"
            sub="a closed loop, foreground — its own model, grants and budget"
          />
          <FlowArrow down label="verify" />
          <FlowBox
            title="Self-review"
            sub="checks the work against the task before returning"
          />
          <FlowArrow down label="handoff summary" />
          <FlowBox
            title="Parent owns the answer"
            sub="the sub-agent never replies to the user directly"
          />
        </Flow>
        <p>The rules that make this predictable:</p>
        <ul>
          <li>
            <strong>Closed capabilities.</strong> The run executes with the
            capabilities its folder grants and nothing else. It cannot request
            a different model, extra tools, another skill, or a longer timeout
            mid-run.
          </li>
          <li>
            <strong>It reviews itself before returning.</strong> The delegated
            loop ends with a verification pass against the task, the evidence
            and the stated quality bar, then hands back a summary.
          </li>
          <li>
            <strong>The parent owns the response.</strong> A sub-agent does
            not address the user unless the task explicitly asked it for
            user-facing copy.
          </li>
          <li>
            <strong>One clarification cycle.</strong> If the task is
            under-specified the sub-agent can hand back questions. The parent
            answers them from context and re-delegates, or asks you — and
            after your answer, delegates once more. It does not loop asking.
          </li>
          <li>
            <strong>Budgets are enforced, not advisory.</strong> Runtime,
            token and cost ceilings come from the folder&apos;s{" "}
            <code>execution</code> block. Exceeding one ends the run with an
            explicit message rather than a silent truncation; the fix is a
            narrower task, not a bigger number.
          </li>
        </ul>
        <PullQuote who="when to delegate, in one sentence">
          Delegate for isolation, not for speed: delegated runs are foreground
          and the parent waits, so what you gain is a clean context, a bounded
          capability surface and a separately budgeted unit of work — not
          parallelism.
        </PullQuote>
        <p>
          If the work does not need different context or different reach,
          letting the parent do it directly is cheaper and faster.
        </p>
      </ReportSection>

      <ReportSection id="freshness" title="When an edit takes effect">
        <p>
          Sub-agent definitions are compiled state. Editing{" "}
          <code>INSTRUCTIONS.md</code> does not change a thread already
          running, and it does not take effect at the next message either — it
          takes effect at the next capabilities compile and workspace sync.
        </p>
        <p>
          The manifest records the content hash of the instructions it
          compiled. Before spawning a sub-agent the runtime checks the synced
          file against that pin, and if they disagree it skips the sub-agent
          loudly rather than running a version nobody approved. So the
          definition recorded against a run is always the definition the run
          actually used — which is what makes two{" "}
          <DocLink slug="evaluations">evaluation runs</DocLink> comparable.
        </p>
        <p>
          Silence after an edit usually means unsynced. If a sub-agent stops
          being offered right after you edited it, look at the manifest before
          you look at the prose: a validation error puts it in the withheld
          list as <code>invalid_definition</code> with the failing field
          named, and a pin mismatch shows up as a skipped spawn. Both are
          visible; neither is silent.
        </p>
      </ReportSection>

      <ReportSection id="templates" title="Templates and fleet rollout">
        <p>
          Each company runs one Enterprise Agent, and specialization happens
          inside it — sub-agent folders for delegation,{" "}
          <DocLink slug="spaces">spaces</DocLink> for the context a piece of
          work happens in. That is the shape to reach for first. Templates sit
          underneath it as authoring infrastructure rather than a daily
          control surface.
        </p>
        <p>
          A template still carries real things, all of them applied at
          creation time:
        </p>
        <DocTable
          head={["A template holds", "Which becomes"]}
          rows={[
            [
              "A workspace file tree",
              "The new agent's starting folder, copied in full.",
            ],
            [
              "Model and guardrail",
              "The agent's defaults; the guardrail file arrives pinned.",
            ],
            [
              "Blocked tools",
              "A restriction the agent inherits and cannot widen.",
            ],
            [
              "Built-in opt-ins",
              "Whether the code sandbox, browser automation, web search, web extraction and email sending are registered at all.",
            ],
            [
              "Skills to install",
              "Skill folders materialized into the new workspace.",
            ],
          ]}
        />
        <p>
          Templates are a starting point, not a live parent. Because creation
          copies files rather than linking them,{" "}
          <strong>
            editing a template changes what the next agent starts with and
            nothing else
          </strong>{" "}
          — it does not reach existing agents. <code>GUARDRAILS.md</code> is
          the single exception, and it is deliberately opt-in: it is pinned by
          content hash, so an upstream change surfaces as a template-update
          prompt you accept per agent or in bulk for the tenant. That is the
          one supported fleet-wide rollout, and it exists because guardrails
          are exactly the thing that should not change under a running agent
          without someone looking — see{" "}
          <DocLink slug="workspace-composition">
            composition &amp; inheritance
          </DocLink>
          .
        </p>
        <p>
          When someone new joins, inviting them into the tenant creates their
          identity and their <Term>space</Term> membership; pairing them to an
          agent is what causes <code>USER.md</code> to be rendered from their
          profile. Their access is a matter of tenancy and space membership,
          not of which template built the agent — see{" "}
          <DocLink slug="security-and-tenancy">security and tenancy</DocLink>.
        </p>
      </ReportSection>
    </ReportArticle>
  );
}
