/**
 * Shared SVG primitives for hand-authored doc figures (THINK-693).
 *
 * Why SVG and not more FlowChain markup: the kit's chains are good at
 * sequences, and nothing else. The pictures that actually explain the
 * product are not sequences — they are a fan-in, a merge, a
 * parallel-then-fuse, a gate. Those need real geometry: crossing edges,
 * grouped bands, arrows that converge. These primitives draw them.
 *
 * THIS FILE HOLDS PRIMITIVES ONLY. Named content figures live under
 * src/docs/figures/<section>.tsx — one file per doc section — so several
 * authors can add pictures without colliding in a single module.
 *
 * House rules, so every figure reads as one system:
 *  - Coordinates are authored in a fixed viewBox; the SVG scales to the
 *    column width (`w-full h-auto`), so figures stay legible on any screen.
 *  - Colour comes from the same five tones as the kit's icon tiles, and
 *    every neutral (surface, border, text) is a CSS token — the figures
 *    follow the theme instead of hardcoding a dark palette.
 *  - Type sizes: 13px titles, 11px subtitles, 10px mono edge labels. Same
 *    as the kit, so an SVG figure and a FlowChain sit together cleanly.
 *  - Every figure carries a <title> for screen readers and a caption.
 */
import type { ReactNode } from "react";

/* ------------------------------------------------------------------ */
/* Shared primitives                                                   */
/* ------------------------------------------------------------------ */

export type DiagramTone =
  | "source"
  | "compute"
  | "storage"
  | "graph"
  | "consumer"
  | "neutral";

/** Accent per tone — the only hue in a figure; everything else is a token. */
const ACCENT: Record<DiagramTone, string> = {
  source: "#38bdf8",
  compute: "#a78bfa",
  storage: "#fbbf24",
  graph: "#34d399",
  consumer: "#f472b6",
  neutral: "var(--muted-foreground)",
};

const TOKEN = {
  surface: "var(--card)",
  border: "var(--border)",
  text: "var(--foreground)",
  muted: "var(--muted-foreground)",
};

/**
 * The figure wrapper: same dot-grid canvas as the kit's FlowDiagram, so an
 * SVG figure and a FlowChain read as the same drawing surface.
 */
export function Diagram({
  title,
  viewBox,
  caption,
  children,
}: {
  /** Accessible name — what the picture shows, in one clause. */
  title: string;
  viewBox: string;
  caption?: ReactNode;
  children: ReactNode;
}) {
  return (
    <figure className="w-full">
      <div className="overflow-hidden rounded-xl border border-border/70 bg-[radial-gradient(rgba(255,255,255,0.055)_1px,transparent_1px)] [background-size:18px_18px] p-4 sm:p-6">
        <svg
          viewBox={viewBox}
          role="img"
          aria-label={title}
          className="block h-auto w-full"
        >
          <title>{title}</title>
          <defs>
            <marker
              id="dg-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 9 5 L 0 9 z" fill={TOKEN.muted} opacity="0.7" />
            </marker>
          </defs>
          {children}
        </svg>
      </div>
      {caption ? (
        <figcaption className="mt-2 max-w-3xl text-[13px] leading-6 text-muted-foreground">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}

/** A titled box. `sub` is a second line; `chips` render as a mono strip. */
export function DgBox({
  x,
  y,
  w,
  h,
  title,
  sub,
  tone = "neutral",
  dashed,
  align = "center",
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  sub?: string;
  tone?: DiagramTone;
  /** A box that is proposed/optional rather than always present. */
  dashed?: boolean;
  /**
   * Where the label block sits. "top" is for tall boxes that hold chips or
   * nested art below the label — centered text would collide with them.
   */
  align?: "center" | "top";
}) {
  const accent = ACCENT[tone];
  const cx = x + w / 2;
  const titleY = align === "top" ? y + 24 : sub ? y + h / 2 - 3 : y + h / 2 + 4;
  const subY = align === "top" ? y + 40 : y + h / 2 + 14;
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx="8"
        fill={tone === "neutral" ? TOKEN.surface : accent}
        fillOpacity={tone === "neutral" ? 1 : 0.09}
        stroke={tone === "neutral" ? TOKEN.border : accent}
        strokeOpacity={tone === "neutral" ? 1 : 0.4}
        strokeDasharray={dashed ? "4 3" : undefined}
      />
      <text
        x={cx}
        y={titleY}
        textAnchor="middle"
        fontSize="13"
        fontWeight="500"
        fill={TOKEN.text}
      >
        {title}
      </text>
      {sub ? (
        <text
          x={cx}
          y={subY}
          textAnchor="middle"
          fontSize="11"
          fill={TOKEN.muted}
        >
          {sub}
        </text>
      ) : null}
    </g>
  );
}

/** A small mono pill — one concrete instance, a count, a field name. */
export function DgChip({
  x,
  y,
  label,
  tone = "neutral",
}: {
  /** Left edge; the pill sizes itself to the label. */
  x: number;
  y: number;
  label: string;
  tone?: DiagramTone;
}) {
  const w = label.length * 5.6 + 14;
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height="18"
        rx="9"
        fill={TOKEN.surface}
        stroke={tone === "neutral" ? TOKEN.border : ACCENT[tone]}
        strokeOpacity={tone === "neutral" ? 1 : 0.45}
      />
      <text
        x={x + w / 2}
        y={y + 12.5}
        textAnchor="middle"
        fontSize="10"
        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
        fill={TOKEN.muted}
      >
        {label}
      </text>
    </g>
  );
}

/** Section heading inside a figure — the band a group of boxes belongs to. */
export function DgLabel({
  x,
  y,
  text,
  anchor = "start",
}: {
  x: number;
  y: number;
  text: string;
  anchor?: "start" | "middle" | "end";
}) {
  return (
    <text
      x={x}
      y={y}
      textAnchor={anchor}
      fontSize="10"
      fontWeight="600"
      letterSpacing="1.4"
      fill={TOKEN.muted}
    >
      {text.toUpperCase()}
    </text>
  );
}

/** Straight or elbowed edge with an arrowhead, and an optional label pill. */
export function DgArrow({
  d,
  label,
  labelAt,
  dashed,
}: {
  /** Any path data; keep to straight runs and 8px-radius elbows. */
  d: string;
  label?: string;
  /** Where the label pill centers. Required when `label` is set. */
  labelAt?: [number, number];
  dashed?: boolean;
}) {
  return (
    <g>
      <path
        d={d}
        fill="none"
        stroke={TOKEN.border}
        strokeWidth="1"
        strokeDasharray={dashed ? "4 3" : undefined}
        markerEnd="url(#dg-arrow)"
      />
      {label && labelAt ? (
        <g>
          <rect
            x={labelAt[0] - (label.length * 5.4 + 14) / 2}
            y={labelAt[1] - 9}
            width={label.length * 5.4 + 14}
            height="18"
            rx="9"
            fill="var(--background)"
            stroke={TOKEN.border}
            strokeOpacity="0.8"
          />
          <text
            x={labelAt[0]}
            y={labelAt[1] + 3.5}
            textAnchor="middle"
            fontSize="10"
            fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
            fill={TOKEN.muted}
          >
            {label}
          </text>
        </g>
      ) : null}
    </g>
  );
}

/** A dashed enclosure grouping boxes that belong to one subsystem. */
export function DgGroup({
  x,
  y,
  w,
  h,
  label,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  label?: string;
}) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx="12"
        fill={TOKEN.muted}
        fillOpacity="0.04"
        stroke={TOKEN.border}
        strokeDasharray="5 4"
      />
      {label ? <DgLabel x={x + 12} y={y + 18} text={label} /> : null}
    </g>
  );
}

/** A graph node as the graph itself draws them: a filled circle + caption. */
export function DgNode({
  cx,
  cy,
  r = 15,
  label,
  tone = "graph",
  labelBelow = true,
}: {
  cx: number;
  cy: number;
  r?: number;
  label: string;
  tone?: DiagramTone;
  labelBelow?: boolean;
}) {
  const accent = ACCENT[tone];
  return (
    <g>
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill={accent}
        fillOpacity="0.16"
        stroke={accent}
        strokeOpacity="0.55"
      />
      <text
        x={cx}
        y={labelBelow ? cy + r + 14 : cy + 4}
        textAnchor="middle"
        fontSize="11"
        fill={labelBelow ? TOKEN.muted : TOKEN.text}
      >
        {label}
      </text>
    </g>
  );
}
