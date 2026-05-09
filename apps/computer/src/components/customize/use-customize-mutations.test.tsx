import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMutation, useQuery } from "urql";
import { toast } from "sonner";
import {
  useConnectorMutation,
  useSkillMutation,
  useToggleMutation,
  useWorkflowMutation,
  MCP_VIA_MOBILE_HINT,
  BUILTIN_TOOL_HINT,
} from "./use-customize-mutations";
import {
  EnableConnectorMutation,
  DisableConnectorMutation,
  EnableSkillMutation,
  DisableSkillMutation,
  EnableWorkflowMutation,
  DisableWorkflowMutation,
} from "@/lib/graphql-queries";

vi.mock("urql", async (importOriginal) => {
  const actual = await importOriginal<typeof import("urql")>();
  return {
    ...actual,
    useMutation: vi.fn(),
    useQuery: vi.fn(),
  };
});

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    message: vi.fn(),
  },
}));

const enableExec = vi.fn();
const disableExec = vi.fn();
const useMutationMock = vi.mocked(useMutation);
const useQueryMock = vi.mocked(useQuery);
const toastError = vi.mocked(toast.error);
const toastMessage = vi.mocked(toast.message);

function setComputerId(id: string | null): void {
  useQueryMock.mockReturnValue([
    {
      data: id ? { myComputer: { id } } : null,
      fetching: false,
      stale: false,
      hasNext: false,
    },
    vi.fn(),
  ] as ReturnType<typeof useQuery>);
}

beforeEach(() => {
  enableExec.mockReset();
  disableExec.mockReset();
  toastError.mockReset();
  toastMessage.mockReset();
  enableExec.mockResolvedValue({});
  disableExec.mockResolvedValue({});
  // useMutation is called once per enable mutation, then once per disable
  // mutation. The shared helper instantiates them in that order.
  useMutationMock.mockImplementation(((doc: unknown) => {
    const isEnable =
      doc === EnableConnectorMutation ||
      doc === EnableSkillMutation ||
      doc === EnableWorkflowMutation;
    return [
      { fetching: false, stale: false, hasNext: false },
      isEnable ? enableExec : disableExec,
    ] as ReturnType<typeof useMutation>;
  }) as unknown as typeof useMutation);
  setComputerId("computer-1");
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useToggleMutation core", () => {
  const opts = {
    enableMutation: EnableConnectorMutation,
    disableMutation: DisableConnectorMutation,
    typenames: ["Connector", "ConnectorBinding", "CustomizeBindings"] as const,
    buildVariables: (computerId: string, slug: string) => ({
      input: { computerId, slug },
    }),
    errorCodeHints: { CUSTOMIZE_MCP_NOT_SUPPORTED: MCP_VIA_MOBILE_HINT },
  };

  it("enable path passes additionalTypenames and the helper-built variables", async () => {
    const { result } = renderHook(() => useToggleMutation(opts));
    await act(async () => {
      await result.current.toggle("slack", true);
    });
    expect(enableExec).toHaveBeenCalledWith(
      { input: { computerId: "computer-1", slug: "slack" } },
      {
        additionalTypenames: [
          "Connector",
          "ConnectorBinding",
          "CustomizeBindings",
        ],
      },
    );
    expect(disableExec).not.toHaveBeenCalled();
  });

  it("disable path routes to the disable mutation with the same shape", async () => {
    const { result } = renderHook(() => useToggleMutation(opts));
    await act(async () => {
      await result.current.toggle("slack", false);
    });
    expect(disableExec).toHaveBeenCalledWith(
      { input: { computerId: "computer-1", slug: "slack" } },
      expect.objectContaining({
        additionalTypenames: expect.arrayContaining(["Connector"]),
      }),
    );
    expect(enableExec).not.toHaveBeenCalled();
  });

  it("pendingSlugs Set tracks the in-flight key and clears after resolution", async () => {
    let resolveEnable: (value: unknown) => void = () => {};
    enableExec.mockImplementation(
      () => new Promise((resolve) => (resolveEnable = resolve)),
    );
    const { result } = renderHook(() => useToggleMutation(opts));
    let togglePromise: Promise<void> | undefined;
    act(() => {
      togglePromise = result.current.toggle("slack", true);
    });
    expect(result.current.pendingSlugs.has("slack")).toBe(true);
    await act(async () => {
      resolveEnable({});
      await togglePromise;
    });
    expect(result.current.pendingSlugs.has("slack")).toBe(false);
  });

  it("error code with a registered hint surfaces toast.message", async () => {
    enableExec.mockResolvedValue({
      error: {
        message: "fallback should not surface",
        graphQLErrors: [
          { extensions: { code: "CUSTOMIZE_MCP_NOT_SUPPORTED" } },
        ],
      },
    });
    const { result } = renderHook(() => useToggleMutation(opts));
    await act(async () => {
      await result.current.toggle("slack", true);
    });
    expect(toastMessage).toHaveBeenCalledWith(MCP_VIA_MOBILE_HINT);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("error code without a registered hint falls back to toast.error", async () => {
    enableExec.mockResolvedValue({
      error: {
        message: "Custom failure",
        graphQLErrors: [
          { extensions: { code: "SOMETHING_ELSE" } },
        ],
      },
    });
    const { result } = renderHook(() => useToggleMutation(opts));
    await act(async () => {
      await result.current.toggle("slack", true);
    });
    expect(toastError).toHaveBeenCalledWith("Custom failure");
    expect(toastMessage).not.toHaveBeenCalled();
  });

  it("missing computer id surfaces a toast and skips both mutations", async () => {
    setComputerId(null);
    const { result } = renderHook(() => useToggleMutation(opts));
    await act(async () => {
      await result.current.toggle("slack", true);
    });
    expect(toastError).toHaveBeenCalledWith(
      expect.stringMatching(/Couldn't resolve your Computer/),
    );
    expect(enableExec).not.toHaveBeenCalled();
    expect(disableExec).not.toHaveBeenCalled();
  });
});

describe("useConnectorMutation regression (composes useToggleMutation)", () => {
  it("still routes CUSTOMIZE_MCP_NOT_SUPPORTED to MCP_VIA_MOBILE_HINT", async () => {
    enableExec.mockResolvedValue({
      error: {
        message: "fallback should not surface",
        graphQLErrors: [
          { extensions: { code: "CUSTOMIZE_MCP_NOT_SUPPORTED" } },
        ],
      },
    });
    const { result } = renderHook(() => useConnectorMutation());
    await act(async () => {
      await result.current.toggle("slack", true);
    });
    expect(toastMessage).toHaveBeenCalledWith(MCP_VIA_MOBILE_HINT);
  });

  it("connector enable still posts { input: { computerId, slug } }", async () => {
    const { result } = renderHook(() => useConnectorMutation());
    await act(async () => {
      await result.current.toggle("github", true);
    });
    expect(enableExec).toHaveBeenCalledWith(
      { input: { computerId: "computer-1", slug: "github" } },
      expect.any(Object),
    );
  });
});

describe("useSkillMutation regression (composes useToggleMutation)", () => {
  it("still routes CUSTOMIZE_BUILTIN_TOOL_NOT_ENABLEABLE to BUILTIN_TOOL_HINT", async () => {
    enableExec.mockResolvedValue({
      error: {
        message: "fallback should not surface",
        graphQLErrors: [
          { extensions: { code: "CUSTOMIZE_BUILTIN_TOOL_NOT_ENABLEABLE" } },
        ],
      },
    });
    const { result } = renderHook(() => useSkillMutation());
    await act(async () => {
      await result.current.toggle("web-search", true);
    });
    expect(toastMessage).toHaveBeenCalledWith(BUILTIN_TOOL_HINT);
  });

  it("skill enable posts { input: { computerId, skillId } }", async () => {
    const { result } = renderHook(() => useSkillMutation());
    await act(async () => {
      await result.current.toggle("sales-prep", true);
    });
    expect(enableExec).toHaveBeenCalledWith(
      { input: { computerId: "computer-1", skillId: "sales-prep" } },
      expect.any(Object),
    );
  });
});

describe("useWorkflowMutation", () => {
  it("workflow enable posts { input: { computerId, slug } } and includes WORKFLOW_TYPENAMES", async () => {
    const { result } = renderHook(() => useWorkflowMutation());
    await act(async () => {
      await result.current.toggle("daily-digest", true);
    });
    expect(enableExec).toHaveBeenCalledWith(
      { input: { computerId: "computer-1", slug: "daily-digest" } },
      {
        additionalTypenames: [
          "Routine",
          "WorkflowBinding",
          "CustomizeBindings",
        ],
      },
    );
  });

  it("workflow disable routes to DisableWorkflowMutation", async () => {
    const { result } = renderHook(() => useWorkflowMutation());
    await act(async () => {
      await result.current.toggle("daily-digest", false);
    });
    expect(disableExec).toHaveBeenCalledWith(
      { input: { computerId: "computer-1", slug: "daily-digest" } },
      expect.any(Object),
    );
  });

  it("workflow has no error-code hint — server messages fall through to toast.error", async () => {
    enableExec.mockResolvedValue({
      error: {
        message: "Catalog entry not found",
        graphQLErrors: [
          { extensions: { code: "CUSTOMIZE_CATALOG_NOT_FOUND" } },
        ],
      },
    });
    const { result } = renderHook(() => useWorkflowMutation());
    await act(async () => {
      await result.current.toggle("missing-flow", true);
    });
    expect(toastError).toHaveBeenCalledWith("Catalog entry not found");
    expect(toastMessage).not.toHaveBeenCalled();
  });
});
