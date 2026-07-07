import { COMMUNITY_COLORS } from "@thinkwork/graph";

/** Stable fallback hue when the graph isn't mounted to supply real
 *  community colors. */
export function hashColor(label: string): string {
  let hash = 0;
  for (let i = 0; i < label.length; i += 1) {
    hash = (hash * 31 + label.charCodeAt(i)) | 0;
  }
  return COMMUNITY_COLORS[Math.abs(hash) % COMMUNITY_COLORS.length]!;
}

export function NodeBadge({
  label,
  color,
  onClick,
}: {
  label: string;
  color: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={!onClick}
      onClick={onClick}
      className="inline-flex min-w-0 max-w-[38%] items-center rounded-full border px-1.5 py-px text-[11px] font-medium transition-opacity enabled:hover:opacity-75 disabled:cursor-default"
      style={{ borderColor: color, backgroundColor: `${color}26` }}
    >
      <span className="truncate">{label}</span>
    </button>
  );
}

/** `── RELATIONSHIP ──▶` connector between two node badges. */
export function RelationshipConnector({ label }: { label: string }) {
  return (
    <span className="shrink-0 whitespace-nowrap font-mono text-[9px] tracking-tight text-muted-foreground">
      ── {label.toUpperCase()} ──▶
    </span>
  );
}
