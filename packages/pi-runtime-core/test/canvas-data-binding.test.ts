import { describe, expect, it } from "vitest";
import {
  buildCanvasDataBinding,
  type CanvasBindingSourceInvocation,
} from "../src/json-render-runtime.js";

/** A completed MCP tool invocation whose result carries the identity metadata
 *  the MCP tool wrappers stamp (details.mcp_server / mcp_tool_name / raw). */
function mcpInvocation(
  overrides: Partial<CanvasBindingSourceInvocation> = {},
): CanvasBindingSourceInvocation {
  return {
    id: "call_source",
    status: "ok",
    args: { region: "us-east-1", limit: 50 },
    result: {
      content: [{ type: "text", text: "…" }],
      details: {
        mcp_server: "aws-cost-explorer",
        mcp_tool_name: "get_cost_and_usage",
        exposed_tool_name: "mcp_aws-cost-explorer_get_cost_and_usage",
        raw: { rows: [{ service: "EC2", amount: 12.5 }], total: 12.5 },
      },
    },
    ...overrides,
  };
}

describe("buildCanvasDataBinding", () => {
  it("captures server/tool/args/shape-hash from the declared source call", () => {
    const binding = buildCanvasDataBinding({
      partId: "json-render:abc",
      sourceToolCallId: "call_source",
      toolInvocations: [mcpInvocation()],
    });
    expect(binding).not.toBeNull();
    expect(binding).toMatchObject({
      partId: "json-render:abc",
      elementId: "",
      serverRef: "aws-cost-explorer",
      serverName: "aws-cost-explorer",
      toolName: "get_cost_and_usage",
      frozenArgs: { region: "us-east-1", limit: 50 },
    });
    expect(binding!.resultShapeHash).toMatch(/^shape-fnv1a:[0-9a-f]{8}$/);
  });

  it("is stable across value changes, different across structural changes", () => {
    const base = buildCanvasDataBinding({
      partId: "p",
      sourceToolCallId: "call_source",
      toolInvocations: [mcpInvocation()],
    })!;
    const differentValues = buildCanvasDataBinding({
      partId: "p",
      sourceToolCallId: "call_source",
      toolInvocations: [
        mcpInvocation({
          result: {
            details: {
              mcp_server: "aws-cost-explorer",
              mcp_tool_name: "get_cost_and_usage",
              raw: { rows: [{ service: "S3", amount: 999.9 }], total: 999.9 },
            },
          },
        }),
      ],
    })!;
    const differentShape = buildCanvasDataBinding({
      partId: "p",
      sourceToolCallId: "call_source",
      toolInvocations: [
        mcpInvocation({
          result: {
            details: {
              mcp_server: "aws-cost-explorer",
              mcp_tool_name: "get_cost_and_usage",
              raw: { rows: [{ service: "S3" }], grandTotal: 1 },
            },
          },
        }),
      ],
    })!;
    expect(base.resultShapeHash).toBe(differentValues.resultShapeHash);
    expect(base.resultShapeHash).not.toBe(differentShape.resultShapeHash);
  });

  it("returns null for a blank/absent sourceToolCallId (unbound, no error)", () => {
    expect(
      buildCanvasDataBinding({
        partId: "p",
        sourceToolCallId: undefined,
        toolInvocations: [mcpInvocation()],
      }),
    ).toBeNull();
    expect(
      buildCanvasDataBinding({
        partId: "p",
        sourceToolCallId: "   ",
        toolInvocations: [mcpInvocation()],
      }),
    ).toBeNull();
  });

  it("returns null when the id matches no invocation", () => {
    expect(
      buildCanvasDataBinding({
        partId: "p",
        sourceToolCallId: "call_missing",
        toolInvocations: [mcpInvocation()],
      }),
    ).toBeNull();
  });

  it("returns null when the referenced call errored", () => {
    expect(
      buildCanvasDataBinding({
        partId: "p",
        sourceToolCallId: "call_source",
        toolInvocations: [mcpInvocation({ is_error: true })],
      }),
    ).toBeNull();
    expect(
      buildCanvasDataBinding({
        partId: "p",
        sourceToolCallId: "call_source",
        toolInvocations: [mcpInvocation({ status: "error" })],
      }),
    ).toBeNull();
  });

  it("returns null for a non-MCP source (no server/tool identity)", () => {
    const nonMcp: CanvasBindingSourceInvocation = {
      id: "call_source",
      status: "ok",
      args: { q: "x" },
      result: { content: [{ type: "text", text: "hi" }], details: {} },
    };
    expect(
      buildCanvasDataBinding({
        partId: "p",
        sourceToolCallId: "call_source",
        toolInvocations: [nonMcp],
      }),
    ).toBeNull();
  });
});
