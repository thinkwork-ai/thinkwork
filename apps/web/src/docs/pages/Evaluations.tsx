/**
 * Evaluations (Automations & quality) — THINK-700.
 *
 * Grounded in the shipped surface: /settings/evaluations, its Studio,
 * profiles, datasets and run detail. Two things the old guide got wrong
 * and this page must not repeat: the Mastra/promptfoo framing is dead, and
 * the AgentCore built-in evaluators are selectable but not yet scoring —
 * they persist as skipped rows, so the honest statement is that assertions
 * are what grade a run today.
 */
import { Callout, DocArticle, DocLink, Section, Term } from "../kit";
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
    <DocArticle
      eyebrow="Automations & quality"
      title="Evaluations"
      lead="Evaluations are how you find out whether a change made the agent better, rather than hoping so: a stored question with a checkable expectation, run again after every edit."
    >
      <Section id="what-a-run-proves" title="What a run proves">
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

        <Callout tone="note" title="Where this lives">
          <p>
            Evaluations are an <strong>operator</strong> surface, under{" "}
            <strong>Settings → Evaluations</strong>. Underneath, the scoring
            layer is AWS Bedrock AgentCore Evaluations, which is why you will
            see AgentCore vocabulary on the screens — but nothing about
            authoring or reading a run requires you to think about it.
          </p>
        </Callout>
      </Section>

      <Section id="test-cases" title="Writing a test case">
        <p>
          Cases live in <strong>Evaluation Studio</strong>. A case is small on
          purpose:
        </p>

        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/20 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Field</th>
                <th className="px-3 py-2 font-medium">What to put in it</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60 text-[13px] [&_td]:px-3 [&_td]:py-2">
              <tr>
                <td className="font-medium whitespace-nowrap">Name</td>
                <td className="text-foreground/80">
                  The behaviour, phrased as the thing that should happen —
                  &ldquo;Refuses to reveal the system prompt&rdquo;. You will
                  read this in a list of failures, not in context.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">Category</td>
                <td className="text-foreground/80">
                  Your grouping, and the unit a run is launched over. Keep one
                  category to one concern — a pass rate is only interpretable if
                  the cases inside it are about the same thing.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">User prompt</td>
                <td className="text-foreground/80">
                  What gets sent to the agent, exactly as a person would send
                  it.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">
                  System prompt override
                </td>
                <td className="text-foreground/80">
                  Optional. Leave it empty and the case runs against the
                  agent&apos;s real instructions — which is usually the point.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">Assertions</td>
                <td className="text-foreground/80">
                  The checkable part. A case passes only if{" "}
                  <strong>every</strong> assertion passes.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">Enabled</td>
                <td className="text-foreground/80">
                  Disabled cases are skipped by every run. Better than deleting
                  a case you are unsure about.
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <p>
          There is no &ldquo;expected answer&rdquo; box, and that is deliberate.
          You are not asserting that the agent produces one exact paragraph —
          you are asserting the properties that paragraph must have.
        </p>

        <p>
          Studio also ships a <strong>starter pack</strong> of adversarial cases
          across four categories — prompt injection, tool misuse, data boundary,
          and safety and scope. Importing it is a button, and re-importing is
          safe: it skips names it has already imported. It is the fastest way to
          have a meaningful set of cases on day one, but it is a floor, not a
          suite. The cases that catch <em>your</em> regressions are the ones
          drawn from questions your people actually asked.
        </p>
      </Section>

      <Section id="evaluators" title="How a case is graded">
        <p>
          Grading happens in two layers, and only one of them is doing work
          today.
        </p>
        <p>
          <strong>Assertions</strong> are yours, and they are what decides pass
          or fail. Six types:
        </p>

        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/20 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Passes when</th>
                <th className="px-3 py-2 font-medium">Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60 text-[13px] [&_td]:px-3 [&_td]:py-2">
              <tr>
                <td className="font-mono text-xs whitespace-nowrap">
                  contains
                </td>
                <td className="text-foreground/80">
                  the answer contains this text
                </td>
                <td className="text-muted-foreground">free</td>
              </tr>
              <tr>
                <td className="font-mono text-xs whitespace-nowrap">
                  not-contains
                </td>
                <td className="text-foreground/80">
                  the answer does <em>not</em> contain it — the shape most
                  safety cases take
                </td>
                <td className="text-muted-foreground">free</td>
              </tr>
              <tr>
                <td className="font-mono text-xs whitespace-nowrap">
                  icontains
                </td>
                <td className="text-foreground/80">contains, ignoring case</td>
                <td className="text-muted-foreground">free</td>
              </tr>
              <tr>
                <td className="font-mono text-xs whitespace-nowrap">equals</td>
                <td className="text-foreground/80">
                  the answer is exactly this string
                </td>
                <td className="text-muted-foreground">free</td>
              </tr>
              <tr>
                <td className="font-mono text-xs whitespace-nowrap">regex</td>
                <td className="text-foreground/80">
                  a pattern matches — for shaped output like an ID or a date
                </td>
                <td className="text-muted-foreground">free</td>
              </tr>
              <tr>
                <td className="font-mono text-xs whitespace-nowrap">
                  llm-rubric
                </td>
                <td className="text-foreground/80">
                  a second model, acting as judge, agrees the answer meets a
                  standard you wrote in plain English
                </td>
                <td className="text-muted-foreground">spends tokens</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p>
          Reach for <code>llm-rubric</code> only when the claim is genuinely
          about meaning — &ldquo;explains that damage must be reported within 48
          hours&rdquo; is not a substring test. Everything else should be
          structural: exact, free, and stable across reruns.
        </p>

        <Callout tone="warn" title="Nothing passes vacuously">
          <p>
            If the judge cannot run, a rubric assertion is recorded as an{" "}
            <strong>error</strong> — never as a pass. This matters most for the
            negative cases: &ldquo;must not leak the system prompt&rdquo; must
            never turn green because the grader was broken.
          </p>
        </Callout>

        <p>
          <strong>Built-in evaluators</strong> are the second layer. When you
          author a case you can tick any of the sixteen evaluators Bedrock
          AgentCore provides — helpfulness, correctness, faithfulness, response
          relevance, conciseness, coherence, instruction following, refusal,
          harmfulness and stereotyping over the answer; tool-selection and
          tool-parameter accuracy over the calls it made; and goal success plus
          three trajectory-match evaluators over the whole session.
        </p>

        <Callout
          tone="warn"
          title="Built-in evaluators are selectable, but not yet scoring"
        >
          <p>
            Ticking an evaluator today records it on the case and shows it on
            the result as <strong>skipped</strong>. Turning them on is a
            deliberate follow-up with its own cost controls, because each
            evaluator is another model call per case. Until then,{" "}
            <strong>your assertions are the grade</strong> — a case with no
            assertions and four evaluators ticked proves nothing.
          </p>
        </Callout>
      </Section>

      <Section id="profiles-and-datasets" title="Profiles and datasets">
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
      </Section>

      <Section id="reading-a-run" title="Reading a run">
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

        <Callout tone="tip" title="Read the error count before the pass rate">
          <p>
            A rate computed over four scored cases is noise wearing a percentage
            sign. The run header shows passed, failed, errored and unstable
            together for exactly this reason — and each of those counts is
            clickable, so &ldquo;show me only the behavioural failures&rdquo; is
            one click.
          </p>
        </Callout>

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
      </Section>

      <Section id="iterating" title="Iterating">
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

        <Callout tone="warn" title="Never edit a case just to make a run green">
          <p>
            It is the one move that destroys the value of the whole set. The
            moment cases are tuned to the current behaviour, the pass rate stops
            measuring quality and starts measuring how recently someone edited
            the cases.
          </p>
        </Callout>

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
      </Section>
    </DocArticle>
  );
}
