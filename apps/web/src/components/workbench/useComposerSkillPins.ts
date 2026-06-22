import { useCallback, useEffect, useMemo, useState } from "react";
import type { KeyboardEvent } from "react";
import {
  currentSlashQuery,
  filterSkillCatalog,
  type SkillOption,
} from "@/components/spaces/SkillMenu";
import { isSkillCreatorSlashQuery } from "@/lib/skill-creator-command";

export const GOAL_SLASH_OPTION: SkillOption = {
  slug: "goal",
  displayName: "Goal",
  description: "Start a Goal run",
  reserved: "goal",
};

/**
 * Extract force-pinned skill slugs from composer text (plan 2026-06-04-004
 * U5/U6). Skills are inline `/slug` tokens — the same model as `@`-mentions —
 * not chips. On submit we scan the text for `/slug` tokens that match a real
 * catalog slug, so a user can type `/crm-dashboard` directly or pick from the
 * popup, and deleting the text removes the pin.
 */
export function extractPinnedSkillSlugs(
  value: string,
  catalog: SkillOption[],
): string[] {
  const known = new Set(catalog.map((skill) => skill.slug));
  const seen = new Set<string>();
  const slugs: string[] = [];
  for (const match of value.matchAll(/(?:^|\s)\/([\w.'-]+)/gu)) {
    const slug = match[1];
    if (slug && slug !== "goal" && known.has(slug) && !seen.has(slug)) {
      seen.add(slug);
      slugs.push(slug);
    }
  }
  return slugs;
}

/**
 * Composer state for the `/skill` force-pin popup (plan 2026-06-04-004 U5/U6).
 * Mirrors the `@`-mention machinery: a slash query opens a filtered popup, and
 * committing a skill inserts an inline `/slug` token into the draft. Pins are
 * read back out of the text on submit via {@link extractPinnedSkillSlugs} —
 * there are no chips.
 *
 * `handleKeyDown` returns true when it consumed the event, so the composer can
 * chain it after the mention handler (the two menus never open at once — `@`
 * vs `/`).
 */
export function useComposerSkillPins(params: {
  value: string;
  onChange: (value: string) => void;
  catalog: SkillOption[];
  goalDisabled?: boolean;
}) {
  const { value, onChange, catalog, goalDisabled = false } = params;
  const slashQuery = useMemo(() => currentSlashQuery(value), [value]);
  const slashOptions = useMemo(
    () => [
      {
        ...GOAL_SLASH_OPTION,
        disabled: goalDisabled,
        disabledReason: goalDisabled
          ? "Turn on agent handling to use Goal"
          : undefined,
      },
      ...catalog.filter((skill) => skill.slug !== GOAL_SLASH_OPTION.slug),
    ],
    [catalog, goalDisabled],
  );
  const options = useMemo(
    () =>
      slashQuery === null || isSkillCreatorSlashQuery(slashQuery)
        ? []
        : filterSkillCatalog(slashOptions, slashQuery),
    [slashQuery, slashOptions],
  );
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const menuOpen = slashQuery !== null && options.length > 0 && !dismissed;

  useEffect(() => {
    setActiveIndex(0);
    setDismissed(false);
  }, [slashQuery, options.length]);

  const selectSkill = useCallback(
    (skill: SkillOption) => {
      // Replace the `/query` token at the cursor with the canonical `/slug`
      // inline token (mirrors selectMention's `@name` insertion).
      const replacement = `/${skill.slug} `;
      const query = slashQuery ?? "";
      const prefix = value.slice(0, value.length - query.length - 1);
      onChange(`${prefix}${replacement}`);
      setDismissed(true);
    },
    [slashQuery, value, onChange],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>): boolean => {
      if (!menuOpen) return false;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((index) => (index + 1) % options.length);
        return true;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex(
          (index) => (index - 1 + options.length) % options.length,
        );
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const skill =
          options[Math.min(activeIndex, Math.max(options.length - 1, 0))];
        if (skill && !skill.disabled) selectSkill(skill);
        return true;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setDismissed(true);
        return true;
      }
      return false;
    },
    [menuOpen, options, activeIndex, selectSkill],
  );

  return {
    slashQuery,
    options,
    activeIndex,
    menuOpen,
    selectSkill,
    handleKeyDown,
  };
}
