import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  extractPinnedSkillSlugs,
  useComposerSkillPins,
} from "./useComposerSkillPins";
import type { SkillOption } from "@/components/spaces/SkillMenu";

const catalog: SkillOption[] = [
  { slug: "crm-dashboard", displayName: "CRM Dashboard" },
  { slug: "invoice-parser", displayName: "Invoice Parser" },
];

function setup(initialValue: string, options: { goalDisabled?: boolean } = {}) {
  const onChange = vi.fn();
  const view = renderHook(
    ({ v }: { v: string }) =>
      useComposerSkillPins({
        value: v,
        onChange,
        catalog,
        goalDisabled: options.goalDisabled,
      }),
    { initialProps: { v: initialValue } },
  );
  return { ...view, onChange };
}

describe("extractPinnedSkillSlugs", () => {
  it("pulls inline /slug tokens that match a catalog slug", () => {
    expect(
      extractPinnedSkillSlugs("hey /crm-dashboard pull the account", catalog),
    ).toEqual(["crm-dashboard"]);
  });

  it("matches a token at the very start of the text", () => {
    expect(extractPinnedSkillSlugs("/invoice-parser", catalog)).toEqual([
      "invoice-parser",
    ]);
  });

  it("ignores /tokens that are not catalog slugs (paths, unknown)", () => {
    expect(extractPinnedSkillSlugs("see /Users/eric/file", catalog)).toEqual(
      [],
    );
    expect(extractPinnedSkillSlugs("/not-a-skill", catalog)).toEqual([]);
  });

  it("reserves /goal for composer goal mode instead of skill pinning", () => {
    expect(
      extractPinnedSkillSlugs("/goal reconcile the list", [
        ...catalog,
        { slug: "goal", displayName: "Goal Skill" },
      ]),
    ).toEqual([]);
  });

  it("does not match a slash mid-token (urls)", () => {
    expect(
      extractPinnedSkillSlugs("https://x.com/crm-dashboard", catalog),
    ).toEqual([]);
  });

  it("dedupes repeated tokens", () => {
    expect(
      extractPinnedSkillSlugs(
        "/crm-dashboard and again /crm-dashboard",
        catalog,
      ),
    ).toEqual(["crm-dashboard"]);
  });

  it("returns [] for an empty catalog", () => {
    expect(extractPinnedSkillSlugs("/crm-dashboard", [])).toEqual([]);
  });
});

describe("useComposerSkillPins", () => {
  it("opens the menu while a slash query matches the catalog", () => {
    const { result } = setup("/cr");
    expect(result.current.menuOpen).toBe(true);
    expect(result.current.options.map((o) => o.slug)).toEqual([
      "crm-dashboard",
    ]);
  });

  it("shows Goal as a reserved slash option", () => {
    const { result } = setup("/go");
    expect(result.current.menuOpen).toBe(true);
    expect(result.current.options.map((o) => o.slug)).toEqual(["goal"]);
    expect(result.current.options[0]?.reserved).toBe("goal");
  });

  it("does not open the menu without a slash query", () => {
    const { result } = setup("hello");
    expect(result.current.menuOpen).toBe(false);
  });

  it("selecting a skill replaces the /query with an inline /slug token", () => {
    const { result, onChange } = setup("find me /cr");
    act(() => result.current.selectSkill(catalog[0]!));
    expect(onChange).toHaveBeenCalledWith("find me /crm-dashboard ");
  });

  it("selecting Goal inserts the reserved /goal token", () => {
    const { result, onChange } = setup("/go");
    act(() => result.current.selectSkill(result.current.options[0]!));
    expect(onChange).toHaveBeenCalledWith("/goal ");
  });

  it("marks Goal disabled when agent handling is off", () => {
    const { result } = setup("/go", { goalDisabled: true });
    expect(result.current.options[0]).toMatchObject({
      slug: "goal",
      disabled: true,
      disabledReason: "Turn on agent handling to use Goal",
    });
  });

  it("Enter commits the active option as inline text", () => {
    const { result, onChange } = setup("/cr");
    act(() => {
      result.current.handleKeyDown({
        key: "Enter",
        preventDefault: vi.fn(),
      } as never);
    });
    expect(onChange).toHaveBeenCalledWith("/crm-dashboard ");
  });

  it("Escape closes the menu; the event is consumed", () => {
    const { result } = setup("/cr");
    let handled = false;
    act(() => {
      handled = result.current.handleKeyDown({
        key: "Escape",
        preventDefault: vi.fn(),
      } as never);
    });
    expect(handled).toBe(true);
    expect(result.current.menuOpen).toBe(false);
  });

  it("handleKeyDown returns false when the menu is closed (lets mention nav run)", () => {
    const { result } = setup("hello");
    let handled = true;
    act(() => {
      handled = result.current.handleKeyDown({
        key: "ArrowDown",
        preventDefault: vi.fn(),
      } as never);
    });
    expect(handled).toBe(false);
  });
});
