import type { LabelMode } from "./graph-utils.js";

const MODE_LABELS: Record<LabelMode, string> = {
  auto: "Auto",
  on: "On",
  off: "Off",
};

/** Click cycles auto → on → off → auto. */
export function nextLabelMode(mode: LabelMode): LabelMode {
  return mode === "auto" ? "on" : mode === "on" ? "off" : "auto";
}

interface GraphLabelTogglesProps {
  nodeLabelMode: LabelMode;
  linkLabelMode: LabelMode;
  onNodeLabelModeChange: (mode: LabelMode) => void;
  onLinkLabelModeChange: (mode: LabelMode) => void;
}

/**
 * Label visibility controls, overlaid top-right inside the graph container
 * (the bottom-left corner belongs to the type legend). `Auto` follows zoom
 * gating and focus defaults; `On`/`Off` override absolutely. Session-only
 * state — the host component owns it per mount.
 */
export function GraphLabelToggles({
  nodeLabelMode,
  linkLabelMode,
  onNodeLabelModeChange,
  onLinkLabelModeChange,
}: GraphLabelTogglesProps) {
  return (
    <div className="absolute top-3 right-3 flex items-center gap-1.5 text-[11px] text-muted-foreground bg-background/80 rounded px-2 py-1.5">
      <button
        type="button"
        aria-label="Show node labels"
        className="rounded border border-border px-2 py-0.5 hover:bg-accent hover:text-accent-foreground"
        onClick={() => onNodeLabelModeChange(nextLabelMode(nodeLabelMode))}
      >
        Node labels: {MODE_LABELS[nodeLabelMode]}
      </button>
      <button
        type="button"
        aria-label="Show relationship labels"
        className="rounded border border-border px-2 py-0.5 hover:bg-accent hover:text-accent-foreground"
        onClick={() => onLinkLabelModeChange(nextLabelMode(linkLabelMode))}
      >
        Relationship labels: {MODE_LABELS[linkLabelMode]}
      </button>
    </div>
  );
}
