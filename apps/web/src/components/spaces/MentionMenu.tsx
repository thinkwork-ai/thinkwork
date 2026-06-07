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
  /** Secondary row in the picker (users). Populated once the backend field ships. */
  email?: string | null;
}

interface MentionMenuProps {
  targets: MentionTarget[];
  query: string;
  activeIndex?: number;
  includeDefaultAgentShortcut?: boolean;
  /**
   * Where the menu opens relative to the composer. "top" (default) grows
   * upward — correct for composers pinned to the bottom of the viewport
   * (in-thread follow-up). "bottom" grows downward — for the vertically
   * centered new-thread composer, which has more room below than above, so
   * an upward menu would clip off the top of the screen.
   */
  placement?: "top" | "bottom";
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
  placement = "top",
  onSelect,
}: MentionMenuProps) {
  const filtered = filterMentionTargets(targets, query, {
    includeDefaultAgentShortcut,
  });

  if (filtered.length === 0) return null;

  const optionId = (target: MentionTarget) => `mention-option-${target.id}`;
  const activeOption = filtered[Math.min(activeIndex, filtered.length - 1)];

  return (
    <div
      className={cn(
        "absolute left-0 z-20 max-h-[40vh] w-full max-w-md overflow-y-auto rounded-md border bg-popover p-2 text-popover-foreground shadow-md",
        placement === "bottom" ? "top-full mt-2" : "bottom-full mb-2",
      )}
      role="listbox"
      aria-label="Mention suggestions"
      aria-activedescendant={activeOption ? optionId(activeOption) : undefined}
    >
      {filtered.map((target, index) => {
        const Icon = target.targetType === "AGENT" ? Bot : UserRound;
        const isActive = index === activeIndex;
        return (
          <Button
            key={target.id}
            id={optionId(target)}
            type="button"
            variant="ghost"
            role="option"
            aria-selected={isActive}
            className={cn(
              "h-auto w-full items-start justify-start gap-2 rounded-sm px-2.5 py-2 text-left",
              isActive && "bg-accent text-accent-foreground",
            )}
            onClick={() => onSelect(target)}
          >
            <Icon
              className={cn(
                "mt-0.5 size-4 shrink-0 text-[#54a9ff]",
                isActive && "text-accent-foreground",
              )}
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="truncate text-sm">{target.displayName}</span>
                {target.role ? (
                  <span className="shrink-0 rounded-sm bg-muted px-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {target.role}
                  </span>
                ) : null}
              </span>
              {target.email ? (
                <span className="block truncate text-xs text-muted-foreground">
                  {target.email}
                </span>
              ) : null}
            </span>
          </Button>
        );
      })}
    </div>
  );
}
