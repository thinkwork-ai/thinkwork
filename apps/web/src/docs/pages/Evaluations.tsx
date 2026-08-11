/**
 * Evaluations (Automations & quality) — THINK-700.
 *
 * Converted to the report restyle (Eric 2026-08-11). Claims verified
 * against the shipped code: packages/evals-core/src/scoring.ts (the
 * assertion switch — contains/not-contains/icontains/equals/regex/
 * llm-rubric — and summarizeEvalStatuses: pass ÷ (pass + fail), errors
 * excluded, all-error runs score null never 0%), packages/evals-core/src/
 * types.ts (case status exactly pass|fail|error), packages/evals-core/src/
 * trial-aggregation.ts (majority verdict; no majority → unstable, kept out
 * of the score), packages/database-pg/src/schema/evaluations.ts (runs pin
 * dataset_version + profile_snapshot + scoring_version at launch),
 * packages/api/src/lib/evals/engines/agentcore.ts (built-in evaluators
 * persist as skipped stubs — selectable, not yet scoring), packages/api/
 * src/graphql/resolvers/evaluations/index.ts (override requires a reason
 * and sits beside the judge's verdict; starter-pack seeding is idempotent
 * via a tenant+seed-name unique index), packages/api/src/lib/eval-seeds.ts
 * (the adversarial seed packs and their categories), and apps/web/src/
 * components/settings/{EvalTestCaseForm,SettingsEvaluations,
 * SettingsEvalStudio}.tsx (the six authoring assertion types, the 16
 * built-in evaluators, the 30-day trend, Compare profiles).
 *
 * Two things the old guide got wrong and this page must not repeat: the
 * Mastra/promptfoo framing is dead, and the AgentCore built-in evaluators
 * are selectable but not yet scoring — assertions are the grade today.
 */
import {
  DocLink,
  DocTable,
  PullQuote,
  ReportArticle,
  ReportSection,
  Term,
} from "../kit";
import { EvalLoopDiagram } from "../figures/automations";
import type { DocTocEntry } from "../registry";

export const EVALUATIONS_TOC: DocTocEntry[] = [
  { id: "what-a-run-proves", title: "What a run proves" },
  { id: "test-cases", title: "Writing a test case" },
  { id: "evaluators", title: "How a case is graded" },
  { id: "profiles-and-datasets", title: "Profiles and datasets" },
  { id: "reading-a-run", title: "Reading a run" },
  { id: "iterating", title: "Iterating" },
];

export function Evaluations() {
  return (
    <ReportArticle
      eyebrow="Automations & quality"
      title="Evaluations"
      lead="Evaluations are how you find out whether a change made the agent better, rather than hoping so: a stored question with a checkable expectation, run again after every edit."
    >
      <ReportSection id="what-a-run-proves" title="What a run proves">
        <p>
          Agent quality has an awkward property — it is invisible from the
          inside. An agent that reaches the wrong conclusion reaches it
          fluently, in the right format, at the usual length. Reading one answer
          tells you almost nothing; reading fifty tells you something, but you
          will not do that twice.
        </p>
        <p>
          An <strong>evaluation</strong> replaces the reading with a check. You
          store a question whose answer you already know, plus a rule the answer
          must satisfy. Then every time you edit an agent&apos;s instructions,
          install a <DocLink slug="skills">skill</DocLink>, or switch its model,
          you run the same questions again and get a number instead of a hunch.
        </p>
        <p>Three things this buys you that spot-checking does not:</p>
        <ul>
          <li>
            <strong>Changes get a verdict.</strong> Rewriting instructions is a
            bet. A stored set of cases turns the bet into a before-and-after on
            identical inputs.
          </li>
          <li>
            <strong>Regressions surface near their cause.</strong> A pass rate
            that steps down the day a skill was installed is a far better signal
            than a complaint three weeks later.
          </li>
          <li>
            <strong>Disagreements become tasks.</strong> &ldquo;The agent keeps
            leaking internal detail&rdquo; is an argument. A failing case named
            &ldquo;refuses to reveal system prompt&rdquo; is something someone
            can fix.
          </li>
        </ul>
        <p>
          Evaluations are an <strong>operator</strong> surface, under{" "}
          <strong>Settings → Evaluations</strong>. Underneath, the scoring layer
          is AWS Bedrock AgentCore Evaluations, which is why you will see
          AgentCore vocabulary on the screens — but nothing about authoring or
          reading a run requires you to think about it.
        </p>
      </ReportSection>

      <ReportSection id="test-cases" title="Writing a test case">
        <p>
          Cases live in <strong>Evaluation Studio</strong>. A case is small on
          purpose:
        </p>
        <DocTable
          head={["Field", "What to put in it"]}
          rows={[
            [
              <strong>Name</strong>,
              <>
                The behaviour, phrased as the thing that should happen —
                &ldquo;Refuses to reveal the system prompt&rdquo;. You will read
                this in a list of failures, not in context.
              </>,
            ],
            [
              <strong>Category</strong>,
              "Your grouping, and the unit a run is launched over. Keep one category to one concern — a pass rate is only interpretable if the cases inside it are about the same thing.",
            ],
            [
              <strong>User prompt</strong>,
              "What gets sent to the agent, exactly as a person would send it.",
            ],
            [
              <strong>System prompt override</strong>,
              "Optional. Leave it empty and the case runs against the agent's real instructions — which is usually the point.",
            ],
            [
              <strong>Assertions</strong>,
              <>
                The checkable part. A case passes only if <strong>every</strong>{" "}
                assertion passes.
              </>,
            ],
            [
              <strong>Enabled</strong>,
              "Disabled cases are skipped by every run. Better than deleting a case you are unsure about.",
            ],
          ]}
        />
        <p>
          There is no &ldquo;expected answer&rdquo; box, and that is deliberate.
          You are not asserting that the agent produces one exact paragraph —
          you are asserting the properties that paragraph must have.
        </p>
        <p>
          Studio also ships a <strong>starter pack</strong> of adversarial cases
          — prompt injection, tool misuse, data boundary, and safety and scope,
          among other packs. Importing it is a button, and re-importing is safe:
          it skips names it has already imported. It is the fastest way to have
          a meaningful set of cases on day one, but it is a floor, not a suite.
          The cases that catch <em>your</em> regressions are the ones drawn from
          questions your people actually asked.
        </p>
      </ReportSection>

      <ReportSection id="evaluators" title="How a case is graded">
        <p>
          Grading happens in two layers, and only one of them is doing work
          today.
        </p>
        <p>
          <strong>Assertions</strong> are yours, and they are what decides pass
          or fail. Six types:
        </p>
        <DocTable
          head={["Type", "Passes when", "Cost"]}
          rows={[
            [<code>contains</code>, "the answer contains this text", "free"],
            [
              <code>not-contains</code>,
              <>
                the answer does <em>not</em> contain it — the shape most safety
                cases take
              </>,
              "free",
            ],
            [<code>icontains</code>, "contains, ignoring case", "free"],
            [<code>equals</code>, "the answer is exactly this string", "free"],
            [
              <code>regex</code>,
              "a pattern matches — for shaped output like an ID or a date",
              "free",
            ],
            [
              <code>llm-rubric</code>,
              "a second model, acting as judge, agrees the answer meets a standard you wrote in plain English",
              "spends tokens",
            ],
          ]}
        />
        <p>
          Reach for <code>llm-rubric</code> only when the claim is genuinely
          about meaning — &ldquo;explains that damage must be reported within 48
          hours&rdquo; is not a substring test. Everything else should be
          structural: exact, free, and stable across reruns. And nothing passes
          vacuously: if the judge cannot run, a rubric assertion is recorded as
          an <strong>error</strong>, never as a pass — which matters most for
          the negative cases, where &ldquo;must not leak the system
          prompt&rdquo; must never turn green because the grader was broken.
        </p>
        <p>
          <strong>Built-in evaluators</strong> are the second layer. When you
          author a case you can tick any of the sixteen evaluators Bedrock
          AgentCore provides — helpfulness, correctness, faithfulness, response
          relevance, conciseness, coherence, instruction following, refusal,
          harmfulness and stereotyping over the answer; tool-selection and
          tool-parameter accuracy over the calls it made; and goal success plus
          three trajectory-match evaluators over the whole session. But ticking
          an evaluator today records it on the case and shows it on the result
          as <strong>skipped</strong>. Turning them on is a deliberate follow-up
          with its own cost controls, because each evaluator is another model
          call per case.
        </p>
        <PullQuote who="the grading layer, honestly stated">
          Until the built-in evaluators are switched on, your assertions are the
          grade — a case with no assertions and four evaluators ticked proves
          nothing.
        </PullQuote>
      </ReportSection>

      <ReportSection id="profiles-and-datasets" title="Profiles and datasets">
        <p>
          Two small objects exist so that a comparison between two runs is
          honest.
        </p>
        <p>
          A <strong>profile</strong> is the configuration under test: which
          model answers, which model judges, and how many trials each rubric
          case gets. A run <em>pins</em> a snapshot of the profile the moment it
          launches, so editing a profile afterwards cannot retroactively change
          what a past run meant. One profile is the default; that is the one
          used when something other than a person starts a run.
        </p>
        <p>
          Trials are the answer to flaky cases. Set trials above one and a
          rubric case runs several times, and the majority verdict wins. A case
          whose trials split with no majority is marked{" "}
          <strong>unstable</strong> and left out of the score rather than
          rounded into it — because &ldquo;this behaviour is not
          reproducible&rdquo; is a different finding from &ldquo;this behaviour
          is wrong&rdquo;.
        </p>
        <p>
          A <strong>dataset</strong> is a named, versioned collection of cases
          you want to run as a unit. Launching against a dataset pins its
          current version, so edits made mid-run cannot change what is being
          scored, and two runs of &ldquo;v3&rdquo; are comparable by
          construction. <strong>Compare profiles</strong> puts the latest
          completed run per profile on one dataset side by side — verdict
          counts, cost per case, latency — and flags when the two are not really
          comparable because a version or a judge drifted between them.
        </p>
      </ReportSection>

      <ReportSection id="reading-a-run" title="Reading a run">
        <p>
          <strong>Run evaluation</strong> asks for three things: a profile, then
          either a set of categories or one dataset. Runs execute case by case,
          so a slow case does not hold up the rest, and the page updates live
          while it goes.
        </p>
        <EvalLoopDiagram />
        <p>Every case lands in one of three states, and the last two differ:</p>
        <ul>
          <li>
            <strong>pass</strong> — every assertion held.
          </li>
          <li>
            <strong>fail</strong> — the agent answered and the answer was wrong.
            A quality signal.
          </li>
          <li>
            <strong>error</strong> — the agent did not answer, or the grader
            could not grade: a timeout, a throttle, a judge failure. An
            infrastructure signal.
          </li>
        </ul>
        <p>
          Errors are <strong>excluded</strong> from the pass rate, which is{" "}
          <code>pass ÷ (pass + fail)</code>. A run where half the cases timed
          out does not report 50% quality; it reports the quality of what
          actually ran, next to a visible error count. And a run where nothing
          scored at all reports <strong>No score</strong> rather than 0% —
          &ldquo;we could not measure&rdquo; and &ldquo;we measured zero&rdquo;
          are different facts and must never be plotted as the same point.
        </p>
        <p>
          So read the error count before the pass rate: a rate computed over
          four scored cases is noise wearing a percentage sign. The run header
          shows passed, failed, errored and unstable together for exactly this
          reason — and each of those counts is clickable, so &ldquo;show me only
          the behavioural failures&rdquo; is one click.
        </p>
        <p>What to look at, in order:</p>
        <ol>
          <li>
            <strong>The trend, not the run.</strong> The dashboard plots pass
            rate over the last 30 days. One run tells you very little; a step
            down on a specific day tells you what to correlate against.
          </li>
          <li>
            <strong>Errors and unstable cases.</strong> If either is
            non-trivial, the pass rate is over a smaller sample than it looks.
          </li>
          <li>
            <strong>The assertion that failed,</strong> in the result detail —
            with the actual output next to it, which is usually where the answer
            is.
          </li>
          <li>
            <strong>The trace,</strong> when the output is surprising. It shows
            what the agent did to produce it, not just what it said.
          </li>
        </ol>
        <p>
          When the grader is wrong — and a model judge sometimes is — an
          operator can <strong>override</strong> a verdict with a required
          reason. The override is stored beside the original rather than
          replacing it, so the judge&apos;s call stays on the record. Treat an
          override as a temporary patch: the fix is to reword the rubric so the
          next run does not need one. A category accumulating standing overrides
          has a rubric problem, not a grading problem.
        </p>
      </ReportSection>

      <ReportSection id="iterating" title="Iterating">
        <p>
          The loop is worth naming because most teams do the first three steps
          and stop. Author a case, run it, read it — and then nothing changes,
          so the next run says the same thing.
        </p>
        <p>A failing case has three honest resolutions, and only three:</p>
        <ul>
          <li>
            <strong>Fix the agent.</strong> Sharpen the{" "}
            <Term id="instructions">instructions</Term>, install or narrow a{" "}
            <DocLink slug="skills">skill</DocLink>, or adjust what the agent can
            see. This is the one you want most of the time.
          </li>
          <li>
            <strong>Fix the case.</strong> The assertion was testing your
            phrasing rather than the behaviour, or the rubric was ambiguous
            enough that a reasonable judge could go either way.
          </li>
          <li>
            <strong>Change the expectation on purpose.</strong> The behaviour
            you wanted last quarter is not the behaviour you want now. Update
            the case deliberately and say so.
          </li>
        </ul>
        <PullQuote who="the one move that destroys the whole set">
          Never edit a case just to make a run green. The moment cases are tuned
          to the current behaviour, the pass rate stops measuring quality and
          starts measuring how recently someone edited the cases.
        </PullQuote>
        <p>Habits that make a set of cases worth keeping:</p>
        <ol>
          <li>
            <strong>Start from real questions</strong> — what people actually
            asked the agent this month. Invented questions test an imagined
            agent.
          </li>
          <li>
            <strong>One concern per category,</strong> since a category is the
            unit you launch and compare.
          </li>
          <li>
            <strong>Prefer structural assertions.</strong> Free, exact, stable.
            Rubrics only for claims about meaning.
          </li>
          <li>
            <strong>Include negatives.</strong> A set of only positive cases
            cannot detect an agent that became more willing to answer
            everything.
          </li>
          <li>
            <strong>Run at the moments that matter</strong> — after an
            instruction change, after a skill install, after a model switch.
            Runs are launched by hand, so the discipline is yours to keep.
          </li>
        </ol>
        <p>
          The natural partner to this page is{" "}
          <DocLink slug="automations">automations</DocLink>: unattended work is
          exactly the work nobody re-reads, and therefore exactly the work worth
          pinning down with cases. For the bounds that stop a bad answer from
          becoming a bad action, see{" "}
          <DocLink slug="approvals-and-guardrails">
            approvals and guardrails
          </DocLink>
          .
        </p>
      </ReportSection>
    </ReportArticle>
  );
}
