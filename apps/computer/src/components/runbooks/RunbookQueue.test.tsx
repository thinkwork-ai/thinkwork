import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RunbookQueue } from "./RunbookQueue";

afterEach(cleanup);

describe("RunbookQueue", () => {
  it("renders tasks grouped under phases by status", () => {
    render(
      <RunbookQueue
        data={{
          runbookRunId: "run-1",
          displayName: "CRM Dashboard",
          status: "RUNNING",
          phases: [
            {
              id: "discover",
              title: "Discover",
              tasks: [
                {
                  id: "task-1",
                  title: "Find CRM sources",
                  status: "COMPLETED",
                },
              ],
            },
            {
              id: "produce",
              title: "Produce",
              tasks: [
                {
                  id: "task-2",
                  title: "Build dashboard",
                  summary: "Create the first dashboard artifact.",
                  status: "RUNNING",
                },
                {
                  id: "task-3",
                  title: "Validate output",
                  status: "PENDING",
                },
              ],
            },
          ],
        }}
      />,
    );

    expect(screen.getByRole("heading", { name: "CRM Dashboard" })).toBeTruthy();
    expect(screen.getByText("Discover")).toBeTruthy();
    expect(screen.getByText("Produce")).toBeTruthy();
    expect(screen.getByText("Find CRM sources")).toBeTruthy();
    expect(screen.getByText("Build dashboard")).toBeTruthy();
    expect(screen.getByText("Validate output")).toBeTruthy();
    expect(
      screen.getByText("Create the first dashboard artifact."),
    ).toBeTruthy();
    expect(
      screen.getAllByText(/completed|running|pending/i).length,
    ).toBeGreaterThan(0);
  });

  it("renders an ad hoc plan without approval controls", () => {
    render(
      <RunbookQueue
        data={{
          displayName: "Ad hoc research plan",
          phases: [
            {
              id: "plan",
              title: "Plan",
              tasks: [{ id: "task-1", title: "Scope the request" }],
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("Visible plan for this request.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /approve/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /reject/i })).toBeNull();
  });

  it("falls back safely for unknown task statuses", () => {
    render(
      <RunbookQueue
        data={{
          displayName: "Research Dashboard",
          phases: [
            {
              id: "phase-1",
              title: "A very long phase name that should wrap without overlap",
              tasks: [
                {
                  id: "task-1",
                  title:
                    "A very long task label that should wrap without escaping the queue item container",
                  status: "BLOCKED_BY_SOMETHING_NEW",
                },
              ],
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("blocked by something new")).toBeTruthy();
    expect(screen.getByText(/A very long task label/)).toBeTruthy();
  });
});
