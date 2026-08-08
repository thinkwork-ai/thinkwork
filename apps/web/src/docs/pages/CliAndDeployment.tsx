/**
 * CLI & deployment (Operations) — THINK-701.
 *
 * Scope decision: this is "how to operate a stack you already have", not a
 * Terraform authoring guide. The command inventory is verified against
 * apps/cli/src/cli.ts and the individual commands/*.ts descriptions.
 *
 * Two things the old docs carried that are gone and must not come back:
 * evaluation seed-cleanup guidance, and the `enable_hindsight` /
 * `memory_engine` Terraform inputs (deprecated no-ops — memory is managed
 * AgentCore Memory, full stop). There is also no `thinkwork wiki` command
 * despite older notes claiming one; compounding memory compiles server-side.
 */
import { CheckCircle2, CloudUpload, LogIn, Stethoscope } from "lucide-react";
import {
  Callout,
  DocArticle,
  DocLink,
  FlowChain,
  FlowChip,
  FlowDiagram,
  FlowLink,
  FlowNode,
  Section,
} from "../kit";
import type { DocTocEntry } from "../registry";

export const CLI_AND_DEPLOYMENT_TOC: DocTocEntry[] = [
  { id: "the-cli", title: "The thinkwork CLI" },
  { id: "stages", title: "Stages" },
  { id: "the-loop", title: "The deploy loop" },
  { id: "commands", title: "Command inventory" },
  { id: "day-two", title: "Day-two operations" },
];

export function CliAndDeployment() {
  return (
    <DocArticle
      eyebrow="Operations"
      title="CLI & deployment"
      lead="The product deploys itself: one CLI, bundled Terraform, and a stage model that keeps environments genuinely separate."
    >
      <Section id="the-cli" title="The thinkwork CLI">
        <p>
          <code>thinkwork</code> is a single command that does two different
          jobs, and it helps to keep them apart in your head:
        </p>
        <ul>
          <li>
            <strong>Infrastructure</strong> — plan, deploy, verify and inspect a
            stack. These talk to AWS with your AWS credentials, and they run
            Terraform that ships inside the CLI itself. You do not clone a repo
            to deploy.
          </li>
          <li>
            <strong>The API</strong> — threads, agents, skills, memory, costs,
            evaluations. These talk to a deployed stack over its GraphQL API
            with a signed-in session, and they are the scriptable version of the
            web app.
          </li>
        </ul>
        <p>
          Every command takes <code>--json</code>, with data on stdout and
          everything else on stderr, so piping into <code>jq</code> is a first
          class path rather than a happy accident. Most take{" "}
          <code>-s, --stage</code>; in a terminal, leaving it off prompts you
          rather than guessing.
        </p>
        <Callout tone="warn" title="There is no local-only mode">
          <p>
            ThinkWork Agent does not run on a laptop. Everything — the runtime,
            the database, the model calls — lives in a deployed AWS stack, and
            the CLI is a client of one. If you have not deployed yet, there is
            nothing for the API commands to talk to.
          </p>
        </Callout>
      </Section>

      <Section id="stages" title="Stages">
        <p>
          A <strong>stage</strong> is one deployment: <code>dev</code>,{" "}
          <code>prod</code>, a customer name. It is also the tenant boundary —
          one stage holds one tenant&apos;s everything, as described in{" "}
          <DocLink slug="security-and-tenancy">security &amp; tenancy</DocLink>.
          Two environments means two stages, deployed twice.
        </p>
        <p>
          Inside a stage the stack is built in three tiers, and most commands
          accept <code>-c, --component</code> to work on one of them:
        </p>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/20 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Tier</th>
                <th className="px-3 py-2 font-medium">Roughly</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60 text-[13px] [&_td]:px-3 [&_td]:py-2">
              <tr>
                <td className="font-medium whitespace-nowrap">foundation</td>
                <td className="text-foreground/80">
                  The slow-moving base: networking, identity, registries. Rarely
                  changes; changes here are the expensive ones.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">data</td>
                <td className="text-foreground/80">
                  Stores: the Postgres cluster, buckets, parameters and secrets.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">app</td>
                <td className="text-foreground/80">
                  Everything that ships often: the API, the agent runtime, the
                  web app, schedulers.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          The default is <code>all</code>, applied in dependency order. Reach
          for a single tier when you know what you changed and want a short plan
          — not as a habit.
        </p>
        <p>
          Local stack settings live in a per-stage config on your machine, and
          real secrets live in Secrets Manager and SSM inside the deployed
          account. <code>thinkwork config get</code> and{" "}
          <code>thinkwork config set</code> read and change stack settings;{" "}
          <code>--apply</code> on a <code>set</code> pushes the change through
          Terraform in the same step.
        </p>
      </Section>

      <Section id="the-loop" title="The deploy loop">
        <p>
          Four commands, in this order, every time. The discipline is the whole
          trick: <code>doctor</code> before you plan, <code>verify</code> after
          you apply.
        </p>
        <FlowDiagram>
          <FlowChain>
            <FlowNode
              icon={LogIn}
              title="thinkwork login"
              sub="AWS credentials, then the stack's API"
              tone="consumer"
            >
              <FlowChip>--stage</FlowChip>
              <FlowChip>--profile</FlowChip>
            </FlowNode>
            <FlowLink label="credentials in place" />
            <FlowNode
              icon={Stethoscope}
              title="thinkwork doctor"
              sub="account prerequisites, before anything is created"
              tone="source"
            />
            <FlowLink label="prerequisites pass" />
            <FlowNode
              icon={CloudUpload}
              title="thinkwork plan → deploy"
              sub="read the diff, then apply it"
              tone="compute"
            >
              <FlowChip>-c foundation|data|app|all</FlowChip>
            </FlowNode>
            <FlowLink label="applied" />
            <FlowNode
              icon={CheckCircle2}
              title="thinkwork verify"
              sub="GraphQL, auth, web, schema, seeding"
              tone="graph"
            />
          </FlowChain>
        </FlowDiagram>
        <p>
          <code>login</code> without a stage configures AWS credentials — the
          part <code>plan</code> and <code>deploy</code> need.{" "}
          <code>login --stage &lt;s&gt;</code> signs you in to a{" "}
          <em>deployed</em> stack&apos;s Cognito and caches a session for the
          API commands. Most operators end up running both, and{" "}
          <code>thinkwork me</code> is the one-line check that the second one
          worked: it prints who you are and which tenant you resolved to.
        </p>
        <Callout tone="tip" title="verify is the step people skip">
          <p>
            A green <code>terraform apply</code> means resources exist, not that
            the product works. <code>thinkwork verify</code> is the difference:
            it actually calls the GraphQL endpoint, checks auth, loads the web
            app, and confirms the database schema and seed data are where the
            deployed code expects them. Run it after every deploy.
          </p>
        </Callout>
      </Section>

      <Section id="commands" title="Command inventory">
        <p>
          The operator set — what you need to bring up and run a stack. There
          are many more commands behind the API side (threads, agents, skills,
          memory, costs, evaluations, webhooks); <code>thinkwork --help</code>{" "}
          is the current list, and it is the authority, not this page.
        </p>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/20 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Command</th>
                <th className="px-3 py-2 font-medium">What it does</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60 text-[13px] [&_td]:px-3 [&_td]:py-2">
              <tr>
                <td className="font-medium whitespace-nowrap">
                  <code>login</code>
                </td>
                <td className="text-foreground/80">
                  Configure AWS credentials, or with <code>--stage</code> sign
                  in to a deployed stack and cache the session.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">
                  <code>me</code>
                </td>
                <td className="text-foreground/80">
                  Print the identity behind the current session — the sanity
                  check after <code>login</code>.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">
                  <code>doctor</code>
                </td>
                <td className="text-foreground/80">
                  Check AWS account prerequisites before a deployment. Cheap,
                  read-only, and the first thing to run when a deploy fails
                  oddly.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">
                  <code>init</code>
                </td>
                <td className="text-foreground/80">
                  Scaffold configuration for a new stage. Once per environment.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">
                  <code>bootstrap</code>
                </td>
                <td className="text-foreground/80">
                  Prepare an account for its first deployment — Terraform state
                  and the prerequisites that must exist before an apply can run.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">
                  <code>plan</code>
                </td>
                <td className="text-foreground/80">
                  Terraform plan for a stage. Read the diff before you apply it,
                  particularly on <code>foundation</code> and <code>data</code>.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">
                  <code>deploy</code>
                </td>
                <td className="text-foreground/80">
                  Apply. Defaults to running Terraform locally; enterprise
                  deployments route through their own CI instead.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">
                  <code>verify</code>
                </td>
                <td className="text-foreground/80">
                  Prove a deployed stage works: GraphQL, auth, web, database
                  schema, seeding, deployed-artifact evidence.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">
                  <code>status</code>
                </td>
                <td className="text-foreground/80">
                  Every environment the CLI can see, local and in AWS. Aliased
                  as <code>list</code> and <code>ls</code>.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">
                  <code>outputs</code>
                </td>
                <td className="text-foreground/80">
                  Terraform outputs for a stage — endpoints, bucket names, ids.
                  Where you look when something needs a URL.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">
                  <code>config</code>
                </td>
                <td className="text-foreground/80">
                  <code>list</code>, <code>get</code> and <code>set</code> stack
                  configuration; <code>set --apply</code> applies in the same
                  step.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">
                  <code>update</code>
                </td>
                <td className="text-foreground/80">
                  Check for and install a newer CLI. <code>--check</code> looks
                  without installing.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">
                  <code>logout</code>
                </td>
                <td className="text-foreground/80">
                  Forget a stage&apos;s cached session, or <code>--all</code> of
                  them.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">
                  <code>destroy</code>
                </td>
                <td className="text-foreground/80">
                  Tear a stage down. Interactive confirmation unless{" "}
                  <code>-y</code>; the data tier is not recoverable afterwards.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="day-two" title="Day-two operations">
        <p>
          Once a stack is up, most operating happens in the web app rather than
          the CLI — <DocLink slug="security-and-tenancy">users</DocLink>,{" "}
          <DocLink slug="model-catalog">the model catalog</DocLink>,{" "}
          <DocLink slug="skills">skills</DocLink>,{" "}
          <DocLink slug="automations">workflows</DocLink>. The CLI keeps the
          jobs that are awkward in a browser:
        </p>
        <ul>
          <li>
            <strong>Upgrading the platform.</strong> A new release is a{" "}
            <code>plan</code> and a <code>deploy</code> like any other change,
            followed by <code>verify</code>. Update the CLI first —{" "}
            <code>thinkwork update</code> — because the Terraform it applies
            ships inside it.
          </li>
          <li>
            <strong>Answering &ldquo;what is deployed?&rdquo;</strong>{" "}
            <code>status</code> across environments, <code>outputs</code> within
            one. The web app&apos;s <strong>Settings → General</strong> shows
            the same release, stage, region and account for the stack you are
            signed in to.
          </li>
          <li>
            <strong>Scripting.</strong> Anything you would do by hand for twenty
            agents is a shell loop over the API commands with{" "}
            <code>--json</code>.
          </li>
        </ul>
        <Callout
          tone="warn"
          title="Two things you may have read elsewhere, and should not do"
        >
          <p>
            Older notes mention Terraform inputs for choosing a memory engine
            (including a <code>hindsight</code> option). Those inputs are
            deprecated no-ops — memory is managed{" "}
            <DocLink slug="memory">AgentCore Memory</DocLink> and there is
            nothing to select. Older notes also describe a seed-cleanup step
            around evaluations; that is gone too, and{" "}
            <DocLink slug="evaluations">evaluations</DocLink> need no
            maintenance chore of their own.
          </p>
        </Callout>
      </Section>
    </DocArticle>
  );
}
