import { describe, expect, it } from "vitest";
import { ownerRefreshPlan } from "./CanvasHeaderActions";

const THREAD = "33333333-3333-3333-3333-333333333333";

describe("ownerRefreshPlan (THINK-167)", () => {
  it("is done when nothing needs the user", () => {
    expect(
      ownerRefreshPlan(
        [{ bindingId: "b1", outcome: "REFRESHED", viewerIsOwner: false }],
        THREAD,
      ),
    ).toEqual({ kind: "done" });
    expect(ownerRefreshPlan([], THREAD)).toEqual({ kind: "done" });
  });

  it("owner-dispatches when the viewer owns every needs-user binding", () => {
    expect(
      ownerRefreshPlan(
        [
          { bindingId: "b1", outcome: "NEEDS_USER", viewerIsOwner: true },
          { bindingId: "b2", outcome: "REFRESHED", viewerIsOwner: false },
        ],
        THREAD,
      ),
    ).toEqual({ kind: "owner_dispatch", staleBindingIds: ["b1"] });
  });

  it("falls back to ask-agent when the viewer does not own a needs-user binding", () => {
    expect(
      ownerRefreshPlan(
        [
          { bindingId: "b1", outcome: "NEEDS_USER", viewerIsOwner: true },
          { bindingId: "b2", outcome: "NEEDS_USER", viewerIsOwner: false },
        ],
        THREAD,
      ),
    ).toEqual({ kind: "ask_agent" });
  });

  it("falls back to ask-agent when ownership is unknown (deploy skew: field absent)", () => {
    expect(
      ownerRefreshPlan([{ bindingId: "b1", outcome: "NEEDS_USER" }], THREAD),
    ).toEqual({ kind: "ask_agent" });
  });

  it("falls back to ask-agent when the canvas thread is unknown", () => {
    expect(
      ownerRefreshPlan(
        [{ bindingId: "b1", outcome: "NEEDS_USER", viewerIsOwner: true }],
        null,
      ),
    ).toEqual({ kind: "ask_agent" });
  });
});
