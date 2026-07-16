/**
 * THINK-301 U6 (parent R5/R6, AE4): superseded-turn collapse — a turn whose
 * id appears as another turn's originTurnId is hidden so the thread shows
 * exactly one final answer per prompt, with no trace of the recovery.
 */

import { describe, expect, it } from "vitest";
import { collapseSupersededTurns } from "./turn-collapse";

const t = (id: string, originTurnId?: string | null) => ({
  id,
  originTurnId: originTurnId ?? null,
});

describe("collapseSupersededTurns", () => {
  it("hides an origin turn in favor of its successor attempt (AE4)", () => {
    const origin = t("origin");
    const successor = t("successor", "origin");
    expect(collapseSupersededTurns([origin, successor])).toEqual([successor]);
  });

  it("collapses chains transitively to the last attempt", () => {
    const a = t("a");
    const b = t("b", "a");
    const c = t("c", "b");
    expect(collapseSupersededTurns([a, b, c])).toEqual([c]);
  });

  it("keeps a turn whose originTurnId points outside the list", () => {
    const orphanSuccessor = t("successor", "not-in-list");
    const other = t("other");
    expect(collapseSupersededTurns([orphanSuccessor, other])).toEqual([
      orphanSuccessor,
      other,
    ]);
  });

  it("passes through empty and successor-free lists unchanged", () => {
    expect(collapseSupersededTurns([])).toEqual([]);
    const turns = [t("a"), t("b")];
    expect(collapseSupersededTurns(turns)).toEqual(turns);
  });
});
