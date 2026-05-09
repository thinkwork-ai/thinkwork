// Per-character shimmer for "Loading..." surfaces. Mirrors the
// Processing... shimmer in TaskThreadView and the per-page Loading...
// shimmer used by PageSkeleton.

const SHIMMER_CHAR_DURATION_MS = 120;

interface LoadingShimmerProps {
  /** Defaults to "Loading..." */
  text?: string;
  /** sr-only label for assistive tech. Defaults to "Loading". */
  ariaLabel?: string;
  /** Override font sizing/weight. Defaults to font-mono text-sm. */
  className?: string;
}

export function LoadingShimmer({
  text = "Loading...",
  ariaLabel = "Loading",
  className = "font-mono text-sm",
}: LoadingShimmerProps) {
  return (
    <span role="status" aria-live="polite">
      <span aria-hidden="true" className={className}>
        {text.split("").map((char, index) => (
          <span
            className="tw-shimmer-char"
            key={`${char}-${index}`}
            style={{
              animationDelay: `${index * SHIMMER_CHAR_DURATION_MS}ms`,
            }}
          >
            {char}
          </span>
        ))}
      </span>
      <span className="sr-only">{ariaLabel}</span>
    </span>
  );
}
