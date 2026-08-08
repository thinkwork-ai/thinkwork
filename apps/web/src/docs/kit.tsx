/**
 * Doc kit (THINK-693): the primitives every Agent Documentation page is
 * built from. Ported from the Brain console's docs kit so both products
 * read as one house style. Docs are TSX, not markdown, by decision — the
 * docs are diagram-first, and a prose format makes every diagram an escape
 * hatch. These primitives keep the pages declarative: a page states its
 * flows, callouts and terms; layout and tone live here.
 *
 * Diagram language: diagrams are one continuous surface — a
 * dot-grid canvas like the pipeline map — with icon-tile nodes, connectors
 * drawn as real edge lines that stretch to fill the lane (label pills
 * riding the line), and numbered lane headers joined by a vertical spine.
 * Hue lives in the icon tiles only; everything else is semantic tokens.
 */
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Info, Lightbulb, TriangleAlert, type LucideIcon } from "lucide-react";
import { cn } from "@thinkwork/ui";

/* ------------------------------------------------------------------ */
/* Article + sections                                                  */
/* ------------------------------------------------------------------ */

/**
 * Prose styling via descendant selectors so page authors write plain
 * <p>/<ul>/<code>. Kit components below deliberately use span/div for
 * their own text so these selectors never reach inside a diagram.
 */
const PROSE =
  "[&_p]:text-sm [&_p]:leading-7 [&_p]:text-foreground/80 " +
  "[&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5 [&_ul]:text-sm [&_ul]:leading-6 [&_ul]:text-foreground/80 " +
  "[&_ol]:list-decimal [&_ol]:space-y-1.5 [&_ol]:pl-5 [&_ol]:text-sm [&_ol]:leading-6 [&_ol]:text-foreground/80 " +
  "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs [&_code]:text-foreground " +
  "[&_strong]:font-medium [&_strong]:text-foreground";

export function DocArticle({
  title,
  eyebrow,
  lead,
  children,
}: {
  title: string;
  /** Section label above the title, e.g. "Start here". */
  eyebrow?: string;
  /** One-sentence "what is this" — every page opens with one. */
  lead: string;
  children: ReactNode;
}) {
  return (
    // Wide measure by request (Eric 2026-07-31): diagrams and tables get
    // the room; prose paragraphs still cap their own line length below.
    <article className={cn("mx-auto w-full max-w-6xl px-8 pt-12 pb-24", PROSE)}>
      {eyebrow ? (
        <p className="mb-2 text-xs font-medium tracking-widest text-muted-foreground uppercase">
          {eyebrow}
        </p>
      ) : null}
      <h1 className="text-3xl font-semibold tracking-tight text-balance">
        {title}
      </h1>
      <p className="mt-3 max-w-3xl text-base leading-7 text-muted-foreground">
        {lead}
      </p>
      {children}
    </article>
  );
}

/** An anchored h2 section — the unit the mini-TOC points at. */
export function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      // Paragraphs and lists keep a readable measure even in the wide
      // column; diagrams, tables and callouts run full width.
      className="scroll-mt-10 space-y-4 pt-12 [&_ol]:max-w-3xl [&_ul]:max-w-3xl [&>p]:max-w-3xl"
    >
      <h2 className="group text-xl font-semibold tracking-tight">
        <a href={`#${id}`} className="text-foreground no-underline">
          {title}
          <span
            aria-hidden="true"
            className="ml-2 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground/60"
          >
            #
          </span>
        </a>
      </h2>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Flow diagrams                                                       */
/* ------------------------------------------------------------------ */

export type FlowTone =
  | "source"
  | "compute"
  | "storage"
  | "graph"
  | "consumer"
  | "neutral";

/** Icon-tile treatment per tone — the only place hue is allowed. */
const TILE_TONES: Record<FlowTone, string> = {
  source: "bg-sky-400/10 text-sky-300 ring-sky-400/25",
  compute: "bg-violet-400/10 text-violet-300 ring-violet-400/25",
  storage: "bg-amber-400/10 text-amber-300 ring-amber-400/25",
  graph: "bg-emerald-400/10 text-emerald-300 ring-emerald-400/25",
  consumer: "bg-pink-400/10 text-pink-300 ring-pink-400/25",
  neutral: "bg-muted text-muted-foreground ring-border",
};

const LEGEND_DOTS: Record<FlowTone, string> = {
  source: "bg-sky-400",
  compute: "bg-violet-400",
  storage: "bg-amber-400",
  graph: "bg-emerald-400",
  consumer: "bg-pink-400",
  neutral: "bg-muted-foreground",
};

/**
 * The diagram surface: dot-grid canvas, one per figure. Lanes inside it
 * are joined with <FlowJoint /> so multi-band diagrams read as one system.
 */
export function FlowDiagram({ children }: { children: ReactNode }) {
  return (
    // Capped near the prose measure (Eric 2026-08-01): a short vertical
    // chain floating in a full-width canvas is mostly empty canvas.
    <div className="mx-auto w-full max-w-2xl rounded-xl border border-border/70 bg-[radial-gradient(rgba(255,255,255,0.055)_1px,transparent_1px)] [background-size:18px_18px] p-4 sm:p-6">
      {children}
    </div>
  );
}

/** One labeled band of a diagram; `step` numbers a real sequence. */
export function FlowLane({
  step,
  label,
  note,
  children,
}: {
  step?: string;
  label: string;
  /** Short right-aligned annotation, e.g. who runs this lane. */
  note?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="mb-3 flex items-baseline gap-2">
        {step ? (
          <span className="font-mono text-[11px] text-muted-foreground/60">
            {step}
          </span>
        ) : null}
        <span className="text-xs font-semibold tracking-widest text-foreground/80 uppercase">
          {label}
        </span>
        {note ? (
          <span className="ml-auto text-[11px] text-muted-foreground/70">
            {note}
          </span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

/**
 * The spine segment joining two lanes of one diagram — same vertical
 * language as FlowLink, but dashed, so a band boundary reads differently
 * from an ordinary step.
 */
export function FlowJoint({ label }: { label?: string }) {
  return (
    <div aria-hidden="true" className="flex flex-col items-center gap-1.5 py-4">
      <span className="h-5 w-px border-l border-dashed border-border" />
      {label ? (
        <span className="rounded-full border border-dashed border-border/70 bg-background px-2.5 py-1 font-mono text-[10px] leading-none text-muted-foreground">
          {label}
        </span>
      ) : null}
      <span className="h-5 w-px border-l border-dashed border-border" />
    </div>
  );
}

/**
 * A chain of steps, stacked TOP TO BOTTOM (Eric 2026-08-01 — "the charts
 * should be vertical, horizontal isn't looking good").
 *
 * Vertical buys three things the old horizontal row could not: every node
 * is the same full width regardless of how much text it carries, nothing
 * has to shrink or scroll on a narrow viewport, and the reading direction
 * matches the prose around it.
 */
export function FlowChain({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-stretch">
      {children}
    </div>
  );
}

/**
 * Two or more chains side by side — for a genuine fan-out (one input, two
 * independent downstream lanes), not for a sequence. Each column is a
 * FlowChain; they stack on narrow viewports.
 */
export function FlowSplit({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto grid w-full max-w-4xl gap-4 sm:grid-cols-2">
      {children}
    </div>
  );
}

/**
 * One box in a flow: a full-width row — icon tile, title + subtitle, and
 * any chips right-aligned. Equal boxes across every lane, section and page
 * (Eric 2026-07-31 — "I crave consistency").
 */
export function FlowNode({
  icon: Icon,
  title,
  sub,
  tone = "neutral",
  children,
}: {
  icon?: LucideIcon;
  title: string;
  sub?: string;
  tone?: FlowTone;
  children?: ReactNode;
}) {
  return (
    <div className="flex w-full items-start gap-3 rounded-lg border border-border/80 bg-linear-to-b from-white/[0.05] to-white/[0.015] px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
      {Icon ? (
        <span
          aria-hidden="true"
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-md ring-1 ring-inset",
            TILE_TONES[tone],
          )}
        >
          <Icon className="size-4" />
        </span>
      ) : null}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[13px] leading-tight font-medium">{title}</span>
        {sub ? (
          <span className="text-[11px] leading-snug text-muted-foreground">
            {sub}
          </span>
        ) : null}
        {/* Chips sit under the label rather than beside it: a narrow node
            with four chips on the same row squeezes both. */}
        {children ? (
          <span className="mt-1.5 flex flex-wrap gap-1">{children}</span>
        ) : null}
      </span>
    </div>
  );
}

/** Tiny pill inside a group node — one concrete instance of the category. */
export function FlowChip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded border border-border/60 bg-background/60 px-1.5 py-0.5 font-mono text-[10px] leading-none text-muted-foreground">
      {children}
    </span>
  );
}

/**
 * The edge between two stacked nodes: a drawn line running down the middle
 * with an arrowhead at the bottom, its label riding the line.
 */
export function FlowLink({ label }: { label?: string }) {
  return (
    <div
      aria-hidden="true"
      className="flex flex-col items-center gap-1 self-center py-1"
    >
      <span className="h-3 w-px bg-border" />
      {label ? (
        <span className="rounded-full border border-border/70 bg-background px-2 py-0.5 font-mono text-[10px] leading-none whitespace-nowrap text-muted-foreground">
          {label}
        </span>
      ) : null}
      <span className="h-3 w-px bg-border" />
      {/* arrowhead */}
      <span className="-mt-1 border-x-[3.5px] border-t-[5px] border-x-transparent border-t-muted-foreground/60" />
    </div>
  );
}

/** Legend row mapping tones to what they mean, shown under big diagrams. */
export function FlowLegend({
  items,
}: {
  items: { tone: FlowTone; label: string }[];
}) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 pt-3">
      {items.map((item) => (
        <span
          key={item.label}
          className="flex items-center gap-1.5 text-xs text-muted-foreground"
        >
          <span
            aria-hidden="true"
            className={cn("size-1.5 rounded-full", LEGEND_DOTS[item.tone])}
          />
          {item.label}
        </span>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Callouts, figures, terms                                            */
/* ------------------------------------------------------------------ */

const CALLOUT_STYLES = {
  note: {
    icon: Info,
    frame: "border-border bg-muted/20",
    icon_color: "text-muted-foreground",
  },
  tip: {
    icon: Lightbulb,
    frame: "border-emerald-400/25 bg-emerald-400/5",
    icon_color: "text-emerald-400",
  },
  warn: {
    icon: TriangleAlert,
    frame: "border-amber-400/25 bg-amber-400/5",
    icon_color: "text-amber-400",
  },
} as const;

export function Callout({
  tone = "note",
  title,
  children,
}: {
  tone?: keyof typeof CALLOUT_STYLES;
  title?: string;
  children: ReactNode;
}) {
  const style = CALLOUT_STYLES[tone];
  const Icon = style.icon;
  return (
    <div className={cn("flex gap-2.5 rounded-lg border p-3", style.frame)}>
      <Icon
        aria-hidden="true"
        className={cn("mt-0.5 size-4 shrink-0", style.icon_color)}
      />
      <div className="min-w-0 max-w-3xl space-y-1 text-sm leading-6 text-foreground/80 [&_p]:text-[13px] [&_p]:leading-6">
        {title ? (
          <span className="block text-[13px] font-medium text-foreground">
            {title}
          </span>
        ) : null}
        {children}
      </div>
    </div>
  );
}

/** Screenshot or exported image with a caption. Assets live in public/docs. */
export function Figure({
  src,
  alt,
  caption,
}: {
  src: string;
  alt: string;
  caption?: string;
}) {
  return (
    <figure className="overflow-hidden rounded-lg border border-border">
      <img src={src} alt={alt} className="block w-full" loading="lazy" />
      {caption ? (
        <figcaption className="border-t border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}

/** An inline link to another doc page — solid underline, vs Term's dotted. */
export function DocLink({
  slug,
  children,
}: {
  slug: string;
  children: ReactNode;
}) {
  return (
    <Link
      to="/docs/$slug"
      params={{ slug }}
      className="rounded-sm text-foreground underline decoration-muted-foreground/50 underline-offset-4 hover:decoration-foreground"
    >
      {children}
    </Link>
  );
}

/**
 * A glossary term inline in prose — dotted underline, links to its entry
 * on the Core concepts page. `id` defaults to the lowercased text.
 */
export function Term({ id, children }: { id?: string; children: string }) {
  const anchor = id ?? children.toLowerCase().replace(/\s+/g, "-");
  return (
    <Link
      to="/docs/$slug"
      params={{ slug: "concepts" }}
      hash={anchor}
      className="rounded-sm text-foreground underline decoration-muted-foreground/50 decoration-dotted underline-offset-4 hover:decoration-foreground"
    >
      {children}
    </Link>
  );
}

/** One glossary entry — anchored, so <Term> can deep-link to it. */
export function GlossaryEntry({
  id,
  term,
  children,
  example,
  seeAlso,
}: {
  id: string;
  term: string;
  children: ReactNode;
  /** A concrete instance from the live graph, not an invented one. */
  example?: ReactNode;
  seeAlso?: { id: string; label: string }[];
}) {
  return (
    <section
      id={id}
      className="scroll-mt-10 border-l-2 border-border/60 py-1 pl-4"
    >
      <h3 className="text-base font-semibold tracking-tight">
        <a href={`#${id}`} className="text-foreground no-underline">
          {term}
        </a>
      </h3>
      {/* Prose keeps its measure; an embedded FlowDiagram runs full width
          so its fixed-width nodes line up with every other diagram. */}
      <div className="mt-1.5 space-y-2 [&>p]:max-w-3xl">{children}</div>
      {example ? (
        <div className="mt-2 max-w-3xl text-[13px] leading-6 text-muted-foreground">
          <span className="font-medium text-foreground/70">Example — </span>
          {example}
        </div>
      ) : null}
      {seeAlso?.length ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span>See also:</span>
          {seeAlso.map((ref) => (
            <a
              key={ref.id}
              href={`#${ref.id}`}
              className="rounded border border-border/60 px-1.5 py-0.5 hover:bg-muted/40"
            >
              {ref.label}
            </a>
          ))}
        </div>
      ) : null}
    </section>
  );
}
