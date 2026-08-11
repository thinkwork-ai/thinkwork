/**
 * Figures for the "Automations & quality" section (THINK-700), redrawn in
 * the report figure language (2026-08-11 docs overhaul; modeled on
 * figures/memory.tsx → ConsolidationLoopFigure): fill-card boxes with teal
 * strokes, muted edges with italic 11px labels, a unique marker id per
 * figure, and SVGs that scale to the column rather than scroll.
 *
 *  - ScheduleAnchorDiagram (marker `sa-arr`) — why "every four hours" and
 *    "every day at 9" behave differently. An interval counts forward from
 *    the moment the automation was saved (AWS Scheduler rate() semantics,
 *    packages/lambda/job-schedule-manager.ts); a daily preset is pinned to
 *    the clock. Easier to see on two timelines than to read in a sentence.
 *  - EvalLoopDiagram (marker `el-arr`) — the evaluation loop drawn as a
 *    loop: author, run, score, read, fix, and a real return edge back to
 *    the run. Scoring semantics per packages/evals-core/src/scoring.ts
 *    (errors excluded from the pass rate).
 *
 * No amber in either figure on purpose: nothing here is a human gate.
 */

/**
 * The scheduling gotcha, on two timelines that start at the same instant.
 */
export function ScheduleAnchorDiagram() {
  return (
    <figure className="pt-1">
      {/* The SVG scales to its column rather than scrolling. */}
      <div>
        <svg
          viewBox="0 0 760 272"
          role="img"
          aria-label="Two automations saved at the same moment, 10:20. The interval schedule fires at 14:20, 18:20 and 22:20 — counting from the save. The daily preset fires at 09:00 each day, anchored to the clock."
          className="block h-auto w-full"
        >
          <defs>
            <marker
              id="sa-arr"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 9 5 L 0 9 z" className="fill-muted-foreground" />
            </marker>
          </defs>

          {/* Lane 1: the interval schedule */}
          <text
            x="20"
            y="24"
            className="fill-foreground font-sans text-[12px] font-semibold"
          >
            Interval — every 4 hours
          </text>
          <line
            x1="170"
            y1="68"
            x2="742"
            y2="68"
            className="stroke-muted-foreground"
            strokeWidth="1.3"
            markerEnd="url(#sa-arr)"
          />
          <rect
            x="20"
            y="40"
            width="150"
            height="56"
            rx="8"
            className="fill-card stroke-teal-400/50"
            strokeWidth="1.5"
          />
          <text
            x="34"
            y="64"
            className="fill-foreground font-sans text-[14px] font-semibold"
          >
            Saved 10:20
          </text>
          <text
            x="34"
            y="82"
            className="fill-muted-foreground font-sans text-[11px]"
          >
            you press Create
          </text>

          <rect
            x="248"
            y="48"
            width="96"
            height="40"
            rx="8"
            className="fill-card stroke-teal-400/50"
            strokeWidth="1.5"
          />
          <text
            x="270"
            y="72"
            className="fill-foreground font-sans text-[13px] font-semibold"
          >
            14:20
          </text>
          <rect
            x="408"
            y="48"
            width="96"
            height="40"
            rx="8"
            className="fill-card stroke-teal-400/50"
            strokeWidth="1.5"
          />
          <text
            x="430"
            y="72"
            className="fill-foreground font-sans text-[13px] font-semibold"
          >
            18:20
          </text>
          <rect
            x="568"
            y="48"
            width="96"
            height="40"
            rx="8"
            className="fill-card stroke-teal-400/50"
            strokeWidth="1.5"
          />
          <text
            x="590"
            y="72"
            className="fill-foreground font-sans text-[13px] font-semibold"
          >
            22:20
          </text>

          <text
            x="20"
            y="118"
            className="fill-muted-foreground font-sans text-[11px] italic"
          >
            counts forward from the save — editing restarts the clock
          </text>

          {/* Lane 2: the daily preset */}
          <text
            x="20"
            y="164"
            className="fill-foreground font-sans text-[12px] font-semibold"
          >
            Daily preset — 9:00 AM
          </text>
          <line
            x1="170"
            y1="208"
            x2="742"
            y2="208"
            className="stroke-muted-foreground"
            strokeWidth="1.3"
            markerEnd="url(#sa-arr)"
          />
          <rect
            x="20"
            y="180"
            width="150"
            height="56"
            rx="8"
            className="fill-card stroke-teal-400/50"
            strokeWidth="1.5"
          />
          <text
            x="34"
            y="204"
            className="fill-foreground font-sans text-[14px] font-semibold"
          >
            Saved 10:20
          </text>
          <text
            x="34"
            y="222"
            className="fill-muted-foreground font-sans text-[11px]"
          >
            the same moment
          </text>

          <rect
            x="248"
            y="188"
            width="112"
            height="40"
            rx="8"
            className="fill-card stroke-teal-400/50"
            strokeWidth="1.5"
          />
          <text
            x="264"
            y="212"
            className="fill-foreground font-sans text-[13px] font-semibold"
          >
            Tue 09:00
          </text>
          <rect
            x="408"
            y="188"
            width="112"
            height="40"
            rx="8"
            className="fill-card stroke-teal-400/50"
            strokeWidth="1.5"
          />
          <text
            x="424"
            y="212"
            className="fill-foreground font-sans text-[13px] font-semibold"
          >
            Wed 09:00
          </text>
          <rect
            x="568"
            y="188"
            width="112"
            height="40"
            rx="8"
            className="fill-card stroke-teal-400/50"
            strokeWidth="1.5"
          />
          <text
            x="584"
            y="212"
            className="fill-foreground font-sans text-[13px] font-semibold"
          >
            Thu 09:00
          </text>

          <text
            x="20"
            y="258"
            className="fill-muted-foreground font-sans text-[11px] italic"
          >
            anchored to the clock — the save moment is irrelevant
          </text>
        </svg>
      </div>
      <figcaption className="mt-2 font-sans text-[13px] leading-6 text-muted-foreground">
        Both automations were created at the same moment. The interval one
        inherits that 10:20 forever — and picks up a new offset every time it is
        saved again. The daily preset ignores when it was saved and fires at
        09:00 UTC.
      </figcaption>
    </figure>
  );
}

/**
 * The evaluation loop, drawn as a loop. The return edge from "fix" back to
 * "run" is the point of the picture: the same cases, run again, are what
 * turn an edit into a verdict.
 */
export function EvalLoopDiagram() {
  return (
    <figure className="pt-1">
      {/* The SVG scales to its column rather than scrolling. */}
      <div>
        <svg
          viewBox="0 0 760 320"
          role="img"
          aria-label="The evaluation loop: write a test case, start a run, every case is scored, the run is read as a pass rate that excludes errors, something is fixed, and the same cases are run again — a return edge closes the loop."
          className="block h-auto w-full"
        >
          <defs>
            <marker
              id="el-arr"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 9 5 L 0 9 z" className="fill-muted-foreground" />
            </marker>
          </defs>

          {/* top row: write → run → score */}
          <rect
            x="20"
            y="36"
            width="180"
            height="62"
            rx="8"
            className="fill-card stroke-teal-400/50"
            strokeWidth="1.5"
          />
          <text
            x="36"
            y="62"
            className="fill-foreground font-sans text-[15px] font-semibold"
          >
            1 · Write a case
          </text>
          <text
            x="36"
            y="82"
            className="fill-muted-foreground font-sans text-[11px]"
          >
            a prompt, plus what must be true
          </text>

          <rect
            x="290"
            y="36"
            width="180"
            height="62"
            rx="8"
            className="fill-card stroke-teal-400/50"
            strokeWidth="1.5"
          />
          <text
            x="306"
            y="62"
            className="fill-foreground font-sans text-[15px] font-semibold"
          >
            2 · Start a run
          </text>
          <text
            x="306"
            y="82"
            className="fill-muted-foreground font-sans text-[11px]"
          >
            profile and dataset version pinned
          </text>

          <rect
            x="560"
            y="36"
            width="180"
            height="62"
            rx="8"
            className="fill-card stroke-teal-400/50"
            strokeWidth="1.5"
          />
          <text
            x="576"
            y="62"
            className="fill-foreground font-sans text-[15px] font-semibold"
          >
            3 · Score
          </text>
          <text
            x="576"
            y="82"
            className="fill-muted-foreground font-sans text-[11px]"
          >
            pass · fail · error, per case
          </text>

          <line
            x1="200"
            y1="67"
            x2="284"
            y2="67"
            className="stroke-muted-foreground"
            strokeWidth="1.3"
            markerEnd="url(#el-arr)"
          />
          <text
            x="216"
            y="58"
            className="fill-muted-foreground font-sans text-[11px] italic"
          >
            a category
          </text>
          <line
            x1="470"
            y1="67"
            x2="554"
            y2="67"
            className="stroke-muted-foreground"
            strokeWidth="1.3"
            markerEnd="url(#el-arr)"
          />
          <text
            x="478"
            y="58"
            className="fill-muted-foreground font-sans text-[11px] italic"
          >
            case by case
          </text>

          {/* bottom row: read ← score, fix ← read */}
          <rect
            x="560"
            y="176"
            width="180"
            height="62"
            rx="8"
            className="fill-card stroke-teal-400/50"
            strokeWidth="1.5"
          />
          <text
            x="576"
            y="202"
            className="fill-foreground font-sans text-[15px] font-semibold"
          >
            4 · Read the run
          </text>
          <text
            x="576"
            y="222"
            className="fill-muted-foreground font-sans text-[11px]"
          >
            pass ÷ (pass + fail), errors apart
          </text>

          <line
            x1="650"
            y1="98"
            x2="650"
            y2="170"
            className="stroke-muted-foreground"
            strokeWidth="1.3"
            markerEnd="url(#el-arr)"
          />
          <text
            x="660"
            y="138"
            className="fill-muted-foreground font-sans text-[11px] italic"
          >
            roll up
          </text>

          <rect
            x="290"
            y="176"
            width="180"
            height="62"
            rx="8"
            className="fill-card stroke-teal-400/50"
            strokeWidth="1.5"
          />
          <text
            x="306"
            y="202"
            className="fill-foreground font-sans text-[15px] font-semibold"
          >
            5 · Fix something
          </text>
          <text
            x="306"
            y="222"
            className="fill-muted-foreground font-sans text-[11px]"
          >
            the agent, the case, or the bar
          </text>

          <line
            x1="554"
            y1="207"
            x2="476"
            y2="207"
            className="stroke-muted-foreground"
            strokeWidth="1.3"
            markerEnd="url(#el-arr)"
          />
          <text
            x="482"
            y="198"
            className="fill-muted-foreground font-sans text-[11px] italic"
          >
            diagnose
          </text>

          {/* the return edge — the loop */}
          <line
            x1="380"
            y1="176"
            x2="380"
            y2="104"
            className="stroke-muted-foreground"
            strokeWidth="1.3"
            markerEnd="url(#el-arr)"
          />
          <text
            x="180"
            y="144"
            className="fill-muted-foreground font-sans text-[11px] italic"
          >
            run the same cases again
          </text>
        </svg>
      </div>
      <figcaption className="mt-2 font-sans text-[13px] leading-6 text-muted-foreground">
        The loop only pays off if the return edge is real. A run that nobody
        reads, or a fix that never gets re-scored against the same cases, is a
        number without a decision attached to it.
      </figcaption>
    </figure>
  );
}
