/**
 * THINK-263 U6 — `use_memory` threading for palette "ask" turns.
 *
 * The invoke payload's `use_memory` is derived from the event's `askMode` flag:
 * an ask turn suppresses retention (false); every other turn opts in (true).
 * The retain runtime honors ONLY `true`, so this one value is the whole
 * retention-suppression contract — no retain-handler change is needed.
 */

import { describe, expect, it } from "vitest";

import { resolveTurnUseMemory } from "./chat-agent-invoke.js";

describe("resolveTurnUseMemory (THINK-263 U6)", () => {
  it("suppresses retention for an ask turn (askMode true → use_memory false)", () => {
    expect(resolveTurnUseMemory(true)).toBe(false);
  });

  it("opts in for a normal turn (askMode false/absent → use_memory true)", () => {
    expect(resolveTurnUseMemory(false)).toBe(true);
    expect(resolveTurnUseMemory(undefined)).toBe(true);
    expect(resolveTurnUseMemory(null)).toBe(true);
  });
});
