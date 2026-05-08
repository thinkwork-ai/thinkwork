import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TaskDashboard } from "./TaskDashboard";

afterEach(cleanup);

describe("TaskDashboard", () => {
  it("renders tasks with status, previews, and artifact chips", () => {
    render(
      <TaskDashboard
        tasks={[
          {
            id: "task-1",
            title: "Build CRM dashboard",
            lifecycleStatus: "COMPLETED",
            lastResponsePreview: "Created a pipeline risk app.",
            artifactCount: 1,
            updatedAt: "2026-05-08T16:00:00.000Z",
          },
        ]}
      />,
    );

    expect(screen.getByText("Build CRM dashboard")).toBeTruthy();
    expect(screen.getByText("Created a pipeline risk app.")).toBeTruthy();
    expect(screen.getByText("COMPLETED")).toBeTruthy();
    expect(screen.getByText("1 artifact")).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: /build crm dashboard/i })
        .getAttribute("href"),
    ).toBe("/tasks/task-1");
  });

  it("renders an empty state when there are no tasks", () => {
    render(<TaskDashboard tasks={[]} />);

    expect(screen.getByText("No tasks yet")).toBeTruthy();
  });
});
