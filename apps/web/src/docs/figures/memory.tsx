/**
 * Figures for the Memory section (THINK-698).
 *
 * Two pictures, both vertical, both drawn from the shipped behaviour:
 *  - MemoryFlowDiagram — a turn's transcript becomes extracted memory,
 *    consolidation rewrites the requester's notes, and both reach later
 *    turns by different routes (a tool call vs. a mounted file).
 *  - ContextCompositionDiagram — what is already in front of the model
 *    when a turn starts, versus what the model has to go and fetch.
 *
 * House rules live in ./README.md: Dg* primitives only, tones for the five
 * roles, 13/11/10px type, one <title> per figure.
 */
import { Diagram, DgArrow, DgBox, DgChip, DgGroup, DgLabel } from "../diagrams";

/**
 * The write path and the two read paths, in one column. The dashed lane on
 * the right is the point of the picture: extracted memory reaches a later
 * turn only because the agent asks for it, while consolidated notes are
 * simply there.
 */
export function MemoryFlowDiagram() {
  return (
    <Diagram
      title="A turn is handed to AgentCore Memory after it ends; background extraction fills the namespaces; consolidation rewrites the requester's notes; later turns reach both by different routes"
      viewBox="0 0 680 690"
      caption="Two things happen after a turn, and neither of them blocks your answer. The engine extracts on its own schedule; the consolidation passes rewrite markdown you can read. A later turn recalls the first by calling a tool, and gets the second for free as mounted files."
    >
      <DgLabel x={20} y={22} text="During the turn" />

      <DgBox
        x={180}
        y={34}
        w={320}
        h={52}
        title="A turn in a thread"
        sub="your message, the agent's answer"
        tone="source"
      />
      <DgBox
        x={20}
        y={116}
        w={132}
        h={52}
        title="remember()"
        sub="on request"
        tone="compute"
      />

      <DgLabel x={20} y={104} text="After it ends" />
      <DgArrow d="M 340 86 L 340 112" label="transcript" labelAt={[340, 99]} />

      <DgBox
        x={180}
        y={116}
        w={320}
        h={52}
        title="Retain"
        sub="one background invoke — your answer already shipped"
        tone="compute"
      />

      <DgArrow
        d="M 340 168 L 340 200"
        label="CreateEvent"
        labelAt={[340, 184]}
      />
      {/* the explicit shelf writes straight into the store */}
      <DgArrow d="M 86 168 L 86 262 L 136 262" dashed />

      <DgBox
        x={140}
        y={206}
        w={400}
        h={126}
        title="Bedrock AgentCore Memory"
        sub="background extraction, asynchronous and selective"
        tone="storage"
        align="top"
      />
      <DgChip x={158} y={258} label="facts" tone="storage" />
      <DgChip x={222} y={258} label="preferences" tone="storage" />
      <DgChip x={330} y={258} label="asked to remember" tone="storage" />
      <DgChip x={158} y={290} label="session summary" tone="neutral" />
      <DgChip x={288} y={290} label="episodes + reflections" tone="neutral" />

      <DgLabel x={20} y={370} text="Overnight" />
      <DgArrow d="M 340 332 L 340 388" label="read back" labelAt={[340, 360]} />

      <DgBox
        x={180}
        y={392}
        w={320}
        h={52}
        title="Idle learner + nightly consolidation"
        sub="notice, reflect, promote, compact"
        tone="compute"
      />

      <DgArrow d="M 340 444 L 340 476" />

      <DgBox
        x={140}
        y={482}
        w={400}
        h={100}
        title="Your memory notes"
        sub="markdown in your workspace, versioned on every write"
        tone="graph"
        align="top"
      />
      <DgChip x={158} y={534} label="MEMORY.md" tone="graph" />
      <DgChip x={252} y={534} label="DREAMS.md" tone="graph" />
      <DgChip x={346} y={534} label="candidates/" tone="graph" />
      <DgChip x={444} y={534} label="working/" tone="graph" />

      <DgLabel x={20} y={608} text="Later turns" />
      <DgArrow d="M 340 582 L 340 620" label="mounted" labelAt={[340, 601]} />

      <DgBox
        x={180}
        y={626}
        w={320}
        h={52}
        title="The next turn, in any thread"
        tone="consumer"
      />

      {/* the recall lane: extracted memory only arrives if the agent asks */}
      <DgArrow
        d="M 540 262 L 604 262 L 604 652 L 504 652"
        dashed
        label="recall(query)"
        labelAt={[604, 420]}
      />

      <DgGroup x={20} y={626} w={132} h={52} />
      <text x={34} y={648} fontSize="10" fill="var(--muted-foreground)">
        Notes sit in the
      </text>
      <text x={34} y={664} fontSize="10" fill="var(--muted-foreground)">
        workspace; memory
      </text>
      <text x={34} y={680} fontSize="10" fill="var(--muted-foreground)">
        has to be asked for.
      </text>
    </Diagram>
  );
}

/**
 * What the model is holding when a turn begins, in the order the composer
 * actually emits it, versus what the model has to go and fetch. The split
 * between the two upper bands and the lower one is the whole point.
 */
export function ContextCompositionDiagram() {
  return (
    <Diagram
      title="The system prompt is assembled in a fixed order from policy blocks, workspace files and rosters; the turn prompt adds the date, the requester and recent history; skill bodies, memory and outside data are fetched with tools during the turn"
      viewBox="0 0 680 716"
      caption="Everything in the two upper bands is in front of the model before it writes a token. Everything in the lower band costs a tool call — which is why an agent that 'should have known' something often simply never went and looked."
    >
      <DgGroup
        x={20}
        y={26}
        w={640}
        h={386}
        label="In the system prompt, in this order"
      />

      <DgBox
        x={40}
        y={56}
        w={600}
        h={44}
        title="Requester profile policy"
        sub="use the profile file first; use memory tools when asked to prove it"
        tone="neutral"
      />
      <DgBox
        x={40}
        y={108}
        w={600}
        h={44}
        title="Tool policy"
        sub="written from the tools this turn actually has"
        tone="compute"
      />
      <DgBox
        x={40}
        y={160}
        w={600}
        h={44}
        title="Sub-agent roster"
        sub="each one's description — never its instructions"
        tone="compute"
      />

      <DgBox
        x={40}
        y={212}
        w={600}
        h={86}
        title="Workspace files, verbatim"
        sub="the only blocks a person writes by hand"
        tone="source"
        align="top"
      />
      <DgChip x={58} y={262} label="INSTRUCTIONS.md" tone="source" />
      <DgChip x={166} y={262} label="CONTEXT.md" tone="source" />
      <DgChip x={246} y={262} label="GUARDRAILS.md" tone="source" />
      <DgChip x={343} y={262} label="SPACE.md" tone="source" />
      <DgChip x={412} y={262} label="USER.md" tone="source" />

      <DgBox
        x={40}
        y={306}
        w={600}
        h={44}
        title="Skill roster"
        sub="each skill's name and description — never its body"
        tone="source"
      />
      <DgBox
        x={40}
        y={358}
        w={600}
        h={44}
        title="Attachments, and a notice of anything withheld"
        tone="neutral"
      />

      <DgArrow d="M 340 412 L 340 442" />

      <DgGroup x={20} y={446} w={640} h={104} label="In the turn prompt" />
      <DgBox
        x={40}
        y={476}
        w={290}
        h={56}
        title="Today's date, who is asking"
        tone="consumer"
      />
      <DgBox
        x={350}
        y={476}
        w={290}
        h={56}
        title="Recent history, then your message"
        tone="consumer"
      />

      <DgArrow
        d="M 340 550 L 340 580"
        dashed
        label="tool calls"
        labelAt={[340, 565]}
      />

      <DgGroup x={20} y={584} w={640} h={110} label="Fetched during the turn" />
      <DgBox
        x={40}
        y={614}
        w={190}
        h={62}
        title="Skill body"
        sub="read when it applies"
        tone="storage"
      />
      <DgBox
        x={245}
        y={614}
        w={190}
        h={62}
        title="Long-term memory"
        sub="only if the agent asks"
        tone="storage"
      />
      <DgBox
        x={450}
        y={614}
        w={190}
        h={62}
        title="Files and connectors"
        sub="everything outside"
        tone="storage"
      />
    </Diagram>
  );
}

/**
 * The consolidation loop in the report figure language (2026-08-11 docs
 * overhaul; modeled on the Brain's FlywheelLoopFigure): fill-card boxes,
 * teal strokes, italic muted edge labels, and a real return edge — the
 * loop is the argument. No amber here on purpose: every stage runs
 * unattended, and amber is reserved for the places a human is
 * load-bearing.
 *
 * Drawn from the shipped code: thread-idle-memory-learning.ts (the
 * after-quiet trigger), requester-memory/learner.ts (sorting; corrections
 * and decisions skip staging), requester-memory/dreaming.ts (the
 * light/REM/deep nightly pass) and requester-memory/storage.ts (the
 * memory/ file layout).
 */
export function ConsolidationLoopFigure() {
  return (
    <figure className="pt-1">
      {/* The SVG scales to its column rather than scrolling. */}
      <div>
        <svg
          viewBox="0 0 760 320"
          role="img"
          aria-label="The consolidation loop: work happens, the idle learner reads the quiet thread, most findings are staged as candidates, the nightly pass consolidates them, MEMORY.md is rewritten, and the file is read on the next turn — corrections skip the staging step"
          className="block h-auto w-full"
        >
          <defs>
            <marker
              id="cm-arr"
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

          {/* top row: work → idle learner → staged */}
          <rect x="20" y="36" width="180" height="62" rx="8" className="fill-card stroke-teal-400/50" strokeWidth="1.5" />
          <text x="36" y="62" className="fill-foreground font-sans text-[15px] font-semibold">1 · Work happens</text>
          <text x="36" y="82" className="fill-muted-foreground font-sans text-[11px]">a thread runs, then goes quiet</text>

          <rect x="290" y="36" width="180" height="62" rx="8" className="fill-card stroke-teal-400/50" strokeWidth="1.5" />
          <text x="306" y="62" className="fill-foreground font-sans text-[15px] font-semibold">2 · Idle learner</text>
          <text x="306" y="82" className="fill-muted-foreground font-sans text-[11px]">reads it once, sorts what it found</text>

          <rect x="560" y="36" width="180" height="62" rx="8" className="fill-card stroke-teal-400/50" strokeWidth="1.5" />
          <text x="576" y="62" className="fill-foreground font-sans text-[15px] font-semibold">3 · Staged</text>
          <text x="576" y="82" className="fill-muted-foreground font-sans text-[11px]">candidates wait to recur</text>

          <line x1="200" y1="67" x2="284" y2="67" className="stroke-muted-foreground" strokeWidth="1.3" markerEnd="url(#cm-arr)" />
          <text x="214" y="58" className="fill-muted-foreground font-sans text-[11px] italic">quiet thread</text>
          <line x1="470" y1="67" x2="554" y2="67" className="stroke-muted-foreground" strokeWidth="1.3" markerEnd="url(#cm-arr)" />
          <text x="480" y="58" className="fill-muted-foreground font-sans text-[11px] italic">most findings</text>

          {/* nightly pass */}
          <rect x="560" y="176" width="180" height="62" rx="8" className="fill-card stroke-teal-400/50" strokeWidth="1.5" />
          <text x="576" y="202" className="fill-foreground font-sans text-[15px] font-semibold">4 · Nightly pass</text>
          <text x="576" y="222" className="fill-muted-foreground font-sans text-[11px]">light · REM · deep</text>

          <line x1="650" y1="98" x2="650" y2="170" className="stroke-muted-foreground" strokeWidth="1.3" markerEnd="url(#cm-arr)" />
          <text x="660" y="138" className="fill-muted-foreground font-sans text-[11px] italic">re-read that night</text>

          {/* the file, and the return edge */}
          <rect x="290" y="176" width="180" height="62" rx="8" className="fill-card stroke-teal-400/50" strokeWidth="1.5" />
          <text x="306" y="202" className="fill-foreground font-sans text-[15px] font-semibold">5 · MEMORY.md</text>
          <text x="306" y="222" className="fill-muted-foreground font-sans text-[11px]">the durable set, compacted</text>

          {/* corrections skip staging */}
          <line x1="380" y1="98" x2="380" y2="170" className="stroke-muted-foreground" strokeWidth="1.3" strokeDasharray="4 3" markerEnd="url(#cm-arr)" />
          <text x="230" y="138" className="fill-muted-foreground font-sans text-[11px] italic">corrections go straight in</text>

          <line x1="554" y1="207" x2="476" y2="207" className="stroke-muted-foreground" strokeWidth="1.3" markerEnd="url(#cm-arr)" />
          <text x="478" y="198" className="fill-muted-foreground font-sans text-[11px] italic">promote · compact</text>

          <path d="M 290 207 L 110 207 L 110 104" fill="none" className="stroke-muted-foreground" strokeWidth="1.3" markerEnd="url(#cm-arr)" />
          <text x="122" y="172" className="fill-muted-foreground font-sans text-[11px] italic">read on the next turn</text>
        </svg>
      </div>
      <figcaption className="mt-2 font-sans text-[13px] leading-6 text-muted-foreground">
        Every stage runs unattended. What the loop converges on is a plain
        markdown file in your workspace — which is also why correcting it is
        just editing a file.
      </figcaption>
    </figure>
  );
}
