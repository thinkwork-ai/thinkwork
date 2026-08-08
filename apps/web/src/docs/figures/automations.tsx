/**
 * Figures for the "Automations & quality" section (THINK-700).
 *
 * Two pictures, both drawn from the primitives in ../diagrams so they sit
 * in the same drawing surface as every other figure in the docs:
 *
 *  - ScheduleAnchorDiagram — why "every four hours" and "every day at 9"
 *    behave differently. An interval counts from the moment you saved the
 *    automation; a daily/weekly preset is pinned to the clock. This is the
 *    single thing people get wrong about scheduling, and it is much easier
 *    to see on a timeline than to read in a sentence.
 *  - EvalLoopDiagram — evaluations as the loop they actually are: author,
 *    run, score, read, fix, run the same cases again. Drawn as a vertical
 *    column with a return spine so the "again" is part of the picture.
 */
import { Diagram, DgArrow, DgBox, DgChip, DgLabel } from "../diagrams";

/**
 * The scheduling gotcha, on two timelines that start at the same instant.
 */
export function ScheduleAnchorDiagram() {
  return (
    <Diagram
      title="An interval schedule counts forward from the moment the automation was saved, while a daily preset fires at the same wall-clock time regardless of when it was saved"
      viewBox="0 0 860 232"
      caption="Both automations were created at the same moment, 10:20. The interval one inherits that 10:20 forever — and picks up a new offset every time you save it again. The daily preset ignores when you saved it and fires at 09:00 UTC."
    >
      <DgLabel x={20} y={20} text="Interval — every 4 hours" />
      <DgBox
        x={20}
        y={32}
        w={150}
        h={44}
        title="Saved 10:20"
        sub="you press Create"
        tone="source"
      />
      <DgChip x={20} y={84} label="counts from save" tone="source" />
      <DgArrow d="M 178 54 L 826 54" />
      <DgBox x={252} y={36} w={92} h={36} title="14:20" tone="compute" />
      <DgBox x={402} y={36} w={92} h={36} title="18:20" tone="compute" />
      <DgBox x={552} y={36} w={92} h={36} title="22:20" tone="compute" />
      <DgBox x={702} y={36} w={92} h={36} title="02:20" tone="compute" />

      <DgLabel x={20} y={132} text="Daily preset — 9:00 AM" />
      <DgBox
        x={20}
        y={144}
        w={150}
        h={44}
        title="Saved 10:20"
        sub="the same moment"
        tone="source"
      />
      <DgChip x={20} y={196} label="anchored to the clock" tone="source" />
      <DgArrow d="M 178 166 L 826 166" />
      <DgBox x={302} y={148} w={122} h={36} title="Tue 09:00" tone="graph" />
      <DgBox x={492} y={148} w={122} h={36} title="Wed 09:00" tone="graph" />
      <DgBox x={682} y={148} w={122} h={36} title="Thu 09:00" tone="graph" />
    </Diagram>
  );
}

/**
 * The evaluation loop. Vertical column, return spine on the left, so the
 * re-run edge is drawn rather than implied by a numbered list.
 */
export function EvalLoopDiagram() {
  return (
    <Diagram
      title="A test case is authored, run against the agent, scored by assertions and judged rubrics, read as a pass rate that excludes errors, and fed back into the instructions before the same cases are run again"
      viewBox="0 0 500 566"
      caption="The loop only pays off if the last edge is real. A run that nobody reads, or a fix that never gets re-scored against the same cases, is a number without a decision attached to it."
    >
      <DgBox
        x={120}
        y={20}
        w={340}
        h={82}
        title="Write a test case"
        sub="a prompt, plus what must be true of the answer"
        tone="source"
        align="top"
      />
      <DgChip x={138} y={66} label="contains" tone="source" />
      <DgChip x={205} y={66} label="regex" tone="source" />
      <DgChip x={255} y={66} label="llm-rubric" tone="source" />

      <DgArrow
        d="M 290 102 L 290 136"
        label="give it a category"
        labelAt={[290, 119]}
      />

      <DgBox
        x={120}
        y={136}
        w={340}
        h={82}
        title="Start a run"
        sub="a profile, then categories or one dataset"
        tone="compute"
        align="top"
      />
      <DgChip x={138} y={182} label="model pinned" tone="compute" />
      <DgChip x={227} y={182} label="judge pinned" tone="compute" />
      <DgChip x={316} y={182} label="trials" tone="compute" />

      <DgArrow
        d="M 290 218 L 290 252"
        label="one row per case"
        labelAt={[290, 235]}
      />

      <DgBox
        x={120}
        y={252}
        w={340}
        h={82}
        title="Every case is scored"
        sub="assertions checked, rubrics judged by a model"
        tone="compute"
        align="top"
      />
      <DgChip x={138} y={298} label="pass" tone="graph" />
      <DgChip x={182} y={298} label="fail" tone="consumer" />
      <DgChip x={226} y={298} label="error" />

      <DgArrow d="M 290 334 L 290 368" label="roll up" labelAt={[290, 351]} />

      <DgBox
        x={120}
        y={368}
        w={340}
        h={82}
        title="Read the run"
        sub="pass ÷ (pass + fail)"
        tone="graph"
        align="top"
      />
      <DgChip x={138} y={414} label="errors excluded" />
      <DgChip x={244} y={414} label="unstable excluded" />

      <DgArrow d="M 290 450 L 290 484" label="diagnose" labelAt={[290, 467]} />

      <DgBox
        x={120}
        y={484}
        w={340}
        h={56}
        title="Change the instructions, a skill, or the case"
        sub="then run the same cases again"
        tone="consumer"
      />

      <DgArrow
        d="M 120 512 L 58 512 Q 50 512 50 504 L 50 69 Q 50 61 58 61 L 112 61"
        label="re-run"
        labelAt={[50, 290]}
      />
    </Diagram>
  );
}
