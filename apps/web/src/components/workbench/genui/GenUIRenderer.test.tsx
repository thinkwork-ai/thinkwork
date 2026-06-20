import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAnalyticsDisplayFixture } from "@thinkwork/analytics-display";
import {
  createAnalyticsDisplayGenUIPart,
  createTaskReviewGenUIFixture,
  createThreadGenUISpecHash,
  THREAD_GENUI_CATALOG_VERSION,
  THREAD_GENUI_SCHEMA_VERSION,
  type ThreadGenUIData,
} from "@thinkwork/genui";
import { GenUIErrorBoundary, GenUIRenderer } from "./GenUIRenderer";

afterEach(cleanup);

describe("GenUIRenderer", () => {
  it("renders a valid task review spec with disabled pending actions", () => {
    render(<GenUIRenderer data={createTaskReviewGenUIFixture().data} />);

    expect(screen.getByTestId("genui-task-review")).toBeTruthy();
    expect(screen.getByText("Review onboarding task")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: /Approve/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("renders workflow, list, and form catalog components", () => {
    render(
      <>
        <GenUIRenderer data={workflowStatusData()} />
        <GenUIRenderer data={keyValueListData()} />
        <GenUIRenderer data={actionFormData()} />
      </>,
    );

    expect(screen.getByTestId("genui-workflow-status")).toBeTruthy();
    expect(screen.getByText("Import customers")).toBeTruthy();
    expect(screen.getByTestId("genui-key-value-list")).toBeTruthy();
    expect(screen.getByText("Rows")).toBeTruthy();
    expect(screen.getByTestId("genui-action-form")).toBeTruthy();
    expect(
      (screen.getByLabelText("Run import") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("delegates analytical parts to the analytics-display adapter", () => {
    const part = createAnalyticsDisplayGenUIPart({
      id: "genui:analytics:support-volume",
      payload: createAnalyticsDisplayFixture(),
    });

    render(<GenUIRenderer data={part.data} />);

    expect(screen.getByTestId("analytics-display-part")).toBeTruthy();
    expect(screen.getByText("Support Volume")).toBeTruthy();
  });

  it("fails closed for unsupported native components", () => {
    render(<GenUIRenderer data={unsupportedComponentData()} />);

    expect(screen.getByTestId("genui-fallback")).toBeTruthy();
    expect(screen.getByText("unknown.panel")).toBeTruthy();
    expect(
      screen.getByText(/Unsupported Thread GenUI component unknown.panel/),
    ).toBeTruthy();
  });

  it("fails closed for malformed data-genui input", () => {
    render(<GenUIRenderer data={null} />);

    expect(screen.getByTestId("genui-fallback")).toBeTruthy();
    expect(
      screen.getByText("Thread GenUI data must be an object."),
    ).toBeTruthy();
  });

  it("keeps the last good live render beside an invalid same-id update warning", () => {
    const { rerender } = render(
      <GenUIRenderer data={createTaskReviewGenUIFixture().data} live />,
    );

    rerender(<GenUIRenderer data={unsupportedComponentData()} live />);

    expect(screen.getByTestId("genui-last-good")).toBeTruthy();
    expect(screen.getByText("Review onboarding task")).toBeTruthy();
    expect(screen.getByTestId("genui-rejected-update")).toBeTruthy();
  });

  it("converts renderer errors into a compact fallback", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    function ThrowingChild() {
      throw new Error("boom");
      return null;
    }

    render(
      <GenUIErrorBoundary fallbackData={createTaskReviewGenUIFixture().data}>
        <ThrowingChild />
      </GenUIErrorBoundary>,
    );

    expect(screen.getByTestId("genui-fallback")).toBeTruthy();
    expect(screen.getByText("Generated UI renderer failed.")).toBeTruthy();
    consoleError.mockRestore();
  });

  it("recovers from a renderer error when a new payload arrives", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const first = createTaskReviewGenUIFixture().data;
    const second = {
      ...createTaskReviewGenUIFixture().data,
      mobileFallback: {
        title: "Recovered task review",
        summary: "Recovered.",
      },
    };

    function ThrowingChild() {
      throw new Error("boom");
      return null;
    }

    const { rerender } = render(
      <GenUIErrorBoundary fallbackData={first}>
        <ThrowingChild />
      </GenUIErrorBoundary>,
    );

    rerender(
      <GenUIErrorBoundary fallbackData={second}>
        <div>Recovered renderer</div>
      </GenUIErrorBoundary>,
    );

    await waitFor(() => {
      expect(screen.getByText("Recovered renderer")).toBeTruthy();
    });
    consoleError.mockRestore();
  });
});

function workflowStatusData(): ThreadGenUIData {
  const spec: ThreadGenUIData["spec"] = {
    root: "workflow",
    elements: {
      workflow: {
        component: "workflow.status",
        props: {
          title: "Import customers",
          status: "running",
          steps: [
            {
              id: "extract",
              title: "Extract CSV",
              status: "completed",
              summary: "Rows loaded.",
            },
            {
              id: "map",
              title: "Map fields",
              status: "running",
            },
          ],
        },
      },
    },
  };
  return baseData(spec, {
    title: "Import customers",
    summary: "Import is running.",
  });
}

function keyValueListData(): ThreadGenUIData {
  const spec: ThreadGenUIData["spec"] = {
    root: "summary",
    elements: {
      summary: {
        component: "keyValue.list",
        props: {
          title: "Import summary",
          items: [
            { label: "Rows", value: 42 },
            { label: "Ready", value: true },
          ],
        },
      },
    },
  };
  return baseData(spec, {
    title: "Import summary",
    summary: "Two values.",
  });
}

function actionFormData(): ThreadGenUIData {
  const spec: ThreadGenUIData["spec"] = {
    root: "form",
    elements: {
      form: {
        component: "form.action",
        props: {
          title: "Import options",
          description: "Choose an import mode.",
          submitActionId: "submit-import",
          fields: [
            {
              id: "mode",
              label: "Mode",
              type: "select",
              required: true,
              options: ["Append", "Replace"],
            },
          ],
        },
      },
    },
  };
  return {
    ...baseData(spec, {
      title: "Import options",
      summary: "Choose an import mode.",
    }),
    actions: [
      {
        id: "submit-import",
        label: "Run import",
        kind: "submit",
        params: { importId: "import-1" },
      },
    ],
  };
}

function unsupportedComponentData(): ThreadGenUIData {
  const spec: ThreadGenUIData["spec"] = {
    root: "unknown",
    elements: {
      unknown: {
        component: "unknown.panel",
        props: { title: "Unsupported" },
      },
    },
  };
  return baseData(spec, {
    title: "Unsupported generated UI",
    summary: "This panel is not in the catalog.",
  });
}

function baseData(
  spec: ThreadGenUIData["spec"],
  fallback: ThreadGenUIData["mobileFallback"],
): ThreadGenUIData {
  return {
    schemaVersion: THREAD_GENUI_SCHEMA_VERSION,
    catalogVersion: THREAD_GENUI_CATALOG_VERSION,
    spec,
    status: "ready",
    mobileFallback: fallback,
    specHash: createThreadGenUISpecHash(spec),
  };
}
