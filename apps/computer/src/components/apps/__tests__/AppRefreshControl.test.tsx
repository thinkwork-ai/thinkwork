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

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => {
      expect(onRefresh).toHaveBeenCalledTimes(1);
      expect(onData).toHaveBeenCalledWith({ refreshed: true });
    });
    expect(agentInvoke).not.toHaveBeenCalled();
    expect(screen.getByText("Succeeded")).toBeTruthy();
    expect(screen.getByText("crm")).toBeTruthy();
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

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await screen.findByText("Partial success");
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

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await screen.findByText("CRM unavailable");
    expect(screen.getByText("Failed")).toBeTruthy();
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

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await screen.findByText("No sources refreshed");
    expect(screen.getByText("Failed")).toBeTruthy();
    expect(onData).not.toHaveBeenCalled();
  });
});
