import { Bot, UserRound } from "lucide-react";
import { Button } from "@thinkwork/ui";

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
  onSelect: (target: MentionTarget) => void;
}

export function MentionMenu({ targets, query, onSelect }: MentionMenuProps) {
  const normalized = query.trim().toLowerCase();
  const filtered = targets
    .filter((target) =>
      normalized
        ? target.displayName.toLowerCase().includes(normalized) ||
          target.role?.toLowerCase().includes(normalized)
        : true,
    )
    .slice(0, 8);

  if (filtered.length === 0) return null;

  return (
    <div className="absolute bottom-full left-0 z-20 mb-2 w-full max-w-md rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
      {filtered.map((target) => {
        const Icon = target.targetType === "AGENT" ? Bot : UserRound;
        return (
          <Button
            key={target.id}
            type="button"
            variant="ghost"
            className="h-auto w-full justify-start gap-2 px-2 py-2 text-left"
            onClick={() => onSelect(target)}
          >
            <Icon className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">
                {target.displayName}
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
