import { useCallback, useEffect, useMemo, useState } from "react";
import type { KeyboardEvent } from "react";
import {
  currentSlashQuery,
  filterSkillCatalog,
  type SkillOption,
} from "@/components/spaces/SkillMenu";

export interface SkillPin {
  slug: string;
  displayName: string;
}

/**
 * Composer state for force-pinned skills (plan 2026-06-04-004 U5/U6). Mirrors
 * the `@`-mention machinery in the composers, but a committed skill becomes a
 * removable chip (per-message, like an attachment) rather than inline text. The
 * `/query` token is stripped from the draft on commit.
 *
 * `handleKeyDown` returns true when it consumed the event, so the composer can
 * chain it after the mention handler (the two menus never open at once — `@` vs
 * `/`).
 */
export function useComposerSkillPins(params: {
  value: string;
  onChange: (value: string) => void;
  catalog: SkillOption[];
}) {
  const { value, onChange, catalog } = params;
  const [pins, setPins] = useState<SkillPin[]>([]);
  const slashQuery = useMemo(() => currentSlashQuery(value), [value]);
  const options = useMemo(
    () => (slashQuery === null ? [] : filterSkillCatalog(catalog, slashQuery)),
    [slashQuery, catalog],
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
      // Strip the `/query` token at the cursor — the pin becomes a chip, not
      // inline text. Token length is "/" (1) + the partial query.
      const query = slashQuery ?? "";
      const prefix = value.slice(0, value.length - query.length - 1);
      onChange(prefix);
      setPins((current) =>
        current.some((pin) => pin.slug === skill.slug)
          ? current
          : [
              ...current,
              {
                slug: skill.slug,
                displayName: skill.displayName?.trim() || skill.slug,
              },
            ],
      );
      setDismissed(true);
    },
    [slashQuery, value, onChange],
  );

  const removePin = useCallback(
    (slug: string) =>
      setPins((current) => current.filter((pin) => pin.slug !== slug)),
    [],
  );

  const clearPins = useCallback(() => setPins([]), []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
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
        if (skill) selectSkill(skill);
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
    pins,
    setPins,
    slashQuery,
    options,
    activeIndex,
    menuOpen,
    selectSkill,
    removePin,
    clearPins,
    handleKeyDown,
  };
}
