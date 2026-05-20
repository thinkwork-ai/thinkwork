import { Bot, UserRound } from "lucide-react";
import { Button } from "@thinkwork/ui";
import { cn } from "@/lib/utils";

export interface MentionTarget {
  id: string;
  targetType: "USER" | "AGENT";
  targetId: string;
  displayName: string;
  avatarUrl?: string | null;
  role?: string | null;
}

interface MentionMenuProps {
  targets: MentionTarget[];
  query: string;
  activeIndex?: number;
  onSelect: (target: MentionTarget) => void;
}

export function filterMentionTargets(targets: MentionTarget[], query: string) {
  const normalized = query.trim().toLowerCase();
  return targets
    .filter((target) =>
      normalized
        ? target.displayName.toLowerCase().includes(normalized) ||
          target.role?.toLowerCase().includes(normalized)
        : true,
    )
    .slice(0, 8);
}

export function MentionMenu({
  targets,
  query,
  activeIndex = 0,
  onSelect,
}: MentionMenuProps) {
  const filtered = filterMentionTargets(targets, query);

  if (filtered.length === 0) return null;

  return (
    <div
      className="absolute bottom-full left-0 z-20 mb-2 w-full max-w-md rounded-md border bg-popover p-2 text-popover-foreground shadow-md"
      role="listbox"
      aria-label="Mention suggestions"
    >
      {filtered.map((target, index) => {
        const Icon = target.targetType === "AGENT" ? Bot : UserRound;
        const isActive = index === activeIndex;
        return (
          <Button
            key={target.id}
            type="button"
            variant="ghost"
            role="option"
            aria-selected={isActive}
            className={cn(
              "h-auto w-full justify-start gap-2 rounded-sm px-2.5 py-2 text-left",
              isActive && "bg-accent text-accent-foreground",
            )}
            onClick={() => onSelect(target)}
          >
            <Icon
              className={cn(
                "size-4 shrink-0 text-muted-foreground",
                isActive && "text-accent-foreground",
              )}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">
                @{target.displayName}
              </span>
              {target.role ? (
                <span className="block truncate text-xs text-muted-foreground">
                  {target.role}
                </span>
              ) : null}
            </span>
          </Button>
        );
      })}
    </div>
  );
}
