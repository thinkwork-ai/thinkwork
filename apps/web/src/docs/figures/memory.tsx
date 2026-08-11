/**
 * Figures for the Memory section (THINK-698; report restyle 2026-08-11).
 *
 * Three pictures in the report figure language — fill-card boxes, teal
 * strokes, italic muted edge labels, one unique marker id per figure:
 *  - MemoryFlowDiagram (mf-arr) — after a turn ends, the transcript forks:
 *    the managed engine extracts records on its own schedule, and the
 *    consolidation passes rewrite the requester's markdown notes. A later
 *    turn gets the notes for free and reaches the records only by asking.
 *  - ContextCompositionDiagram (cc-arr) — what is already in front of the
 *    model when a turn starts, versus what costs a tool call.
 *  - ConsolidationLoopFigure (cm-arr) — the consolidation loop drawn as a
 *    loop.
 *
 * Drawn from the shipped code: packages/agentcore-pi/agent-container/src/
 * server.ts (fire-and-forget end-of-turn retain; attachment preamble +
 * withheld notice as the system-prompt suffix), packages/pi-extensions/src/
 * system-prompt-compose.ts (block order; date + requester ride the turn
 * prompt), packages/api/src/lib/memory/adapters/agentcore-adapter.ts
 * (extraction namespaces; recall is a query the agent runs), and
 * packages/api/src/lib/requester-memory/{learner,dreaming}.ts (the idle
 * learner and nightly pass read the thread record and the workspace, then
 * write memory/ markdown). The old "read back from AgentCore" edge was
 * dropped: dreaming reads Aurora messages and workspace files, not the
 * engine.
 */

/**
 * The fork after a turn, and the two unequal read paths back. The dashed
 * recall edge is the point of the picture: extracted memory reaches a
 * later turn only because the agent asks, while the consolidated notes are
 * simply mounted.
 */
export function MemoryFlowDiagram() {
  return (
    <figure className="pt-1">
      <div>
        <svg
          viewBox="0 0 760 490"
          role="img"
          aria-label="After a turn ends its transcript is handed to AgentCore Memory for background extraction, and the idle learner plus nightly pass re-read the thread and write markdown notes; a later turn reads the notes as mounted files but reaches extracted records only by calling recall"
          className="block h-auto w-full"
        >
          <defs>
            <marker
              id="mf-arr"
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

          {/* the turn */}
          <rect x="270" y="20" width="220" height="62" rx="8" className="fill-card stroke-teal-400/50" strokeWidth="1.5" />
          <text x="286" y="46" className="fill-foreground font-sans text-[15px] font-semibold">A turn in a thread</text>
          <text x="286" y="66" className="fill-muted-foreground font-sans text-[11px]">your message, the agent&apos;s answer</text>

          {/* fork left: the managed engine */}
          <path d="M 310 82 L 310 112 L 180 112 L 180 146" fill="none" className="stroke-muted-foreground" strokeWidth="1.3" markerEnd="url(#mf-arr)" />
          <text x="40" y="104" className="fill-muted-foreground font-sans text-[11px] italic">transcript, handed off in the background</text>

          <rect x="40" y="152" width="280" height="76" rx="8" className="fill-card stroke-teal-400/50" strokeWidth="1.5" />
          <text x="56" y="178" className="fill-foreground font-sans text-[15px] font-semibold">AgentCore Memory</text>
          <text x="56" y="198" className="fill-muted-foreground font-sans text-[11px]">extraction on its own schedule —</text>
          <text x="56" y="214" className="fill-muted-foreground font-sans text-[11px]">facts · preferences · summaries · episodes</text>

          {/* fork right: the consolidation passes */}
          <path d="M 450 82 L 450 112 L 580 112 L 580 146" fill="none" className="stroke-muted-foreground" strokeWidth="1.3" markerEnd="url(#mf-arr)" />
          <text x="512" y="104" className="fill-muted-foreground font-sans text-[11px] italic">re-read after it goes quiet</text>

          <rect x="440" y="152" width="280" height="76" rx="8" className="fill-card stroke-teal-400/50" strokeWidth="1.5" />
          <text x="456" y="178" className="fill-foreground font-sans text-[15px] font-semibold">Idle learner + nightly pass</text>
          <text x="456" y="198" className="fill-muted-foreground font-sans text-[11px]">read the thread record and your</text>
          <text x="456" y="214" className="fill-muted-foreground font-sans text-[11px]">existing notes, then sort and promote</text>

          <line x1="580" y1="228" x2="580" y2="284" className="stroke-muted-foreground" strokeWidth="1.3" markerEnd="url(#mf-arr)" />
          <text x="592" y="260" className="fill-muted-foreground font-sans text-[11px] italic">writes markdown</text>

          <rect x="440" y="290" width="280" height="62" rx="8" className="fill-card stroke-teal-400/50" strokeWidth="1.5" />
          <text x="456" y="316" className="fill-foreground font-sans text-[15px] font-semibold">memory/ notes</text>
          <text x="456" y="336" className="fill-muted-foreground font-sans text-[11px]">MEMORY.md · DREAMS.md · candidates/</text>

          {/* the later turn, and the two read paths */}
          <rect x="270" y="408" width="220" height="62" rx="8" className="fill-card stroke-teal-400/50" strokeWidth="1.5" />
          <text x="286" y="434" className="fill-foreground font-sans text-[15px] font-semibold">A later turn</text>
          <text x="286" y="454" className="fill-muted-foreground font-sans text-[11px]">in any thread</text>

          <path d="M 580 352 L 580 439 L 496 439" fill="none" className="stroke-muted-foreground" strokeWidth="1.3" markerEnd="url(#mf-arr)" />
          <text x="592" y="388" className="fill-muted-foreground font-sans text-[11px] italic">mounted —</text>
          <text x="592" y="404" className="fill-muted-foreground font-sans text-[11px] italic">read every turn</text>

          <path d="M 180 228 L 180 439 L 264 439" fill="none" className="stroke-muted-foreground" strokeWidth="1.3" strokeDasharray="4 3" markerEnd="url(#mf-arr)" />
          <text x="60" y="388" className="fill-muted-foreground font-sans text-[11px] italic">recall(query) —</text>
          <text x="60" y="404" className="fill-muted-foreground font-sans text-[11px] italic">only if the agent asks</text>
        </svg>
      </div>
      <figcaption className="mt-2 font-sans text-[13px] leading-6 text-muted-foreground">
        Both branches run after your answer has already shipped, and neither
        blocks it. The asymmetry at the bottom is the one to remember: notes
        are simply there on the next turn; extracted memory has to be asked
        for.
      </figcaption>
    </figure>
  );
}

/**
 * What the model is holding when a turn begins — the cached system prompt
 * in the order the composer emits it, then the per-turn block — versus
 * what it has to go and fetch. The dashed boundary into the bottom band is
 * the whole point.
 */
export function ContextCompositionDiagram() {
  return (
    <figure className="pt-1">
      <div>
        <svg
          viewBox="0 0 760 584"
          role="img"
          aria-label="The system prompt is assembled in a fixed order from policy blocks, the sub-agent roster, workspace files, the skill roster, and attachment previews plus a withheld-capability notice; the turn prompt adds the date, the requester and recent history; skill bodies, memory records and outside data are fetched with tool calls during the turn"
          className="block h-auto w-full"
        >
          <defs>
            <marker
              id="cc-arr"
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

          {/* band 1: the system prompt */}
          <rect x="20" y="30" width="720" height="272" rx="10" className="fill-none stroke-muted-foreground/40" strokeWidth="1" strokeDasharray="5 4" />
          <text x="36" y="20" className="fill-muted-foreground font-sans text-[11px] font-semibold tracking-[0.08em] uppercase">The system prompt — stable, cached between turns</text>

          <rect x="40" y="46" width="680" height="40" rx="6" className="fill-card stroke-teal-400/50" strokeWidth="1.5" />
          <text x="56" y="71" className="fill-foreground font-sans text-[13px] font-semibold">Profile &amp; tool policy</text>
          <text x="230" y="71" className="fill-muted-foreground font-sans text-[11px]">written by the platform from the tools this turn actually has</text>

          <rect x="40" y="94" width="680" height="40" rx="6" className="fill-card stroke-teal-400/50" strokeWidth="1.5" />
          <text x="56" y="119" className="fill-foreground font-sans text-[13px] font-semibold">Sub-agent roster</text>
          <text x="230" y="119" className="fill-muted-foreground font-sans text-[11px]">each one&apos;s description — never its instructions</text>

          <rect x="40" y="142" width="680" height="56" rx="6" className="fill-card stroke-teal-400/50" strokeWidth="1.5" />
          <text x="56" y="167" className="fill-foreground font-sans text-[13px] font-semibold">Workspace files, verbatim and in order</text>
          <text x="56" y="187" className="fill-muted-foreground font-sans text-[11px]">INSTRUCTIONS.md · CONTEXT.md · GUARDRAILS.md · SPACE.md · User/USER.md</text>

          <rect x="40" y="206" width="680" height="40" rx="6" className="fill-card stroke-teal-400/50" strokeWidth="1.5" />
          <text x="56" y="231" className="fill-foreground font-sans text-[13px] font-semibold">Skill roster</text>
          <text x="230" y="231" className="fill-muted-foreground font-sans text-[11px]">each skill&apos;s name and description — never its body</text>

          <rect x="40" y="254" width="680" height="40" rx="6" className="fill-card stroke-teal-400/50" strokeWidth="1.5" />
          <text x="56" y="279" className="fill-foreground font-sans text-[13px] font-semibold">Attachment previews + withheld notice</text>
          <text x="360" y="279" className="fill-muted-foreground font-sans text-[11px]">what was granted but could not load, and why</text>

          <line x1="380" y1="302" x2="380" y2="336" className="stroke-muted-foreground" strokeWidth="1.3" markerEnd="url(#cc-arr)" />

          {/* band 2: the turn prompt */}
          <rect x="20" y="356" width="720" height="90" rx="10" className="fill-none stroke-muted-foreground/40" strokeWidth="1" strokeDasharray="5 4" />
          <text x="36" y="346" className="fill-muted-foreground font-sans text-[11px] font-semibold tracking-[0.08em] uppercase">The turn prompt — changes every turn</text>

          <rect x="40" y="374" width="330" height="54" rx="6" className="fill-card stroke-teal-400/50" strokeWidth="1.5" />
          <text x="56" y="399" className="fill-foreground font-sans text-[13px] font-semibold">Today&apos;s date, who is asking</text>
          <text x="56" y="417" className="fill-muted-foreground font-sans text-[11px]">kept out of the cached half on purpose</text>

          <rect x="390" y="374" width="330" height="54" rx="6" className="fill-card stroke-teal-400/50" strokeWidth="1.5" />
          <text x="406" y="399" className="fill-foreground font-sans text-[13px] font-semibold">Recent history, then your message</text>
          <text x="406" y="417" className="fill-muted-foreground font-sans text-[11px]">the last 30 messages of the thread</text>

          <line x1="380" y1="446" x2="380" y2="480" className="stroke-muted-foreground" strokeWidth="1.3" strokeDasharray="4 3" markerEnd="url(#cc-arr)" />
          <text x="392" y="468" className="fill-muted-foreground font-sans text-[11px] italic">tool calls</text>

          {/* band 3: fetched during the turn */}
          <rect x="20" y="500" width="720" height="76" rx="10" className="fill-none stroke-muted-foreground/40" strokeWidth="1" strokeDasharray="5 4" />
          <text x="36" y="490" className="fill-muted-foreground font-sans text-[11px] font-semibold tracking-[0.08em] uppercase">Fetched only when the agent asks</text>

          <rect x="40" y="514" width="213" height="48" rx="6" className="fill-card stroke-teal-400/50" strokeWidth="1.5" />
          <text x="56" y="536" className="fill-foreground font-sans text-[13px] font-semibold">Skill bodies</text>
          <text x="56" y="553" className="fill-muted-foreground font-sans text-[11px]">read when one applies</text>

          <rect x="273" y="514" width="213" height="48" rx="6" className="fill-card stroke-teal-400/50" strokeWidth="1.5" />
          <text x="289" y="536" className="fill-foreground font-sans text-[13px] font-semibold">Memory records</text>
          <text x="289" y="553" className="fill-muted-foreground font-sans text-[11px]">via a recall the agent runs</text>

          <rect x="507" y="514" width="213" height="48" rx="6" className="fill-card stroke-teal-400/50" strokeWidth="1.5" />
          <text x="523" y="536" className="fill-foreground font-sans text-[13px] font-semibold">Files &amp; connectors</text>
          <text x="523" y="553" className="fill-muted-foreground font-sans text-[11px]">everything outside the prompt</text>
        </svg>
      </div>
      <figcaption className="mt-2 font-sans text-[13px] leading-6 text-muted-foreground">
        Everything in the two upper bands is in front of the model before it
        writes a token. Everything in the lower band costs a tool call —
        which is why an agent that &ldquo;should have known&rdquo; something
        often simply never went and looked.
      </figcaption>
    </figure>
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
