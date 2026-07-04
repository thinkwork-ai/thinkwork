import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_ID = "22222222-2222-2222-2222-222222222222";

const mocks = vi.hoisted(() => ({
  capturedConditions: [] as unknown[],
  rows: [] as Array<Record<string, unknown>>,
}));

vi.mock("../../utils.js", () => ({
  and: (...conditions: unknown[]) => {
    mocks.capturedConditions = conditions;
    return { and: conditions };
  },
  eq: (field: unknown, value: unknown) => ({ eq: [field, value] }),
  desc: (col: unknown) => ({ desc: col }),
  lt: (a: unknown, b: unknown) => ({ lt: [a, b] }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    __sql: strings.join("?"),
    values,
  }),
  artifacts: {
    tenant_id: { name: "tenant_id" },
    thread_id: { name: "thread_id" },
    agent_id: { name: "agent_id" },
    type: { name: "type" },
    status: { name: "status" },
    metadata: { name: "metadata" },
    favorited_at: { name: "favorited_at" },
    created_at: { name: "created_at" },
  },
  artifactToCamel: (row: Record<string, unknown>) => row,
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: () => Promise.resolve(mocks.rows),
          }),
        }),
      }),
    }),
  },
}));

import { artifacts_ } from "./artifacts.query.js";

const ctx = { auth: { authType: "cognito" } } as never;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.capturedConditions = [];
  mocks.rows = [];
});

function draftFilterCondition() {
  return mocks.capturedConditions.find(
    (c) =>
      c &&
      typeof c === "object" &&
      "__sql" in (c as Record<string, unknown>) &&
      (c as { values?: unknown[] }).values?.includes("json_render_canvas"),
  );
}

describe("artifacts query — canvas draft filtering (R14)", () => {
  it("excludes draft canvases by default", async () => {
    await artifacts_({}, { tenantId: TENANT_ID }, ctx);
    expect(draftFilterCondition()).toBeDefined();
  });

  it("includes draft canvases when includeDrafts is true", async () => {
    await artifacts_({}, { tenantId: TENANT_ID, includeDrafts: true }, ctx);
    expect(draftFilterCondition()).toBeUndefined();
  });
});
