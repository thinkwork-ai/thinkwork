/**
 * Figures for the Spaces & threads section, in the report figure language
 * (2026-08-11 docs overhaul; modeled on memory.tsx's ConsolidationLoopFigure):
 * fill-card boxes with teal strokes, muted edges with arrowheads, italic
 * 11px edge labels. Two pictures that an inline <Flow> cannot draw:
 *
 *  - SpaceCompositionDiagram — a Space is not a step in a sequence, it is a
 *    layer wrapped around the one Enterprise Agent. That needs an enclosure
 *    with four parallel parts inside it, not a chain.
 *  - WorkArrivesDiagram — four independent entry points converging on one
 *    thread is a genuine fan-in, drawn with elbowed edges meeting one box.
 *
 * No amber in either figure on purpose: nothing here is a human-in-the-loop
 * step. Marker ids are unique per figure: `sc-arr` and `wa-arr`.
 */

/**
 * What a Space is made of, and what it sits on top of. The point the picture
 * has to land: there is one agent per tenant, and the Space is the layer that
 * makes that agent arrive at a Support turn and a Finance turn knowing
 * different things.
 */
export function SpaceCompositionDiagram() {
  const parts = [
    { x: 44, title: "Members", sub: "who can open it" },
    { x: 220, title: "Space files", sub: "SPACE.md, docs/ …" },
    { x: 396, title: "Triggers", sub: "how work arrives" },
    { x: 572, title: "Threads", sub: "what happened here" },
  ];

  return (
    <figure className="pt-1">
      {/* The SVG scales to its column rather than scrolling. */}
      <div>
        <svg
          viewBox="0 0 760 392"
          role="img"
          aria-label="A Space layered over the Enterprise Agent: the tenant's one agent on top, a Space carrying members, space files, triggers and threads beneath it, and what the agent works from on one turn — its own baseline plus this Space's layer"
          className="block h-auto w-full"
        >
          <defs>
            <marker
              id="sc-arr"
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

          {/* the one agent */}
          <rect x="140" y="20" width="480" height="62" rx="8" className="fill-card stroke-teal-400/50" strokeWidth="1.5" />
          <text x="380" y="46" textAnchor="middle" className="fill-foreground font-sans text-[15px] font-semibold">The Enterprise Agent</text>
          <text x="380" y="66" textAnchor="middle" className="fill-muted-foreground font-sans text-[11px]">your tenant&apos;s one agent — instructions, skills, connectors</text>

          <line x1="380" y1="82" x2="380" y2="126" className="stroke-muted-foreground" strokeWidth="1.3" markerEnd="url(#sc-arr)" />
          <text x="392" y="110" className="fill-muted-foreground font-sans text-[11px] italic">wrapped by</text>

          {/* the Space enclosure with its four parts */}
          <rect x="24" y="132" width="712" height="140" rx="10" className="fill-none stroke-muted-foreground/40" strokeWidth="1.3" strokeDasharray="5 4" />
          <text x="44" y="156" className="fill-muted-foreground font-sans text-[11px] font-semibold tracking-[0.08em] uppercase">A Space</text>

          {parts.map((part) => (
            <g key={part.title}>
              <rect x={part.x} y={172} width="144" height="62" rx="8" className="fill-card stroke-teal-400/50" strokeWidth="1.5" />
              <text x={part.x + 16} y={198} className="fill-foreground font-sans text-[14px] font-semibold">{part.title}</text>
              <text x={part.x + 16} y={218} className="fill-muted-foreground font-sans text-[11px]">{part.sub}</text>
            </g>
          ))}

          <line x1="380" y1="272" x2="380" y2="316" className="stroke-muted-foreground" strokeWidth="1.3" markerEnd="url(#sc-arr)" />
          <text x="392" y="298" className="fill-muted-foreground font-sans text-[11px] italic">one turn</text>

          {/* what a turn works from */}
          <rect x="180" y="322" width="400" height="62" rx="8" className="fill-card stroke-teal-400/50" strokeWidth="1.5" />
          <text x="380" y="348" textAnchor="middle" className="fill-foreground font-sans text-[15px] font-semibold">What the agent works from, this turn</text>
          <text x="380" y="368" textAnchor="middle" className="fill-muted-foreground font-sans text-[11px]">the agent&apos;s baseline plus this Space — not the others</text>
        </svg>
      </div>
      <figcaption className="mt-2 font-sans text-[13px] leading-6 text-muted-foreground">
        One agent per tenant. A Space does not clone it — it wraps it, so the
        same agent arrives at a Support turn and a Finance turn with different
        local context.
      </figcaption>
    </figure>
  );
}

/**
 * The four ways work reaches a Space. Deliberately a fan-in: the whole point
 * is that four unrelated entry points land in the same container, and the
 * only difference afterwards is the channel stamped on the thread.
 */
export function WorkArrivesDiagram() {
  const sources = [
    { x: 24, title: "Chat", sub: "you type in the app", into: 250 },
    { x: 208, title: "Email", sub: "to the Space address", into: 337 },
    { x: 392, title: "Schedule", sub: "a time fires", into: 424 },
    { x: 576, title: "Webhook", sub: "an external POST", into: 511 },
  ];

  return (
    <figure className="pt-1">
      {/* The SVG scales to its column rather than scrolling. */}
      <div>
        <svg
          viewBox="0 0 760 330"
          role="img"
          aria-label="Chat, email, schedule and webhook converging on one thread in a Space; the agent then runs one turn with that Space's context"
          className="block h-auto w-full"
        >
          <defs>
            <marker
              id="wa-arr"
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

          {sources.map((source) => (
            <g key={source.title}>
              <rect x={source.x} y={20} width="160" height="62" rx="8" className="fill-card stroke-teal-400/50" strokeWidth="1.5" />
              <text x={source.x + 16} y={46} className="fill-foreground font-sans text-[14px] font-semibold">{source.title}</text>
              <text x={source.x + 16} y={66} className="fill-muted-foreground font-sans text-[11px]">{source.sub}</text>
              <path
                d={`M ${source.x + 80} 82 L ${source.x + 80} 112 L ${source.into} 112 L ${source.into} 136`}
                fill="none"
                className="stroke-muted-foreground"
                strokeWidth="1.3"
                markerEnd="url(#wa-arr)"
              />
            </g>
          ))}

          <rect x="210" y="142" width="340" height="62" rx="8" className="fill-card stroke-teal-400/50" strokeWidth="1.5" />
          <text x="380" y="168" textAnchor="middle" className="fill-foreground font-sans text-[15px] font-semibold">A thread in the Space</text>
          <text x="380" y="188" textAnchor="middle" className="fill-muted-foreground font-sans text-[11px]">the channel is recorded on the thread</text>

          <line x1="380" y1="204" x2="380" y2="248" className="stroke-muted-foreground" strokeWidth="1.3" markerEnd="url(#wa-arr)" />
          <text x="392" y="230" className="fill-muted-foreground font-sans text-[11px] italic">agent turn</text>

          <rect x="210" y="254" width="340" height="62" rx="8" className="fill-card stroke-teal-400/50" strokeWidth="1.5" />
          <text x="380" y="280" textAnchor="middle" className="fill-foreground font-sans text-[15px] font-semibold">The agent runs in this Space</text>
          <text x="380" y="300" textAnchor="middle" className="fill-muted-foreground font-sans text-[11px]">its files, its context, its members</text>
        </svg>
      </div>
      <figcaption className="mt-2 font-sans text-[13px] leading-6 text-muted-foreground">
        Four entry points, one container. Whatever started the work, it becomes
        a thread in a Space, and the agent runs with that Space&apos;s context.
      </figcaption>
    </figure>
  );
}
