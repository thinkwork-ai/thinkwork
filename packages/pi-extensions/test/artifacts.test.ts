import type {
  ExtensionAPI,
  ExtensionHandler,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type {
  CanvasProvider,
  CanvasSaveRequest,
  CanvasSummaryItem,
  CanvasThreadContext,
} from "@thinkwork/pi-runtime-core";
import { describe, expect, it } from "vitest";

import {
  toExtensionFactory,
  type ProviderBundle,
} from "../src/define-extension.js";
import {
  ARTIFACTS_TOOL_NAMES,
  createArtifactsExtension,
  LIST_CANVASES_TOOL_NAME,
  SAVE_CANVAS_TOOL_NAME,
  resolveCanvasByName,
  resolveSaveSpaceId,
} from "../src/artifacts.js";

function makeFakeApi() {
  const tools: ToolDefinition[] = [];
  const api = {
    registerTool: (tool: ToolDefinition) => {
      tools.push(tool);
    },
    on: (_event: string, _handler: ExtensionHandler<any, any>) => {},
  } as unknown as ExtensionAPI;
  return { api, tools };
}

interface CanvasCalls {
  save: CanvasSaveRequest[];
  checkout: string[];
  refresh: Array<{ artifactId: string; partId?: string | null }>;
  contextCount: number;
}

type RefreshBindings = Awaited<
  ReturnType<CanvasProvider["refresh"]>
>["bindings"];

function makeFakeCanvas(
  context: CanvasThreadContext,
  refreshBindings?: RefreshBindings,
) {
  const calls: CanvasCalls = {
    save: [],
    checkout: [],
    refresh: [],
    contextCount: 0,
  };
  const provider: CanvasProvider = {
    async context() {
      calls.contextCount += 1;
      return context;
    },
    async save(request) {
      calls.save.push(request);
      return {
        artifactId: request.artifactId,
        title: request.title,
        spaceId: request.spaceId,
        headVersion: 1,
      };
    },
    async checkout(artifactId) {
      calls.checkout.push(artifactId);
      return { artifactId, title: "Checked out" };
    },
    async refresh(artifactId, partId) {
      calls.refresh.push({ artifactId, partId });
      return {
        artifactId,
        dispatched: true,
        errorMessage: null,
        bindings: refreshBindings ?? [
          {
            bindingId: "b1",
            partId: "p1",
            elementId: "e1",
            outcome: "REFRESHED",
            quality: "GOOD",
            reason: null,
            serverName: "twenty--crm",
            toolName: "execute_tool",
          },
        ],
      };
    },
  };
  return { provider, calls };
}

function summary(
  artifactId: string,
  title: string,
  extra: Partial<CanvasSummaryItem> = {},
): CanvasSummaryItem {
  return {
    artifactId,
    title,
    updatedAt: "2026-07-04T00:00:00.000Z",
    headVersion: 0,
    status: "final",
    stablePartId: `json-render:${artifactId}`,
    ...extra,
  };
}

function baseContext(
  overrides: Partial<CanvasThreadContext> = {},
): CanvasThreadContext {
  return {
    spaceId: "space-1",
    spaceName: "Growth",
    currentCanvas: summary("art-current", "Draft canvas", { status: "draft" }),
    savedCanvases: [
      summary("art-cost", "Cost Dashboard"),
      summary("art-sales", "Sales Dashboard"),
    ],
    writableSpaces: [{ spaceId: "space-1", name: "Growth" }],
    ...overrides,
  };
}

function loadTools(
  context: CanvasThreadContext,
  refreshBindings?: RefreshBindings,
) {
  const { api, tools } = makeFakeApi();
  const { provider, calls } = makeFakeCanvas(context, refreshBindings);
  const extension = createArtifactsExtension();
  const providers: ProviderBundle = { canvas: provider };
  toExtensionFactory(extension, providers)(api);
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  return { tools, byName, calls };
}

function textOf(result: { content: Array<{ type: string; text?: string }> }) {
  return result.content.map((c) => c.text ?? "").join("\n");
}

/** Invoke a tool's execute with the full 5-arg SDK signature. */
function run(
  tool: ToolDefinition,
  params: Record<string, unknown>,
): Promise<{
  content: Array<{ type: string; text?: string }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  details: any;
}> {
  return tool.execute(
    "call-1",
    params,
    undefined,
    undefined,
    {} as never,
  ) as never;
}

// ---------------------------------------------------------------------------
// Name resolution (AE5 shapes).
// ---------------------------------------------------------------------------

describe("resolveCanvasByName", () => {
  const saved = [
    summary("art-cost", "Cost Dashboard"),
    summary("art-sales", "Sales Dashboard"),
  ];

  it("resolves an exact (case-insensitive) name to the unique match", () => {
    const result = resolveCanvasByName(saved, "cost dashboard");
    expect(result.kind).toBe("match");
    if (result.kind === "match") {
      expect(result.item.artifactId).toBe("art-cost");
    }
  });

  it("resolves a unique substring/fuzzy match", () => {
    const result = resolveCanvasByName(saved, "cost");
    expect(result.kind).toBe("match");
    if (result.kind === "match")
      expect(result.item.artifactId).toBe("art-cost");
  });

  it("returns ambiguous with candidates when a term matches many", () => {
    const result = resolveCanvasByName(saved, "dashboard");
    expect(result.kind).toBe("ambiguous");
    if (result.kind === "ambiguous") {
      expect(result.candidates.map((c) => c.artifactId).sort()).toEqual([
        "art-cost",
        "art-sales",
      ]);
    }
  });

  it("returns none with near-matches on a zero substring match", () => {
    const result = resolveCanvasByName(saved, "cost metrics");
    expect(result.kind).toBe("none");
    if (result.kind === "none") {
      // token overlap on "cost" surfaces the cost dashboard as a near match
      expect(result.nearMatches.map((c) => c.artifactId)).toContain("art-cost");
    }
  });

  it("returns none with no near-matches when nothing overlaps", () => {
    const result = resolveCanvasByName(saved, "budget planner");
    expect(result).toEqual({ kind: "none", nearMatches: [] });
  });
});

describe("resolveSaveSpaceId", () => {
  const context = baseContext();

  it("defaults to the thread's space when no name is given", () => {
    expect(resolveSaveSpaceId(context, undefined)).toEqual({
      spaceId: "space-1",
    });
  });

  it("resolves a named writable space", () => {
    expect(resolveSaveSpaceId(context, "growth")).toEqual({
      spaceId: "space-1",
    });
  });

  it("errors on an unknown named space", () => {
    const result = resolveSaveSpaceId(context, "nonexistent");
    expect("error" in result).toBe(true);
  });

  it("errors when the thread has no home space and none is named", () => {
    const result = resolveSaveSpaceId(
      baseContext({ spaceId: null, spaceName: null }),
      undefined,
    );
    expect("error" in result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tool registration + behavior.
// ---------------------------------------------------------------------------

describe("createArtifactsExtension", () => {
  it("declares exactly the four canvas tool names", () => {
    const extension = createArtifactsExtension();
    expect(extension.toolNames).toEqual([...ARTIFACTS_TOOL_NAMES]);
    const { byName } = loadTools(baseContext());
    for (const name of ARTIFACTS_TOOL_NAMES) {
      expect(byName.has(name)).toBe(true);
    }
  });

  it("declares no tools when disabled", () => {
    const extension = createArtifactsExtension({ enabled: false });
    expect(extension.toolNames).toEqual([]);
  });

  it("save_canvas saves the current canvas into the thread's space", async () => {
    const { byName, calls } = loadTools(baseContext());
    const result = await run(byName.get("save_canvas")!, { title: "My Costs" });
    expect(calls.save).toEqual([
      { artifactId: "art-current", title: "My Costs", spaceId: "space-1" },
    ]);
    expect((result as { details: { ok: boolean } }).details.ok).toBe(true);
  });

  it("save_canvas errors when there is no canvas in the thread", async () => {
    const { byName, calls } = loadTools(baseContext({ currentCanvas: null }));
    const result = await run(byName.get("save_canvas")!, { title: "My Costs" });
    expect(calls.save).toEqual([]);
    expect(textOf(result as never)).toContain("no canvas in this thread");
  });

  it("load_canvas checks out a uniquely-resolved canvas", async () => {
    const { byName, calls } = loadTools(baseContext());
    await run(byName.get("load_canvas")!, { name: "cost dashboard" });
    expect(calls.checkout).toEqual(["art-cost"]);
  });

  it("load_canvas asks (does not guess) on an ambiguous name", async () => {
    const { byName, calls } = loadTools(baseContext());
    const result = await run(byName.get("load_canvas")!, { name: "dashboard" });
    expect(calls.checkout).toEqual([]);
    const details = (result as { details: Record<string, unknown> }).details;
    expect(details.needsDisambiguation).toBe(true);
    expect(textOf(result as never)).toContain("Ask the user");
  });

  it("load_canvas reports not-found with near matches on a zero match", async () => {
    const { byName, calls } = loadTools(baseContext());
    const result = await run(byName.get("load_canvas")!, {
      name: "budget planner",
    });
    expect(calls.checkout).toEqual([]);
    const details = (result as { details: Record<string, unknown> }).details;
    expect(details.notFound).toBe(true);
  });

  it("refresh_canvas_data refreshes the current canvas by default", async () => {
    const { byName, calls } = loadTools(baseContext());
    await run(byName.get("refresh_canvas_data")!, {});
    expect(calls.refresh).toEqual([
      { artifactId: "art-current", partId: undefined },
    ]);
  });

  it("load_canvas success carries the stable part id + same-id re-emit instruction", async () => {
    const { byName } = loadTools(baseContext());
    const result = await run(byName.get("load_canvas")!, {
      name: "cost dashboard",
    });
    const text = textOf(result as never);
    expect(text).toContain('SAME id "json-render:art-cost"');
    expect(text).toContain("do NOT use a new part id");
    expect(result.details.stablePartId).toBe("json-render:art-cost");
  });

  it("load_canvas omits the re-emit instruction for a legacy canvas without a stable part id", async () => {
    const context = baseContext({
      savedCanvases: [
        summary("art-cost", "Cost Dashboard", { stablePartId: null }),
      ],
    });
    const { byName } = loadTools(context);
    const result = await run(byName.get("load_canvas")!, {
      name: "cost dashboard",
    });
    expect(textOf(result as never)).not.toContain("SAME id");
    expect(result.details.stablePartId).toBeNull();
  });

  it("save_canvas accepts the target's stable part id as canvasPartId", async () => {
    const { byName, calls } = loadTools(baseContext());
    const result = await run(byName.get("save_canvas")!, {
      title: "My Costs",
      canvasPartId: "json-render:art-current",
    });
    expect(result.details.ok).toBe(true);
    expect(calls.save).toEqual([
      { artifactId: "art-current", title: "My Costs", spaceId: "space-1" },
    ]);
  });

  it("refresh_canvas_data NEEDS_USER instructs an in-turn re-run + same-id re-emit", async () => {
    const { byName } = loadTools(baseContext(), [
      {
        bindingId: "b1",
        partId: "p1",
        elementId: "e1",
        outcome: "NEEDS_USER",
        quality: "STALE",
        reason: "Refresh needs the credential owner (per-user OAuth).",
        serverName: "twenty--crm",
        toolName: "execute_tool",
      },
    ]);
    const result = await run(byName.get("refresh_canvas_data")!, {});
    const text = textOf(result as never);
    expect(text).toContain("YOU can, in this turn");
    expect(text).toContain("execute_tool on twenty--crm");
    expect(text).toContain('SAME part id "json-render:art-current"');
    expect(text).toContain("sourceToolCallId");
    expect(text).not.toContain("the owner must refresh them");
  });

  it("refresh_canvas_data NEEDS_USER detection falls back to the legacy reason text", async () => {
    // Deploy skew: an older Lambda emits no serverName/toolName and the
    // pre-outcome reason phrasing. The instruction must still fire.
    const { byName } = loadTools(baseContext(), [
      {
        bindingId: "b1",
        partId: "p1",
        elementId: "e1",
        outcome: "SKIPPED",
        quality: "STALE",
        reason: "refresh needs you",
        serverName: "",
        toolName: "",
      },
    ]);
    const result = await run(byName.get("refresh_canvas_data")!, {});
    const text = textOf(result as never);
    expect(text).toContain("YOU can, in this turn");
    expect(text).not.toContain("()");
  });

  it("refresh_canvas_data resolves a named canvas", async () => {
    const { byName, calls } = loadTools(baseContext());
    await run(byName.get("refresh_canvas_data")!, { name: "sales" });
    expect(calls.refresh).toEqual([
      { artifactId: "art-sales", partId: undefined },
    ]);
  });

  it("list_canvases lists the space's saved canvases (drafts excluded)", async () => {
    // The current (draft) canvas is NOT part of savedCanvases — the provider
    // context already excludes drafts (R19). list surfaces only savedCanvases.
    const { byName } = loadTools(baseContext());
    const result = await run(byName.get("list_canvases")!, {});
    const details = (result as { details: { canvases: CanvasSummaryItem[] } })
      .details;
    expect(details.canvases.map((c) => c.artifactId)).toEqual([
      "art-cost",
      "art-sales",
    ]);
    const text = textOf(result as never);
    expect(text).not.toContain("art-current");
    expect(text).toContain("Cost Dashboard");
  });

  it("list_canvases reports an empty space cleanly", async () => {
    const { byName } = loadTools(baseContext({ savedCanvases: [] }));
    const result = await run(byName.get("list_canvases")!, {});
    expect(textOf(result as never)).toContain("no saved canvases");
  });

  it("surfaces a provider failure as an error result, never a throw", async () => {
    const { api, tools } = makeFakeApi();
    const provider: CanvasProvider = {
      async context() {
        throw new Error("boom");
      },
      async save() {
        throw new Error("unused");
      },
      async checkout() {
        throw new Error("unused");
      },
      async refresh() {
        throw new Error("unused");
      },
    };
    toExtensionFactory(createArtifactsExtension(), { canvas: provider })(api);
    const listTool = tools.find((t) => t.name === "list_canvases")!;
    const result = await run(listTool, {});
    expect((result as { details: { ok: boolean } }).details.ok).toBe(false);
    expect(textOf(result as never)).toContain("Error");
  });

  // KTD8 observability: the friendly tool message hides the real
  // ApiCanvasProviderError (e.g. "Tenant membership required"). The onError
  // sink is what makes that underlying failure observable — the server wires it
  // to structured logging (event canvas_tool_error). Without this plumbing the
  // dead-tool root cause was invisible.
  it("reports a provider failure to onError with the failing phase", async () => {
    const errors: Array<{ error: unknown; phase: string }> = [];
    const { api, tools } = makeFakeApi();
    const boom = new Error("Canvas API error: Tenant membership required");
    const provider: CanvasProvider = {
      async context() {
        throw boom;
      },
      async save() {
        throw boom;
      },
      async checkout() {
        throw boom;
      },
      async refresh() {
        throw boom;
      },
    };
    toExtensionFactory(
      createArtifactsExtension({
        onError: (error, ctx) => errors.push({ error, phase: ctx.phase }),
      }),
      { canvas: provider },
    )(api);
    const byName = new Map(tools.map((t) => [t.name, t]));
    const result = await run(byName.get(LIST_CANVASES_TOOL_NAME)!, {});
    expect(errors).toHaveLength(1);
    expect(errors[0]!.phase).toBe("list_canvases.context");
    expect(errors[0]!.error).toBe(boom);
    // The tool still returns an explicit error result rather than throwing.
    expect((result as { details: { ok: boolean } }).details.ok).toBe(false);
  });

  it("reports a save-phase failure distinctly from a context-phase failure", async () => {
    const errors: Array<{ phase: string }> = [];
    const { api, tools } = makeFakeApi();
    const provider: CanvasProvider = {
      // Context succeeds so we reach the save call, then save throws.
      async context() {
        return baseContext();
      },
      async save() {
        throw new Error(
          "Canvas API error: You are not a member of the target space",
        );
      },
      async checkout() {
        throw new Error("unused");
      },
      async refresh() {
        throw new Error("unused");
      },
    };
    toExtensionFactory(
      createArtifactsExtension({
        onError: (_error, ctx) => errors.push({ phase: ctx.phase }),
      }),
      { canvas: provider },
    )(api);
    const byName = new Map(tools.map((t) => [t.name, t]));
    await run(byName.get(SAVE_CANVAS_TOOL_NAME)!, { title: "My dashboard" });
    expect(errors.map((e) => e.phase)).toEqual(["save_canvas.save"]);
  });
});
