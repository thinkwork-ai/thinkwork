import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRefreshControl } from "../AppRefreshControl";

afterEach(cleanup);

describe("AppRefreshControl", () => {
  it("invokes the applet refresh export and emits all-success data", async () => {
    const onRefresh = vi.fn().mockResolvedValue({
      data: { refreshed: true },
      sourceStatuses: { crm: "success", email: "success" },
    });
    const onData = vi.fn();
    const agentInvoke = vi.fn();

    render(<AppRefreshControl onRefresh={onRefresh} onData={onData} />);

    await clickRefresh();

    await waitFor(() => {
      expect(onRefresh).toHaveBeenCalledTimes(1);
      expect(onData).toHaveBeenCalledWith({ refreshed: true });
    });
    expect(agentInvoke).not.toHaveBeenCalled();
    await openActionsMenu();
    expect(screen.getByText("Refresh completed.")).toBeTruthy();
  });

  it("shows partial source coverage while still applying refreshed data", async () => {
    const onData = vi.fn();
    render(
      <AppRefreshControl
        onData={onData}
        onRefresh={async () => ({
          data: { rows: [1] },
          sourceStatuses: { crm: "success", email: "partial" },
        })}
      />,
    );

    await clickRefresh();

    await openActionsMenu();
    expect(screen.getByText(/Partial refresh: email/)).toBeTruthy();
    expect(onData).toHaveBeenCalledWith({ rows: [1] });
  });

  it("preserves prior data when refresh throws", async () => {
    const onData = vi.fn();
    render(
      <AppRefreshControl
        onData={onData}
        onRefresh={async () => {
          throw new Error("CRM unavailable");
        }}
      />,
    );

    await clickRefresh();

    await openActionsMenu();
    expect(screen.getByText("CRM unavailable")).toBeTruthy();
    expect(onData).not.toHaveBeenCalled();
  });

  it("preserves prior data when all sources fail with null data", async () => {
    const onData = vi.fn();
    render(
      <AppRefreshControl
        onData={onData}
        onRefresh={async () => ({
          data: null,
          sourceStatuses: { crm: "failed", email: "failed" },
          errors: [{ message: "No sources refreshed" }],
        })}
      />,
    );

    await clickRefresh();

    await openActionsMenu();
    expect(screen.getByText("No sources refreshed")).toBeTruthy();
    expect(onData).not.toHaveBeenCalled();
  });
});

async function clickRefresh() {
  await openActionsMenu();
  fireEvent.click(await screen.findByRole("menuitem", { name: "Refresh" }));
}

async function openActionsMenu() {
  fireEvent.keyDown(
    await screen.findByRole("button", { name: "Artifact actions" }),
    { key: "Enter", code: "Enter" },
  );
}
