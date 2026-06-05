import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useComposerSkillPins } from "./useComposerSkillPins";
import type { SkillOption } from "@/components/spaces/SkillMenu";

const catalog: SkillOption[] = [
  { slug: "crm-dashboard", displayName: "CRM Dashboard" },
  { slug: "invoice-parser", displayName: "Invoice Parser" },
];

function setup(initialValue: string) {
  const onChange = vi.fn();
  const view = renderHook(
    ({ v }: { v: string }) =>
      useComposerSkillPins({ value: v, onChange, catalog }),
    { initialProps: { v: initialValue } },
  );
  return { ...view, onChange };
}

describe("useComposerSkillPins", () => {
  it("opens the menu while a slash query matches the catalog", () => {
    const { result } = setup("/cr");
    expect(result.current.menuOpen).toBe(true);
    expect(result.current.options.map((o) => o.slug)).toEqual([
      "crm-dashboard",
    ]);
  });

  it("does not open the menu without a slash query", () => {
    const { result } = setup("hello");
    expect(result.current.menuOpen).toBe(false);
  });

  it("selecting a skill strips the /query token and adds a pin", () => {
    const { result, onChange } = setup("find me /cr");
    act(() => result.current.selectSkill(catalog[0]!));
    expect(onChange).toHaveBeenCalledWith("find me ");
    expect(result.current.pins).toEqual([
      { slug: "crm-dashboard", displayName: "CRM Dashboard" },
    ]);
  });

  it("dedupes a skill already pinned", () => {
    const { result } = setup("/cr");
    act(() => result.current.selectSkill(catalog[0]!));
    act(() => result.current.selectSkill(catalog[0]!));
    expect(result.current.pins).toHaveLength(1);
  });

  it("removePin and clearPins drop pins", () => {
    const { result } = setup("/cr");
    act(() => result.current.selectSkill(catalog[0]!));
    act(() => result.current.selectSkill(catalog[1]!));
    expect(result.current.pins).toHaveLength(2);
    act(() => result.current.removePin("crm-dashboard"));
    expect(result.current.pins.map((p) => p.slug)).toEqual(["invoice-parser"]);
    act(() => result.current.clearPins());
    expect(result.current.pins).toEqual([]);
  });

  it("Escape closes the menu; the event is consumed", () => {
    const { result } = setup("/cr");
    const preventDefault = vi.fn();
    let handled = false;
    act(() => {
      handled = result.current.handleKeyDown({
        key: "Escape",
        preventDefault,
      } as never);
    });
    expect(handled).toBe(true);
    expect(result.current.menuOpen).toBe(false);
  });

  it("Enter commits the active option", () => {
    const { result, onChange } = setup("/cr");
    act(() => {
      result.current.handleKeyDown({
        key: "Enter",
        preventDefault: vi.fn(),
      } as never);
    });
    expect(onChange).toHaveBeenCalledWith("");
    expect(result.current.pins.map((p) => p.slug)).toEqual(["crm-dashboard"]);
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
