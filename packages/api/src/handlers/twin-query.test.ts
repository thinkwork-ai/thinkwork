import { beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.fn();

vi.mock("@aws-sdk/client-neptunedata", () => ({
  NeptunedataClient: vi.fn(() => ({ send })),
  ExecuteOpenCypherQueryCommand: vi.fn((input: unknown) => ({ input })),
}));
vi.mock("@thinkwork/runtime-config", () => ({
  getConfig: (key: string) =>
    key === "NEPTUNE_ENDPOINT" ? "neptune.example" : null,
}));

import { handler, postFilterRawResults, RAW_RESULT_CAP } from "./twin-query.js";

const TENANT = "tenant-1";
const node = (id: string, extra: Record<string, unknown> = {}) => ({
  "~id": id,
  "~entityType": "node",
  "~labels": ["customer"],
  "~properties": { displayName: id },
  ...extra,
});
const mine = (suffix: string) => node(`t#${TENANT}#e#${suffix}`);
const foreign = (suffix: string) => node(`t#other#e#${suffix}`);

describe("postFilterRawResults", () => {
  it("drops + counts foreign nodes at top level and nested shapes", () => {
    const { rows, redactedCount, unfenced } = postFilterRawResults(
      [
        { n: mine("a") },
        { n: foreign("x") },
        // collect(...) list with a foreign element inside
        { list: [mine("b"), foreign("y"), mine("c")] },
        // map projection nesting a foreign node
        { projected: { inner: foreign("z"), keep: mine("d") } },
        // path-ish nested list of lists
        { path: [[mine("e"), foreign("w")]] },
      ],
      TENANT,
    );
    expect(redactedCount).toBe(4);
    expect(unfenced).toBe(false);
    expect(rows).toHaveLength(4); // the pure-foreign row collapsed away
    expect((rows[1] as { list: unknown[] }).list).toHaveLength(2);
    expect(Object.keys((rows[2] as { projected: object }).projected)).toEqual([
      "keep",
    ]);
    expect((rows[3] as { path: unknown[][] }).path[0]).toHaveLength(1);
  });

  it("flags scalar projections as unfenced and passes them through", () => {
    const { rows, unfenced, redactedCount } = postFilterRawResults(
      [{ count: 42, name: "leaky@example.com" }],
      TENANT,
    );
    expect(rows).toEqual([{ count: 42, name: "leaky@example.com" }]);
    expect(unfenced).toBe(true);
    expect(redactedCount).toBe(0);
  });

  it("relationship values are fenced by ~id prefix too", () => {
    const rel = {
      "~id": "t#other#x#c1#lastmile",
      "~entityType": "relationship",
      "~type": "external_identity",
    };
    const { redactedCount } = postFilterRawResults([{ r: rel }], TENANT);
    expect(redactedCount).toBe(1);
  });
});

describe("twin-query handler — raw kind", () => {
  beforeEach(() => {
    send.mockReset();
  });

  it("rejects denylisted queries before any Neptune call", async () => {
    const result = await handler({
      tenantId: TENANT,
      request: { kind: "raw", query: "MATCH (n) DEL/**/ETE n" },
    });
    expect(result).toMatchObject({ ok: false, reason: "invalid_request" });
    expect(send).not.toHaveBeenCalled();
  });

  it("executes guarded raw queries and returns fence metadata", async () => {
    send.mockResolvedValueOnce({
      results: [{ n: mine("a") }, { n: foreign("b") }, { count: 3 }],
    });
    const result = await handler({
      tenantId: TENANT,
      request: { kind: "raw", query: "MATCH (n) RETURN n" },
    });
    expect(result).toMatchObject({
      ok: true,
      redactedCount: 1,
      unfenced: true,
      truncated: false,
    });
    // The executed query carried the appended LIMIT and the tenant binding.
    const commandInput = (
      send.mock.calls[0]![0] as {
        input: { openCypherQuery: string; parameters: string };
      }
    ).input;
    expect(commandInput.openCypherQuery).toMatch(/LIMIT 100$/);
    expect(JSON.parse(commandInput.parameters)).toEqual({ tenantId: TENANT });
  });

  it("caps raw results and flags truncation", async () => {
    send.mockResolvedValueOnce({
      results: Array.from({ length: RAW_RESULT_CAP + 20 }, (_, i) => ({
        n: mine(`c${i}`),
      })),
    });
    const result = (await handler({
      tenantId: TENANT,
      request: { kind: "raw", query: "MATCH (n) RETURN n LIMIT 500" },
    })) as { ok: true; results: unknown[]; truncated: boolean };
    expect(result.truncated).toBe(true);
    expect(result.results).toHaveLength(RAW_RESULT_CAP);
  });

  it("returns a typed timeout instead of hanging", async () => {
    send.mockRejectedValueOnce(
      Object.assign(new Error("Request aborted"), { name: "AbortError" }),
    );
    const result = await handler({
      tenantId: TENANT,
      request: { kind: "raw", query: "MATCH (n) RETURN n" },
    });
    expect(result).toMatchObject({
      ok: false,
      reason: "unavailable",
      detail: "timeout",
    });
  });

  it("typed (non-raw) requests keep their existing envelope untouched", async () => {
    send.mockResolvedValueOnce({ results: [{ node: foreign("z") }] });
    const result = (await handler({
      tenantId: TENANT,
      request: { kind: "entity_get", canonicalId: "z" },
    })) as Record<string, unknown>;
    expect(result.ok).toBe(true);
    expect(result.redactedCount).toBeUndefined();
  });
});
