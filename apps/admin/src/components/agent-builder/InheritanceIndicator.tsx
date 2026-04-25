import { WorkspaceFileBadge } from "@/components/WorkspaceFileBadge";
import type { ComposeSource } from "@/lib/agent-builder-api";

export interface InheritanceIndicatorProps {
  source?: ComposeSource;
  updateAvailable?: boolean;
}

export function InheritanceIndicator({
  source,
  updateAvailable,
}: InheritanceIndicatorProps) {
  if (!source) return null;

  return (
    <span
      className="inline-flex items-center"
      aria-label={indicatorLabel(source, updateAvailable)}
      title={indicatorLabel(source, updateAvailable)}
    >
      <WorkspaceFileBadge source={source} updateAvailable={updateAvailable} />
    </span>
  );
}

function indicatorLabel(source: ComposeSource, updateAvailable?: boolean) {
  if (updateAvailable) return "Template update available";
  if (source === "agent-override" || source === "agent-override-pinned") {
    return "Overridden";
  }
  if (source === "template" || source === "template-pinned") {
    return "Inherited from template";
  }
  return "Inherited from defaults";
}
