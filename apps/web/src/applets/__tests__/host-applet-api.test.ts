import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMutation, useQuery } from "urql";
import {
  createHostAppletAPI,
  registerAppletRefreshHandler,
} from "../host-applet-api";

vi.mock("urql", async (importOriginal) => {
  const actual = await importOriginal<typeof import("urql")>();
  return {
    ...actual,
    useMutation: vi.fn(),
    useQuery: vi.fn(),
  };
});

const executeMutation = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  executeMutation.mockResolvedValue({
    data: {
      saveAppletState: {
        value: { agenda: ["saved"] },
      },
    },
  });
  vi.mocked(useMutation).mockReturnValue([
    { fetching: false, stale: false, hasNext: false },
    executeMutation,
  ]);
  vi.mocked(useQuery).mockReturnValue([
    {
      data: null,
      fetching: false,
      stale: false,
      hasNext: false,
    },
    vi.fn(),
  ]);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("createHostAppletAPI", () => {
  it("restores applet state from GraphQL and debounces saves", async () => {
    vi.mocked(useQuery).mockReturnValue([
      {
        data: {
          appletState: {
            value: { agenda: ["loaded"] },
          },
        },
        fetching: false,
        stale: false,
        hasNext: false,
      },
      vi.fn(),
    ]);
    const api = createHostAppletAPI("app-1", "instance-1");

    const { result } = renderHook(() =>
      api.useAppletState<{ agenda: string[] }>("agenda", { agenda: [] }),
    );

    expect(result.current[0]).toEqual({ agenda: ["loaded"] });

    act(() => result.current[1]({ agenda: ["draft"] }));
    expect(executeMutation).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(executeMutation).toHaveBeenCalledWith({
      input: {
        appId: "app-1",
        instanceId: "instance-1",
        key: "agenda",
        value: { agenda: ["draft"] },
      },
    });
  });

  it("persists only the final value after rapid sequential setters", async () => {
    const api = createHostAppletAPI("app-1", "instance-1");
    const { result } = renderHook(() =>
      api.useAppletState<string[]>("agenda", []),
    );

    act(() => result.current[1](["first"]));
    act(() => {
      vi.advanceTimersByTime(500);
    });
    act(() => result.current[1](["second"]));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(executeMutation).toHaveBeenCalledTimes(1);
    expect(executeMutation).toHaveBeenCalledWith({
      input: {
        appId: "app-1",
        instanceId: "instance-1",
        key: "agenda",
        value: ["second"],
      },
    });
  });

  it("scopes state writes by applet instance", async () => {
    const firstApi = createHostAppletAPI("app-1", "instance-1");
    const secondApi = createHostAppletAPI("app-1", "instance-2");
    const first = renderHook(() =>
      firstApi.useAppletState<string[]>("agenda", []),
    );
    const second = renderHook(() =>
      secondApi.useAppletState<string[]>("agenda", []),
    );

    act(() => first.result.current[1](["first"]));
    act(() => second.result.current[1](["second"]));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(executeMutation).toHaveBeenCalledWith({
      input: expect.objectContaining({
        instanceId: "instance-1",
        value: ["first"],
      }),
    });
    expect(executeMutation).toHaveBeenCalledWith({
      input: expect.objectContaining({
        instanceId: "instance-2",
        value: ["second"],
      }),
    });
  });

  it("rejects unknown curated query names clearly", () => {
    const api = createHostAppletAPI("app-1", "instance-1");

    expect(() => renderHook(() => api.useAppletQuery("unknownField"))).toThrow(
      'Unknown applet query "unknownField"',
    );
  });

  it("returns in-memory state and exposes write errors without data loss", async () => {
    executeMutation.mockResolvedValueOnce({
      error: new Error("network down"),
    });
    const api = createHostAppletAPI("app-1", "instance-1");
    const { result } = renderHook(() =>
      api.useAppletState<string[]>("agenda", []),
    );

    act(() => result.current[1](["draft"]));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(result.current[0]).toEqual(["draft"]);
    expect(result.current[2].error?.message).toBe("network down");
  });

  it("routes refresh through the registered applet export", async () => {
    const refresh = vi.fn().mockResolvedValue({
      data: { ok: true },
      sourceStatuses: { crm: "success" },
    });
    registerAppletRefreshHandler("app-1", "instance-1", refresh);
    const api = createHostAppletAPI("app-1", "instance-1");

    await expect(api.refresh()).resolves.toEqual({
      data: { ok: true },
      sourceStatuses: { crm: "success" },
    });
    expect(refresh).toHaveBeenCalledTimes(1);

    registerAppletRefreshHandler("app-1", "instance-1", null);
    await expect(api.refresh()).rejects.toThrow(
      "This app does not expose a deterministic refresh function.",
    );
  });
});
