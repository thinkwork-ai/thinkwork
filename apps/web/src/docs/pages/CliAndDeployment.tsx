/**
 * CLI & deployment (Operations) — THINK-701, report restyle 2026-08-11.
 *
 * Scope decision (kept from the first pass): this is "how to operate a
 * stack you already have", not a Terraform authoring guide.
 *
 * Verified against the shipped CLI and deploy path:
 * apps/cli/src/cli.ts (global `--json` with warnings/spinners on stderr,
 * re-exposed on every subcommand; `-p, --profile` precedence), commands/
 * plan.ts + outputs.ts (`-c foundation|data|app|all`, TTY stage prompt),
 * apps/cli/src/config.ts `expandComponent` (all = foundation → data → app),
 * commands/login.ts (three flows: AWS-profile picker, `--stage` Cognito
 * OAuth over loopback PKCE, `--stage --api-key` for CI), me.ts (live `me`
 * query), doctor.ts + lib/checks.ts (read-only account prereqs, shared
 * with deploy's preflight), deploy.ts (preflight → per-tier apply with
 * bundled schema migrations → native-auth reconcile + owner tenant →
 * workspace-defaults seeding → verification tail → non-fatal post-deploy
 * probe; "rerun to converge" on tier failure; enterprise routing via
 * shouldUseEnterpriseDeploy), verify.ts (the six probes named in the
 * table; SES/DNS pending items are tracked, not blocking), bootstrap.ts
 * (seeds workspace defaults — NOT state/prereqs; the old row was wrong
 * and is fixed here), destroy.ts (confirm() gate unless `-y`, extra
 * warning for prod-like stages, RDS deletion-protection drop, secrets
 * force-deleted with no recovery window, orphan scan), status.ts
 * (aliases list/ls), config.ts (get/set, `set --apply`, RETIRED_KEYS
 * accepting but never writing enable_hindsight / memory_engine),
 * update.ts (`--check`), logout.ts (`--stage` / `--all`, revoke then
 * forget), init.ts (bundled Terraform resolution — the modules ship in
 * the npm package), scripts/post-deploy.sh (Pi runtime drift probe), and
 * apps/web/src/components/settings/SettingsGeneral.tsx (Settings →
 * General shows deployed release, stage, region, account).
 *
 * Still true and still excluded: there is no `thinkwork wiki` command
 * (no commands/wiki.ts exists — compounding memory compiles server-side),
 * and no evaluation seed-cleanup step. Neither may come back.
 *
 * Chat turn-latency observability (chat-latency program, 2026-08-20,
 * THINK-915/THINK-909). Eric 2026-08-20: this is day-two operating, not a
 * new page — it extends the existing `day-two` section rather than
 * claiming a new slug. Verified against terraform/modules/app/lambda-api/
 * chat-latency-observability.tf (dashboard
 * `thinkwork-<stage>-chat-turn-latency`; saved Logs Insights query
 * `thinkwork-<stage>-turn-timeline`, filtering event = "agentcore_phase"
 * on a thread-turn id with a REPLACE_WITH_THREAD_TURN_ID placeholder;
 * alarms `thinkwork-<stage>-chat-dispatch-duration-p95` — Lambda-native,
 * no log-group dependency — and
 * `thinkwork-<stage>-chat-turn-runtime-invoke-p95`, both p95 over
 * five-minute periods breaching on 2 of 3, treat_missing_data
 * notBreaching; metrics TurnRuntimeInvokeMs / AgentLoopMs /
 * PreDispatchQueueMs in namespace Thinkwork/Chat/<stage>) and
 * variables.tf:1018-1052 for the defaults quoted here (observability
 * true, metric filters false, chat_turn_runtime_log_group_name "",
 * threshold 30000 ms, alarm actions []), plus variables.tf:808-816 for
 * agentcore_session_scope (default "thread"; "user" only once the stage's
 * runtime image dual-accepts both session ids).
 *
 * Deliberately not claimed: that any named stage runs a particular value
 * of agentcore_session_scope (no in-repo tfvars sets it), and any CLI
 * surface for these inputs — they are Terraform variables, and no
 * apps/cli config key references them.
 */
import {
  CardGrid,
  DocLink,
  DocTable,
  Flow,
  FlowArrow,
  FlowBox,
  InfoCard,
  Invariant,
  PullQuote,
  ReportArticle,
  ReportSection,
  Stage,
  Stages,
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
    <ReportArticle
      eyebrow="Operations"
      title="CLI & deployment"
      lead="The product deploys itself: one CLI, bundled Terraform, and a stage model that keeps environments genuinely separate."
    >
      <ReportSection id="the-cli" title="The thinkwork CLI">
        <p>
          <code>thinkwork</code> is a single command that does two different
          jobs, and it helps to keep them apart in your head:
        </p>
        <CardGrid>
          <InfoCard title="Infrastructure">
            <p>
              Plan, deploy, verify and inspect a stack. These talk to AWS with
              your AWS credentials, and they run Terraform that ships inside
              the CLI itself — you do not clone a repo to deploy.
            </p>
          </InfoCard>
          <InfoCard title="The API">
            <p>
              Threads, agents, skills, memory, costs, evaluations. These talk
              to a deployed stack over its GraphQL API with a signed-in
              session — the scriptable version of the web app.
            </p>
          </InfoCard>
        </CardGrid>
        <p>
          Every command takes <code>--json</code>, with data on stdout and
          everything else — warnings, spinners — on stderr, so piping into{" "}
          <code>jq</code> is a first-class path rather than a happy accident.
          Most take <code>-s, --stage</code>; in a terminal, leaving it off
          prompts you rather than guessing.
        </p>
        <PullQuote who="the operating model, in one sentence">
          ThinkWork Agent does not run on a laptop — the runtime, the database
          and the model calls all live in a deployed AWS stack, and the CLI is
          a client of one.
        </PullQuote>
        <p>
          That is why the two jobs exist: the infrastructure commands bring a
          stack into being, and the API commands have nothing to talk to until
          they have.
        </p>
      </ReportSection>

      <ReportSection id="stages" title="Stages">
        <p>
          A <strong>stage</strong> is one deployment: <code>dev</code>,{" "}
          <code>prod</code>, a customer name. It is also the tenant boundary —
          one stage holds one tenant&apos;s everything, as described in{" "}
          <DocLink slug="security-and-tenancy">security &amp; tenancy</DocLink>.
          Two environments means two stages, deployed twice.
        </p>
        <p>
          Inside a stage the stack is built in three tiers, applied in
          dependency order:
        </p>
        <Flow>
          <FlowBox title="foundation" sub="networking, identity, keys" />
          <FlowArrow />
          <FlowBox title="data" sub="database and buckets" />
          <FlowArrow />
          <FlowBox title="app" sub="everything that ships often" />
        </Flow>
        <DocTable
          head={["Tier", "Roughly"]}
          rows={[
            [
              <code>foundation</code>,
              "The slow-moving base: the network, Cognito identity, DNS and encryption keys. Rarely changes; changes here are the expensive ones.",
            ],
            [
              <code>data</code>,
              "Stores: the Postgres cluster and the stage's buckets.",
            ],
            [
              <code>app</code>,
              "The API, the agent runtime, the web app, schedulers, email — the tier most releases touch.",
            ],
          ]}
        />
        <p>
          Most infrastructure commands accept <code>-c, --component</code> to
          work on one tier; the default is <code>all</code>. Reach for a single
          tier when you know what you changed and want a short plan — not as a
          habit.
        </p>
        <p>
          Local stack settings live in a per-stage config on your machine, and
          real secrets live in Secrets Manager and SSM inside the deployed
          account. <code>thinkwork config get</code> and{" "}
          <code>thinkwork config set</code> read and change stack settings;{" "}
          <code>--apply</code> on a <code>set</code> pushes the change through
          Terraform in the same step.
        </p>
      </ReportSection>

      <ReportSection id="the-loop" title="The deploy loop">
        <p>
          Four commands, in this order, every time. The discipline is the
          whole trick: <code>doctor</code> before you plan,{" "}
          <code>verify</code> after you apply.
        </p>
        <Stages>
          <Stage num="1" title="thinkwork login" tag="credentials in place">
            <p>
              Without a stage, this configures AWS credentials — the part{" "}
              <code>plan</code> and <code>deploy</code> need. With{" "}
              <code>--stage</code>, it signs you in to a <em>deployed</em>{" "}
              stack&apos;s Cognito and caches a session for the API commands
              (<code>--api-key</code> does the same for CI, with no browser).
              Most operators end up running both, and{" "}
              <code>thinkwork me</code> is the one-line check that the second
              one worked: it runs a live query and prints who you are and
              which tenant you resolved to.
            </p>
          </Stage>
          <Stage num="2" title="thinkwork doctor" tag="read-only">
            <p>
              Checks AWS account prerequisites before anything is created —
              the same checks <code>deploy</code> repeats as its preflight.
              Cheap, read-only, and the first thing to run when a deploy fails
              oddly.
            </p>
          </Stage>
          <Stage num="3" title="thinkwork plan, then deploy">
            <p>
              <code>plan</code> shows the Terraform diff; read it before you
              apply it, particularly on <code>foundation</code> and{" "}
              <code>data</code>. <code>deploy</code> then does far more than
              run <code>terraform apply</code>: it applies each tier in
              dependency order, applies the bundled database migrations, and
              seeds workspace defaults, so a fresh stack needs no separate
              bootstrap step. If a tier fails partway, rerunning the same
              deploy converges — completed resources are untouched.
            </p>
          </Stage>
          <Stage num="4" title="thinkwork verify" tag="the step people skip">
            <p>
              A green apply means resources exist, not that the product works.{" "}
              <code>verify</code> exercises live paths instead — and{" "}
              <code>deploy</code> runs it automatically as its final gate, so
              a deploy that ends green has already passed it. Run it
              standalone whenever you want the same proof on demand.
            </p>
          </Stage>
        </Stages>
        <p>What verification actually probes:</p>
        <DocTable
          head={["Probe", "What it proves"]}
          rows={[
            ["GraphQL API answers", "the API endpoint is up and responding"],
            ["Authenticated API call", "auth works end to end, not just the endpoint"],
            ["Web app loads", "the deployed site is actually being served"],
            ["Database schema applied", "the schema matches what the deployed code expects"],
            ["Workspace seeded", "workspace defaults are in place for agents to read"],
            [
              "Deployed artifact evidence",
              "the running code is the release you deployed, not a stale image",
            ],
          ]}
        />
        <p>
          Items waiting on the outside world — SES production access, DNS
          delegation — render as a tracked checklist rather than failures, so
          a pending external approval does not mask a real breakage. After the
          apply, a non-fatal probe also checks the Pi agent runtime for
          drift: the managed runtime cycles its warm containers over roughly
          fifteen minutes after a deploy, and the probe warns if it has not
          settled yet rather than pretending the window does not exist.
        </p>
      </ReportSection>

      <ReportSection id="commands" title="Command inventory">
        <p>
          The operator set — what you need to bring up and run a stack. There
          are many more commands behind the API side (threads, agents, skills,
          memory, costs, evaluations, webhooks); <code>thinkwork --help</code>{" "}
          is the current list, and it is the authority, not this page.
        </p>
        <DocTable
          head={["Command", "What it does"]}
          rows={[
            [
              <code>login</code>,
              <>
                Configure AWS credentials, or with <code>--stage</code> sign in
                to a deployed stack and cache the session (
                <code>--api-key</code> for non-interactive automation).
              </>,
            ],
            [
              <code>me</code>,
              <>
                Print the identity behind the current session — the sanity
                check after <code>login</code>.
              </>,
            ],
            [
              <code>doctor</code>,
              "Check AWS account prerequisites before a deployment. Cheap, read-only, and the first thing to run when a deploy fails oddly.",
            ],
            [
              <code>init</code>,
              "Scaffold configuration for a new stage. Once per environment.",
            ],
            [
              <code>bootstrap</code>,
              <>
                Seed workspace defaults and per-tenant workspace files for a
                stage. <code>deploy</code> runs this itself, so you rarely need
                it standalone — it exists for re-seeding.
              </>,
            ],
            [
              <code>plan</code>,
              <>
                Terraform plan for a stage. Read the diff before you apply it,
                particularly on <code>foundation</code> and <code>data</code>.
              </>,
            ],
            [
              <code>deploy</code>,
              "Apply, plus migrations, seeding and verification. Defaults to running Terraform locally; enterprise deployments route through their own CI instead.",
            ],
            [
              <code>verify</code>,
              "Prove a deployed stage works: GraphQL, auth, web, database schema, seeding, deployed-artifact evidence.",
            ],
            [
              <code>status</code>,
              <>
                Every environment the CLI can see, local and in AWS. Aliased as{" "}
                <code>list</code> and <code>ls</code>.
              </>,
            ],
            [
              <code>outputs</code>,
              "Terraform outputs for a stage — endpoints, bucket names, ids. Where you look when something needs a URL.",
            ],
            [
              <code>config</code>,
              <>
                <code>list</code>, <code>get</code> and <code>set</code> stack
                configuration; <code>set --apply</code> applies in the same
                step.
              </>,
            ],
            [
              <code>update</code>,
              <>
                Check for and install a newer CLI. <code>--check</code> looks
                without installing.
              </>,
            ],
            [
              <code>logout</code>,
              <>
                Revoke and forget a stage&apos;s cached session, or{" "}
                <code>--all</code> of them. Your AWS profile is untouched.
              </>,
            ],
            [<code>destroy</code>, "Tear a stage down. See below."],
          ]}
        />
        <Invariant title="Destroy asks first, and means it">
          <p>
            <code>thinkwork destroy</code> requires interactive confirmation
            unless <code>-y</code> is passed for CI, and a production-like
            stage gets an extra warning before the prompt. That confirmation is
            the deliberate act the database&apos;s deletion protection exists
            to require — destroy disables it on your answer, and it
            force-deletes the stage&apos;s secrets with no recovery window.
            The data tier is not recoverable afterwards.
          </p>
        </Invariant>
        <p>
          After the teardown, destroy scans for anything still carrying the
          stage&apos;s prefix and reports leftovers by name — so a &ldquo;clean&rdquo;
          destroy that was not clean is visible instead of silent.
        </p>
      </ReportSection>

      <ReportSection id="day-two" title="Day-two operations">
        <p>
          Once a stack is up, most operating happens in the web app rather
          than the CLI — <DocLink slug="security-and-tenancy">users</DocLink>,{" "}
          <DocLink slug="model-catalog">the model catalog</DocLink>,{" "}
          <DocLink slug="skills">skills</DocLink>,{" "}
          <DocLink slug="automations">workflows</DocLink>. The CLI keeps the
          jobs that are awkward in a browser:
        </p>
        <ul>
          <li>
            <strong>Upgrading the platform.</strong> A new release is a{" "}
            <code>plan</code> and a <code>deploy</code> like any other change.
            Update the CLI first — <code>thinkwork update</code> — because the
            Terraform it applies ships inside it.
          </li>
          <li>
            <strong>Answering &ldquo;what is deployed?&rdquo;</strong>{" "}
            <code>status</code> across environments, <code>outputs</code>{" "}
            within one. The web app&apos;s <strong>Settings → General</strong>{" "}
            shows the same deployed release, stage, region and account for the
            stack you are signed in to.
          </li>
          <li>
            <strong>Scripting.</strong> Anything you would do by hand for
            twenty agents is a shell loop over the API commands with{" "}
            <code>--json</code>.
          </li>
        </ul>
        <p>
          It also keeps the job of answering &ldquo;why was that turn
          slow?&rdquo; — and a deployed stage answers it without any setup on
          your part. Every stage gets a CloudWatch dashboard, a saved query
          and an alarm, each named after the stage:
        </p>
        <DocTable
          head={["What", "Name", "What it is for"]}
          rows={[
            [
              "Dashboard",
              <code>thinkwork-&lt;stage&gt;-chat-turn-latency</code>,
              "The whole chat turn at a glance: the runtime call, the model loop, the gap between them (where a cold start hides), the pre-dispatch queue, and invocations and errors across the four Lambdas a turn passes through.",
            ],
            [
              "Saved query",
              <code>thinkwork-&lt;stage&gt;-turn-timeline</code>,
              <>
                One turn&apos;s phases in order, across every log group. Open
                it in Logs Insights, paste the thread-turn id over{" "}
                <code>REPLACE_WITH_THREAD_TURN_ID</code>, run.
              </>,
            ],
            [
              "Alarm",
              <code>thinkwork-&lt;stage&gt;-chat-dispatch-duration-p95</code>,
              "The regression guard: p95 of the agent-runtime call, breaching on two of three five-minute periods. An idle stage does not alarm.",
            ],
          ]}
        />
        <p>
          Those three are on by default and need nothing from you. Richer
          per-phase metrics are opt-in, and deliberately so:{" "}
          <code>enable_chat_turn_latency_metric_filters</code> defaults to{" "}
          <code>false</code>, because the Lambda log groups it reads are
          created on first invocation rather than by Terraform, so a
          greenfield apply would fail on them. Turn it on for a stage that has
          already served chat traffic, and set{" "}
          <code>chat_turn_runtime_log_group_name</code> to that stage&apos;s
          agent-runtime log group to light up the model-loop widgets too.
          Alarms also notify nothing until you give{" "}
          <code>chat_turn_latency_alarm_actions</code> a topic — an alarm with
          no destination is a dashboard, not a page.
        </p>
        <p>
          One more stage input belongs in the same conversation.{" "}
          <code>agentcore_session_scope</code> decides whether a person&apos;s
          warm agent machine is shared across their threads (<code>user</code>
          ) or kept per thread (<code>thread</code>, the default). The wider
          scope is what makes a brand-new thread fast rather than cold, and it
          is safe only once the stage&apos;s agent runtime accepts both
          session keys — so treat it as a deliberate flip after a release, not
          a default to carry into a fresh stage. What people feel either way
          is described under{" "}
          <DocLink slug="threads">history and resumption</DocLink>. All three
          of these are Terraform inputs on the stage, not CLI flags.
        </p>
        <p>
          Two things you may have read elsewhere, and should not do. Older
          notes mention Terraform inputs for choosing a memory engine
          (including a <code>hindsight</code> option). Those inputs are
          retired: <code>config set</code> still accepts them so old scripts
          do not hard-fail, but never writes them, because memory is managed{" "}
          <DocLink slug="memory">AgentCore Memory</DocLink> and there is
          nothing to select. Older notes also describe a seed-cleanup step
          around evaluations; that is gone too, and{" "}
          <DocLink slug="evaluations">evaluations</DocLink> need no
          maintenance chore of their own.
        </p>
      </ReportSection>
    </ReportArticle>
  );
}
