/**
 * Plan-review editor tests (THINK-193 U3, AE2): the editor renders the
 * preflight plan, and the approve override can only NARROW it.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  preflightPlanFromEvidence,
  WorkflowPlanReview,
} from "./WorkflowPlanReview";
import type { WorkflowEvidenceItem } from "./WorkflowEvidencePanel";

afterEach(cleanup);

const PLAN = {
  generatedAt: "2026-07-12T00:00:00Z",
  sources: [
    {
      sourceConfigId: "src-1",
      sourceFamily: "twenty",
      sourceBindingKey: "bind-1",
      enabled: true,
      grantStatus: "active",
      effectiveMaxRecords: 100,
      checkpointAdvancedAt: null,
      recentEvidenceCount: 3,
    },
    {
      sourceConfigId: "src-2",
      sourceFamily: "twenty",
      sourceBindingKey: "bind-2",
      enabled: true,
      grantStatus: "active",
      effectiveMaxRecords: 50,
      checkpointAdvancedAt: null,
      recentEvidenceCount: 0,
    },
    {
      sourceConfigId: "src-blocked",
      sourceFamily: "twenty",
      sourceBindingKey: "bind-3",
      enabled: true,
      grantStatus: "missing",
      effectiveMaxRecords: null,
      checkpointAdvancedAt: null,
      recentEvidenceCount: 0,
    },
  ],
  focus: [
    { key: "twenty:c-1", label: "Acme" },
    { key: "twenty:c-2", label: "Globex" },
  ],
};

function evidenceWithPlan(): WorkflowEvidenceItem[] {
  return [
    {
      id: "ev-1",
      evidenceType: "step_output",
      sourceSystem: "workflow_interpreter",
      redactionState: "summary_only",
      summary: {
        stepId: "preflight",
        stepKind: "memory_stage",
        iteration: 1,
        output: { stage: "preflight", plan: PLAN },
      },
    },
  ];
}

describe("preflightPlanFromEvidence", () => {
  it("extracts the plan from step-output evidence", () => {
    const plan = preflightPlanFromEvidence(evidenceWithPlan());
    expect(plan?.sources).toHaveLength(3);
    expect(plan?.focus).toEqual(PLAN.focus);
  });

  it("returns null when no evidence carries a plan", () => {
    expect(
      preflightPlanFromEvidence([
        {
          id: "ev-2",
          evidenceType: "step_output",
          sourceSystem: "workflow_interpreter",
          redactionState: "summary_only",
          summary: { stepId: "acquire", output: { counts: {} } },
        },
      ]),
    ).toBeNull();
  });
});

describe("WorkflowPlanReview", () => {
  it("renders sources grouped with grant status; blocked sources are not selectable", () => {
    render(
      <WorkflowPlanReview
        plan={preflightPlanFromEvidence(evidenceWithPlan())!}
        busy={false}
        error={null}
        onDecide={vi.fn()}
      />,
    );
    expect(screen.getAllByText("twenty")).toHaveLength(3);
    const blocked = screen.getByLabelText(
      "Include twenty source bind-3",
    ) as HTMLInputElement;
    expect(blocked.disabled).toBe(true);
    expect(blocked.checked).toBe(false);
  });

  it("approving with a deselected source sends a narrowed override", () => {
    const onDecide = vi.fn();
    render(
      <WorkflowPlanReview
        plan={preflightPlanFromEvidence(evidenceWithPlan())!}
        busy={false}
        error={null}
        onDecide={onDecide}
      />,
    );
    fireEvent.click(screen.getByLabelText("Include twenty source bind-2"));
    fireEvent.click(screen.getByRole("button", { name: "Approve plan" }));
    expect(onDecide).toHaveBeenCalledWith(true, null, {
      sourceConfigIds: ["src-1"],
    });
  });

  it("rejects a record limit above the saved cap client-side", () => {
    const onDecide = vi.fn();
    render(
      <WorkflowPlanReview
        plan={preflightPlanFromEvidence(evidenceWithPlan())!}
        busy={false}
        error={null}
        onDecide={onDecide}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Record limit/), {
      target: { value: "9999" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Approve plan" }));
    expect(onDecide).not.toHaveBeenCalled();
    expect(screen.getByText(/can only narrow the saved boundary/)).toBeTruthy();
  });

  it("approving untouched sends NO override (the saved plan runs as-is)", () => {
    const onDecide = vi.fn();
    render(
      <WorkflowPlanReview
        plan={preflightPlanFromEvidence(evidenceWithPlan())!}
        busy={false}
        error={null}
        onDecide={onDecide}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Approve plan" }));
    expect(onDecide).toHaveBeenCalledWith(true, null, null);
  });

  it("cancel run denies without an override", () => {
    const onDecide = vi.fn();
    render(
      <WorkflowPlanReview
        plan={preflightPlanFromEvidence(evidenceWithPlan())!}
        busy={false}
        error={null}
        onDecide={onDecide}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel run" }));
    expect(onDecide).toHaveBeenCalledWith(false, null, null);
  });
});
