/**
 * Figures for the Start here section (THINK-695), in the report figure
 * language (2026-08-11 docs overhaul; modeled on the Memory section's
 * ConsolidationLoopFigure): fill-card boxes, teal strokes, italic muted
 * edge labels, unique marker id `sh-arr`. No amber — nothing in this
 * picture is a human-in-the-loop rule.
 *
 * Deliberately drawn at USER altitude: the picture answers "what is on the
 * other side of the message I just sent", so it names things a person can
 * see in the app — a Space, a connector, memory — and no infrastructure.
 * The fan-out and fan-in are the point, which is why this stays an SVG
 * rather than an inline Flow.
 */

/**
 * You ↔ agent ↔ what the agent draws on ↔ what comes back. The one picture
 * Getting started leans on; every noun in it has a glossary entry.
 */
export function AgentAtWorkDiagram() {
  return (
    <figure className="pt-1">
      {/* The SVG scales to its column rather than scrolling. */}
      <div>
        <svg
          viewBox="0 0 640 404"
          role="img"
          aria-label="One turn end to end: you ask from the web app, mobile app or Slack; your agent draws on its memory, its connectors and the Space the thread lives in; and an answer comes back, often with charts, artifacts or work items attached"
          className="block h-auto w-full"
        >
          <defs>
            <marker
              id="sh-arr"
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

          {/* you */}
          <rect
            x="205"
            y="14"
            width="230"
            height="62"
            rx="8"
            className="fill-card stroke-teal-400/50"
            strokeWidth="1.5"
          />
          <text
            x="221"
            y="40"
            className="fill-foreground font-sans text-[15px] font-semibold"
          >
            You
          </text>
          <text
            x="221"
            y="60"
            className="fill-muted-foreground font-sans text-[11px]"
          >
            web app · mobile app · Slack
          </text>

          <line
            x1="320"
            y1="76"
            x2="320"
            y2="112"
            className="stroke-muted-foreground"
            strokeWidth="1.3"
            markerEnd="url(#sh-arr)"
          />
          <text
            x="330"
            y="98"
            className="fill-muted-foreground font-sans text-[11px] italic"
          >
            you ask
          </text>

          {/* the agent */}
          <rect
            x="205"
            y="118"
            width="230"
            height="62"
            rx="8"
            className="fill-card stroke-teal-400/50"
            strokeWidth="1.5"
          />
          <text
            x="221"
            y="144"
            className="fill-foreground font-sans text-[15px] font-semibold"
          >
            Your agent
          </text>
          <text
            x="221"
            y="164"
            className="fill-muted-foreground font-sans text-[11px]"
          >
            instructions, skills, connectors
          </text>

          {/* fan out to what it draws on */}
          <path
            d="M 320 180 L 320 198 L 105 198 L 105 220"
            fill="none"
            className="stroke-muted-foreground"
            strokeWidth="1.3"
            markerEnd="url(#sh-arr)"
          />
          <line
            x1="320"
            y1="180"
            x2="320"
            y2="220"
            className="stroke-muted-foreground"
            strokeWidth="1.3"
            markerEnd="url(#sh-arr)"
          />
          <path
            d="M 320 180 L 320 198 L 535 198 L 535 220"
            fill="none"
            className="stroke-muted-foreground"
            strokeWidth="1.3"
            markerEnd="url(#sh-arr)"
          />
          <text
            x="330"
            y="212"
            className="fill-muted-foreground font-sans text-[11px] italic"
          >
            draws on
          </text>

          <rect
            x="10"
            y="226"
            width="190"
            height="62"
            rx="8"
            className="fill-card stroke-teal-400/50"
            strokeWidth="1.5"
          />
          <text
            x="26"
            y="252"
            className="fill-foreground font-sans text-[15px] font-semibold"
          >
            Memory
          </text>
          <text
            x="26"
            y="272"
            className="fill-muted-foreground font-sans text-[11px]"
          >
            what it already knows
          </text>

          <rect
            x="225"
            y="226"
            width="190"
            height="62"
            rx="8"
            className="fill-card stroke-teal-400/50"
            strokeWidth="1.5"
          />
          <text
            x="241"
            y="252"
            className="fill-foreground font-sans text-[15px] font-semibold"
          >
            Connectors
          </text>
          <text
            x="241"
            y="272"
            className="fill-muted-foreground font-sans text-[11px]"
          >
            Slack, GitHub, Google
          </text>

          <rect
            x="440"
            y="226"
            width="190"
            height="62"
            rx="8"
            className="fill-card stroke-teal-400/50"
            strokeWidth="1.5"
          />
          <text
            x="456"
            y="252"
            className="fill-foreground font-sans text-[15px] font-semibold"
          >
            The Space
          </text>
          <text
            x="456"
            y="272"
            className="fill-muted-foreground font-sans text-[11px]"
          >
            files, threads, work
          </text>

          {/* fan back in */}
          <path
            d="M 105 288 L 105 310 L 250 310 L 250 328"
            fill="none"
            className="stroke-muted-foreground"
            strokeWidth="1.3"
            markerEnd="url(#sh-arr)"
          />
          <line
            x1="320"
            y1="288"
            x2="320"
            y2="328"
            className="stroke-muted-foreground"
            strokeWidth="1.3"
            markerEnd="url(#sh-arr)"
          />
          <path
            d="M 535 288 L 535 310 L 390 310 L 390 328"
            fill="none"
            className="stroke-muted-foreground"
            strokeWidth="1.3"
            markerEnd="url(#sh-arr)"
          />

          <rect
            x="205"
            y="334"
            width="230"
            height="62"
            rx="8"
            className="fill-card stroke-teal-400/50"
            strokeWidth="1.5"
          />
          <text
            x="221"
            y="360"
            className="fill-foreground font-sans text-[15px] font-semibold"
          >
            An answer — and often more
          </text>
          <text
            x="221"
            y="380"
            className="fill-muted-foreground font-sans text-[11px]"
          >
            charts, artifacts, work items
          </text>
        </svg>
      </div>
      <figcaption className="mt-2 font-sans text-[13px] leading-6 text-muted-foreground">
        One turn, end to end. You ask from whichever client is in front of you;
        the agent answers using three things it can reach — what it remembers,
        the systems it is connected to, and the Space the thread lives in — and
        hands back more than text.
      </figcaption>
    </figure>
  );
}
