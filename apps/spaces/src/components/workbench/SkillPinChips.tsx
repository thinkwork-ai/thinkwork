import { Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SkillPin } from "./useComposerSkillPins";

/**
 * Blue Sparkles chips for force-pinned skills in the composer (plan
 * 2026-06-04-004 U6). Per-message and removable — the same mental model as
 * attachment chips. Rendered only when at least one skill is pinned.
 */
export function SkillPinChips({
  pins,
  onRemove,
  className,
}: {
  pins: SkillPin[];
  onRemove: (slug: string) => void;
  className?: string;
}) {
  if (pins.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {pins.map((pin) => (
        <span
          key={pin.slug}
          className="inline-flex items-center gap-1 rounded-md border border-[#54a9ff]/30 bg-[#54a9ff]/10 px-2 py-0.5 text-sm text-[#1d6fd6] dark:text-[#7cc0ff]"
        >
          <Sparkles className="size-3.5 shrink-0" />
          <span className="truncate">{pin.displayName}</span>
          <button
            type="button"
            onClick={() => onRemove(pin.slug)}
            aria-label={`Remove ${pin.displayName} skill`}
            className="ml-0.5 rounded-sm opacity-70 hover:opacity-100"
          >
            <X className="size-3.5" />
          </button>
        </span>
      ))}
    </div>
  );
}
