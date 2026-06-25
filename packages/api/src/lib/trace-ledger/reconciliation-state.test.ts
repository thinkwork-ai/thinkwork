import { describe, expect, it } from "vitest";
import {
  assertEvidenceBackedTransition,
  deriveCurrentReconciliationState,
  isTraceReconciliationState,
} from "./reconciliation-state.js";

describe("trace reconciliation state lifecycle", () => {
  it("recognizes only the canonical reconciliation states", () => {
    expect(isTraceReconciliationState("runtime-reported")).toBe(true);
    expect(isTraceReconciliationState("invocation-reconciled")).toBe(true);
    expect(isTraceReconciliationState("bill-reconciled")).toBe(true);
    expect(isTraceReconciliationState("mismatch")).toBe(true);
    expect(isTraceReconciliationState("unreconciled/error")).toBe(true);
    expect(isTraceReconciliationState("estimated")).toBe(false);
  });

  it("derives the strongest reconciled state while preserving append-only facts", () => {
    expect(
      deriveCurrentReconciliationState([
        { state: "runtime-reported", scope: "runtime" },
        {
          state: "invocation-reconciled",
          scope: "invocation",
          evidenceId: "bedrock-log-1",
        },
        {
          state: "bill-reconciled",
          scope: "bill",
          evidenceId: "cur-row-1",
        },
      ]),
    ).toBe("bill-reconciled");
  });

  it("keeps mismatch visible until an operator resolution unit records disposition", () => {
    expect(
      deriveCurrentReconciliationState([
        { state: "runtime-reported", scope: "runtime" },
        { state: "mismatch", scope: "invocation", evidenceId: "bedrock-1" },
        {
          state: "invocation-reconciled",
          scope: "invocation",
          evidenceId: "bedrock-2",
        },
      ]),
    ).toBe("mismatch");
  });

  it("defaults missing historical evidence to unreconciled", () => {
    expect(deriveCurrentReconciliationState([])).toBe("unreconciled/error");
  });

  it("requires source evidence for provider and bill-grade transitions", () => {
    expect(() =>
      assertEvidenceBackedTransition({
        state: "bill-reconciled",
        scope: "bill",
      }),
    ).toThrow(/requires source evidence/);
    expect(() =>
      assertEvidenceBackedTransition({
        state: "runtime-reported",
        scope: "runtime",
      }),
    ).not.toThrow();
  });
});
