/**
 * Skills (Agents) — THINK-696.
 *
 * The workspace-native model only. `agent_skills` and `setAgentSkills`
 * are retired and must not appear here. Verified against
 * packages/api/src/lib/skills/{assignment-state,workspace-skill-index}.ts,
 * catalog-install.ts, catalog-index.ts, skill-md-parser.ts, the
 * grantCapability contract in graphql/types/capabilities.graphql and the
 * runtime scanner at agentcore-pi/.../runtime/workspace-skills.ts.
 */
import { Callout, DocArticle, DocLink, Section, Term } from "../kit";
import { SkillMaterializationDiagram } from "../figures/agents";
import type { DocTocEntry } from "../registry";

export const SKILLS_TOC: DocTocEntry[] = [
  { id: "what-a-skill-is", title: "What a skill is" },
  { id: "anatomy", title: "What is in a skill folder" },
  { id: "catalog-and-install", title: "Catalog and install" },
  { id: "assignment-state", title: "Assignment state and permissions" },
  { id: "at-runtime", title: "How the runtime loads a skill" },
];

export function Skills() {
  return (
    <DocArticle
      eyebrow="Agents"
      title="Skills"
      lead="A skill is a packaged procedure an agent can install: instructions, any tools it needs, and the permissions it is allowed to use."
    >
      <Section id="what-a-skill-is" title="What a skill is">
        <p>
          A skill is a folder of instructions that teaches an agent how to do
          one kind of work well — prepare for a sales call, audit an expense
          report, build a chart. It is the unit of reusable know-how: written
          once, installed on as many agents as need it, and improved in one
          place.
        </p>
        <p>
          Skills follow the open Agent Skills format, so a skill written here is
          the same file that runs elsewhere. The required piece is a{" "}
          <code>SKILL.md</code>; everything else is optional.
        </p>
        <Callout
          tone="note"
          title="A skill is installed when its folder exists"
        >
          <p>
            There is no assignment table. Whether an agent has a skill is
            answered by looking for <code>skills/&lt;slug&gt;/SKILL.md</code> in
            its workspace — the same rule the app, the API and the runtime all
            apply. If you are looking for a database row that says which agent
            has which skill, there isn&apos;t one, and the old{" "}
            <code>setAgentSkills</code> mutation no longer exists.
          </p>
        </Callout>
        <p>
          Reach for a skill when a cluster of related steps belongs together,
          when domain instructions should travel with the tools that need them,
          or when the same capability should exist on several agents without
          being retyped. Reach for something else when the work spans multiple
          turns or needs a human in the middle — that is an{" "}
          <DocLink slug="automations">automation</DocLink> — or when the agent
          simply needs to reach an external system, which is a{" "}
          <DocLink slug="connectors-and-mcp">connector</DocLink>.
        </p>
      </Section>

      <Section id="anatomy" title="What is in a skill folder">
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/20 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Path</th>
                <th className="px-3 py-2 font-medium">Required</th>
                <th className="px-3 py-2 font-medium">Holds</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60 text-[13px] [&_td]:px-3 [&_td]:py-2">
              <tr>
                <td className="font-medium whitespace-nowrap">
                  <code>SKILL.md</code>
                </td>
                <td className="text-foreground/80">Yes</td>
                <td className="text-foreground/80">
                  Frontmatter plus the instruction body.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">
                  <code>references/</code>
                </td>
                <td className="text-foreground/80">No</td>
                <td className="text-foreground/80">
                  Long guidance the agent reads only when it needs it.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">
                  <code>scripts/</code>
                </td>
                <td className="text-foreground/80">No</td>
                <td className="text-foreground/80">
                  Code the skill runs, for skills whose execution mode is{" "}
                  <code>script</code>.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">
                  <code>assets/</code>
                </td>
                <td className="text-foreground/80">No</td>
                <td className="text-foreground/80">
                  Templates and fixture data the skill reads on demand.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">
                  <code>evals/*.json</code>
                </td>
                <td className="text-foreground/80">No</td>
                <td className="text-foreground/80">
                  Bundled test cases, seeded into the skill&apos;s{" "}
                  <DocLink slug="evaluations">evaluation</DocLink> dataset on
                  install. A skill with none is unrated, not broken.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          <code>SKILL.md</code> needs exactly two frontmatter fields:{" "}
          <code>name</code> — lowercase, hyphenated, at most 64 characters — and{" "}
          <code>description</code>, at most 1024 characters. The description is
          the field that matters most in practice: it is what the model reads
          when deciding whether this skill is relevant to the request in front
          of it. Write it as a trigger, not a title.
        </p>
        <p>
          <code>execution</code> says how the skill runs: <code>context</code>{" "}
          (the default — the body is instructions the model follows) or{" "}
          <code>script</code> (the skill runs code in <code>scripts/</code>).
          Catalog metadata such as <code>display_name</code>,{" "}
          <code>category</code>, <code>icon</code>, <code>tags</code> and{" "}
          <code>triggers</code> rides in the same frontmatter and drives how the
          skill appears in pickers.
        </p>
        <Callout
          tone="warn"
          title="allowed-tools is a declaration, not a grant"
        >
          <p>
            A skill can list <code>allowed-tools</code> in its frontmatter. That
            is documentation of what the skill expects, useful when you are
            reviewing it. It grants nothing: the real tool surface is the
            intersection computed at registration time. Uploading a skill that
            claims a tool the agent does not have does not produce that tool.
          </p>
          <p>
            <code>SKILL.md</code> is also plaintext in a bucket. Never put a
            credential in one — reference credentials by name and let the
            connector resolve them.
          </p>
        </Callout>
      </Section>

      <Section id="catalog-and-install" title="Catalog and install">
        <p>
          Each tenant has its own skill catalog in S3, at{" "}
          <code>tenants/&lt;tenant&gt;/skill-catalog/&lt;skill&gt;/</code>. That
          is the source of truth for what exists. A database table indexes it so
          the settings list and the composer picker can load in one query, but
          the table is a derived cache — if it ever drifts, rebuilding it from
          S3 is the fix, and no data lives only there.
        </p>
        <SkillMaterializationDiagram />
        <p>
          Installing copies the catalog folder into the agent&apos;s workspace
          at <code>skills/&lt;slug&gt;/</code> and writes two small files
          alongside the copied content:
        </p>
        <ul>
          <li>
            <code>.catalog-ref.json</code> — where this copy came from and the
            content hash it was taken at. That hash is what makes it possible to
            tell later that the catalog has moved on and the installed copy is
            behind.
          </li>
          <li>
            <code>.assignment.json</code> — this agent&apos;s own state for this
            skill, covered in the next section.
          </li>
        </ul>
        <p>
          Because install is a copy, the installed skill keeps working exactly
          as reviewed even if someone edits the catalog afterwards. Reinstalling
          is how you take the newer version, and it is a deliberate act.
        </p>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/20 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">You want to</th>
                <th className="px-3 py-2 font-medium">Where</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60 text-[13px] [&_td]:px-3 [&_td]:py-2">
              <tr>
                <td className="font-medium whitespace-nowrap">
                  Browse or upload skills
                </td>
                <td className="text-foreground/80">
                  <strong>Settings → Skills</strong> — the tenant catalog, one
                  row per folder.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">
                  Install one on an agent
                </td>
                <td className="text-foreground/80">
                  <strong>Settings → Agent</strong>, or the{" "}
                  <code>grantCapability</code> mutation with class{" "}
                  <code>SKILL</code>.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">Remove one</td>
                <td className="text-foreground/80">
                  Detach it. The folder goes; the catalog copy is untouched.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">
                  Force one onto a single message
                </td>
                <td className="text-foreground/80">
                  The composer&apos;s skill picker pins it for that turn. Skills
                  blocked on the agent are never offered.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="assignment-state" title="Assignment state and permissions">
        <p>
          Presence answers &ldquo;does this agent have the skill&rdquo;.
          Everything else about <em>this</em> agent&apos;s copy lives in{" "}
          <code>skills/&lt;slug&gt;/.assignment.json</code>, beside the skill it
          describes. The filesystem is the agent, so the assignment state lives
          with the assignment.
        </p>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/20 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Field</th>
                <th className="px-3 py-2 font-medium">Carries</th>
                <th className="px-3 py-2 font-medium">Absent means</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60 text-[13px] [&_td]:px-3 [&_td]:py-2">
              <tr>
                <td className="font-medium whitespace-nowrap">
                  <code>enabled</code>
                </td>
                <td className="text-foreground/80">
                  Whether the installed skill is live.
                </td>
                <td className="text-foreground/80">Enabled.</td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">
                  <code>config</code>
                </td>
                <td className="text-foreground/80">
                  OAuth wiring — which connection this skill uses, which
                  environment variable or secret holds the token.{" "}
                  <strong>References only, never a secret value.</strong>
                </td>
                <td className="text-foreground/80">No wiring configured.</td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">
                  <code>permissions.operations</code>
                </td>
                <td className="text-foreground/80">
                  The allowlist of operations this agent may perform through the
                  skill.
                </td>
                <td className="text-foreground/80">Unrestricted.</td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">
                  <code>rate_limit_rpm</code>, <code>model_override</code>
                </td>
                <td className="text-foreground/80">
                  Per-assignment throttle and model pin.
                </td>
                <td className="text-foreground/80">Platform defaults.</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          Two agents can therefore hold the same skill on very different terms:
          one wired to a read-only connection with three permitted operations,
          another wired to a full-access one. Same instructions, different
          reach. The skill folder is shared know-how; the sidecar is this
          agent&apos;s terms of use.
        </p>
        <Callout tone="tip" title="Missing sidecar is a valid, common state">
          <p>
            A skill installed with no wiring and no restrictions has no{" "}
            <code>.assignment.json</code> at all, and reads as enabled with
            defaults. An empty sidecar is not a broken install — most skills
            never need one.
          </p>
        </Callout>
        <p>
          Sub-agents get skills the same way every other grant works: a{" "}
          <code>skills/&lt;slug&gt;/</code> folder inside the sub-agent folder
          holding a signed marker that points at the root install. See{" "}
          <DocLink slug="agent-folder">grants by presence</DocLink>.
        </p>
      </Section>

      <Section id="at-runtime" title="How the runtime loads a skill">
        <p>
          At the start of a turn the runtime walks the synced workspace for{" "}
          <code>SKILL.md</code> files under a <code>skills/</code> directory and
          registers what it finds. Only the name and description go into the
          model&apos;s working context up front. The body is read when the skill
          is actually chosen, and files under <code>references/</code> are read
          later still, only if that particular run needs them.
        </p>
        <p>
          That staging is why installing many skills is affordable. A large
          catalog costs you a line of description each; it does not cost you the
          whole instruction body of every skill on every turn.
        </p>
        <p>
          Discovery is scoped. Skills in a sub-agent folder belong to that
          sub-agent and are never picked up by the parent&apos;s scan, so a
          same-named skill one level down cannot shadow the root install. Which
          skills a given turn actually loaded — and which were withheld — is
          recorded in the{" "}
          <DocLink slug="workspace-composition">capabilities manifest</DocLink>{" "}
          for that run, alongside the <Term>space</Term> and user context it ran
          under.
        </p>
      </Section>
    </DocArticle>
  );
}
