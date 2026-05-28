import { Bot, UserRound } from "lucide-react";
import { Button } from "@thinkwork/ui";
import { cn } from "@/lib/utils";

export interface MentionTarget {
  id: string;
  targetType: "USER" | "AGENT";
  targetId: string;
  displayName: string;
  aliases?: string[];
  isDefaultAgent?: boolean;
  avatarUrl?: string | null;
  role?: string | null;
}

interface MentionMenuProps {
  targets: MentionTarget[];
  query: string;
  activeIndex?: number;
  includeDefaultAgentShortcut?: boolean;
  onSelect: (target: MentionTarget) => void;
}

const DEFAULT_AGENT_SHORTCUT_ALIASES = ["agent", "think"] as const;

export function filterMentionTargets(
  targets: MentionTarget[],
  query: string,
  options: { includeDefaultAgentShortcut?: boolean } = {},
) {
  const normalized = query.trim().toLowerCase();
  const shortcut = options.includeDefaultAgentShortcut
    ? defaultAgentShortcutTarget(targets, normalized)
    : null;
  const filtered = targets
    .filter(
      (target) =>
        !shortcut ||
        target.targetType !== shortcut.targetType ||
        target.targetId !== shortcut.targetId,
    )
    .filter((target) =>
      normalized
        ? target.displayName.toLowerCase().includes(normalized) ||
          target.role?.toLowerCase().includes(normalized) ||
          target.aliases?.some((alias) =>
            alias.toLowerCase().includes(normalized),
          )
        : true,
    )
    .slice(0, 8);
  return shortcut ? [shortcut, ...filtered].slice(0, 8) : filtered;
}

function defaultAgentShortcutTarget(
  targets: MentionTarget[],
  normalizedQuery: string,
): MentionTarget | null {
  if (
    normalizedQuery &&
    !DEFAULT_AGENT_SHORTCUT_ALIASES.some((alias) =>
      alias.startsWith(normalizedQuery),
    )
  ) {
    return null;
  }
  const target = targets.find(
    (candidate) =>
      candidate.targetType === "AGENT" && candidate.isDefaultAgent === true,
  );
  if (!target) return null;
  return {
    ...target,
    id: `${target.id}:shortcut:agent`,
    displayName: "agent",
    role: "Default Thread agent",
    aliases: Array.from(
      new Set([...DEFAULT_AGENT_SHORTCUT_ALIASES, ...(target.aliases ?? [])]),
    ),
    isDefaultAgent: true,
  };
}

export function MentionMenu({
  targets,
  query,
  activeIndex = 0,
  includeDefaultAgentShortcut = false,
  onSelect,
}: MentionMenuProps) {
  const filtered = filterMentionTargets(targets, query, {
    includeDefaultAgentShortcut,
  });

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
                {target.displayName}
              </span>
            </span>
          </Button>
        );
      })}
    </div>
  );
}
