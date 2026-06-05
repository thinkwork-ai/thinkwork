import { Sparkles } from "lucide-react";
import { Button } from "@thinkwork/ui";
import { cn } from "@/lib/utils";

export interface SkillOption {
  slug: string;
  displayName?: string | null;
  description?: string | null;
  installed?: boolean;
}

interface SkillMenuProps {
  options: SkillOption[];
  query: string;
  activeIndex?: number;
  /** See MentionMenu — "top" grows upward (bottom-pinned composer), "bottom" downward. */
  placement?: "top" | "bottom";
  onSelect: (skill: SkillOption) => void;
}

/**
 * Detect a `/skill` slash-command query at the cursor (end of the draft),
 * mirroring `currentMentionQuery`. Returns the partial slug after `/`, or null
 * when the cursor is not in a slash context. Anchored to start-of-line or
 * whitespace so a literal slash mid-token (a path, a URL) does not trigger.
 */
export function currentSlashQuery(content: string): string | null {
  const match = /(?:^|\s)\/([\w.'-]*)$/u.exec(content);
  return match ? match[1] : null;
}

const skillLabel = (skill: SkillOption) =>
  skill.displayName?.trim() || skill.slug;

export function filterSkillCatalog(
  options: SkillOption[],
  query: string,
): SkillOption[] {
  const normalized = query.trim().toLowerCase();
  return options
    .filter((option) =>
      normalized
        ? option.slug.toLowerCase().includes(normalized) ||
          skillLabel(option).toLowerCase().includes(normalized) ||
          option.description?.toLowerCase().includes(normalized)
        : true,
    )
    .slice(0, 8);
}

export function SkillMenu({
  options,
  query,
  activeIndex = 0,
  placement = "top",
  onSelect,
}: SkillMenuProps) {
  const filtered = filterSkillCatalog(options, query);
  if (filtered.length === 0) return null;

  const optionId = (skill: SkillOption) => `skill-option-${skill.slug}`;
  const activeOption = filtered[Math.min(activeIndex, filtered.length - 1)];

  return (
    <div
      className={cn(
        "absolute left-0 z-20 max-h-[40vh] w-full max-w-md overflow-y-auto rounded-md border bg-popover p-2 text-popover-foreground shadow-md",
        placement === "bottom" ? "top-full mt-2" : "bottom-full mb-2",
      )}
      role="listbox"
      aria-label="Skill suggestions"
      aria-activedescendant={activeOption ? optionId(activeOption) : undefined}
    >
      {filtered.map((skill, index) => {
        const isActive = index === activeIndex;
        return (
          <Button
            key={skill.slug}
            id={optionId(skill)}
            type="button"
            variant="ghost"
            role="option"
            aria-selected={isActive}
            className={cn(
              "h-auto w-full items-start justify-start gap-2 rounded-sm px-2.5 py-2 text-left",
              isActive && "bg-accent text-accent-foreground",
            )}
            onClick={() => onSelect(skill)}
          >
            <Sparkles
              className={cn(
                "mt-0.5 size-4 shrink-0 text-[#54a9ff]",
                isActive && "text-accent-foreground",
              )}
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="truncate text-sm">{skillLabel(skill)}</span>
                {skill.installed ? null : (
                  <span className="shrink-0 rounded-sm bg-muted px-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                    catalog
                  </span>
                )}
              </span>
              {skill.description ? (
                <span className="block truncate text-xs text-muted-foreground">
                  {skill.description}
                </span>
              ) : null}
            </span>
          </Button>
        );
      })}
    </div>
  );
}
