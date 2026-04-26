import { describe, expect, it } from "vitest";
import { canSettleWorkspaceRunFromTurn } from "../lib/workspace-events/run-lifecycle.js";

describe("workspace run lifecycle helpers", () => {
  it("allows wakeup turn outcomes to settle only in-flight run states", () => {
    expect(canSettleWorkspaceRunFromTurn("pending")).toBe(true);
    expect(canSettleWorkspaceRunFromTurn("claimed")).toBe(true);
    expect(canSettleWorkspaceRunFromTurn("processing")).toBe(true);

    expect(canSettleWorkspaceRunFromTurn("awaiting_review")).toBe(false);
    expect(canSettleWorkspaceRunFromTurn("awaiting_subrun")).toBe(false);
    expect(canSettleWorkspaceRunFromTurn("cancelled")).toBe(false);
    expect(canSettleWorkspaceRunFromTurn("completed")).toBe(false);
    expect(canSettleWorkspaceRunFromTurn("failed")).toBe(false);
  });
});
