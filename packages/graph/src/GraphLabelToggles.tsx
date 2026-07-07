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
  labelMode: LabelMode;
  onLabelModeChange: (mode: LabelMode) => void;
}

/**
 * Single label-visibility control for node and relationship labels
 * together, overlaid top-left inside the graph container and styled to
 * match the selected-node chip. `Auto` follows zoom gating and focus
 * defaults; `On`/`Off` override absolutely. Session-only state — the
 * host component owns it per mount.
 */
export function GraphLabelToggles({
  labelMode,
  onLabelModeChange,
}: GraphLabelTogglesProps) {
  return (
    <button
      type="button"
      aria-label="Toggle labels"
      className="absolute top-3 left-3 flex items-center gap-2 text-xs bg-background/90 border border-border rounded-full px-3 py-1.5 hover:bg-accent hover:text-accent-foreground"
      onClick={() => onLabelModeChange(nextLabelMode(labelMode))}
    >
      <span className="font-medium">Labels</span>
      <span className="text-muted-foreground">{MODE_LABELS[labelMode]}</span>
    </button>
  );
}
