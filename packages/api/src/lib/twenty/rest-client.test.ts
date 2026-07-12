import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../plugins/activation.js", () => ({
  createPluginDispatchAuthResolver: vi.fn(),
}));

import {
  HttpError,
  TwentyRestClient,
  recordsFromPayload,
} from "./rest-client.js";

const BASE_URL = "https://crm.example.com";
const TOKEN = "test-token";

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    text: async () => JSON.stringify(body),
  };
}

describe("recordsFromPayload", () => {
  it("returns a bare array of records", () => {
    const records = [{ id: "a" }, { id: "b" }];
    expect(recordsFromPayload(records, [])).toEqual(records);
  });

  it("unwraps { data: [...] }", () => {
    expect(recordsFromPayload({ data: [{ id: "a" }] }, [])).toEqual([
      { id: "a" },
    ]);
  });

  it("unwraps { data: { companies: [...] } } via collection keys", () => {
    expect(
      recordsFromPayload({ data: { companies: [{ id: "a" }] } }, ["companies"]),
    ).toEqual([{ id: "a" }]);
  });

  it("unwraps { records: [...] }", () => {
    expect(recordsFromPayload({ records: [{ id: "a" }] }, [])).toEqual([
      { id: "a" },
    ]);
  });

  it("treats a single record with an id as a one-element list", () => {
    expect(recordsFromPayload({ id: "a", name: "x" }, [])).toEqual([
      { id: "a", name: "x" },
    ]);
  });

  it("filters non-record entries and returns [] for junk", () => {
    expect(recordsFromPayload([{ id: "a" }, "junk", 3, null], [])).toEqual([
      { id: "a" },
    ]);
    expect(recordsFromPayload(null, [])).toEqual([]);
    expect(recordsFromPayload("nope", [])).toEqual([]);
  });
});

describe("HttpError", () => {
  it("carries message and status", () => {
    const err = new HttpError("Twenty API 500: boom", 500);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("HttpError");
    expect(err.message).toBe("Twenty API 500: boom");
    expect(err.status).toBe(500);
  });
});

describe("TwentyRestClient", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds the /rest URL and sends the bearer token on list()", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: { companies: [{ id: "a" }] } }),
    );
    const client = new TwentyRestClient(BASE_URL, TOKEN);
    const records = await client.list("companies", ["companies"], {
      depth: 1,
    });

    expect(records).toEqual([{ id: "a" }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/rest/companies?limit=200&depth=1`);
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${TOKEN}`,
    );
  });

  it("passes cursor, filter, and order params on listPage()", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: {
          companies: [{ id: "a" }],
          pageInfo: { hasNextPage: true, endCursor: "cursor-1" },
        },
      }),
    );
    const client = new TwentyRestClient(BASE_URL, TOKEN);
    const page = await client.listPage("companies", {
      limit: 50,
      depth: 0,
      startingAfter: "cursor-0",
      filter: "updatedAt[gte]:2026-07-01T00:00:00.000Z",
      orderBy: "updatedAt[AscNullsFirst]",
      collectionKeys: ["companies"],
    });

    expect(page.records).toEqual([{ id: "a" }]);
    expect(page.pageInfo).toEqual({ hasNextPage: true, endCursor: "cursor-1" });
    const [url] = fetchMock.mock.calls[0] as [string];
    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/rest/companies");
    expect(parsed.searchParams.get("limit")).toBe("50");
    expect(parsed.searchParams.get("depth")).toBe("0");
    expect(parsed.searchParams.get("starting_after")).toBe("cursor-0");
    expect(parsed.searchParams.get("filter")).toBe(
      "updatedAt[gte]:2026-07-01T00:00:00.000Z",
    );
    expect(parsed.searchParams.get("order_by")).toBe(
      "updatedAt[AscNullsFirst]",
    );
  });

  it("lets query overrides win over named listPage params", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [] }));
    const client = new TwentyRestClient(BASE_URL, TOKEN);
    await client.listPage("people", {
      startingAfter: "cursor-0",
      query: { starting_after: "override", extra: "1" },
    });
    const [url] = fetchMock.mock.calls[0] as [string];
    const parsed = new URL(url);
    expect(parsed.searchParams.get("starting_after")).toBe("override");
    expect(parsed.searchParams.get("extra")).toBe("1");
  });

  it("unwraps flat list payloads on listPage and exposes the raw payload", async () => {
    const payload = { records: [{ id: "a" }] };
    fetchMock.mockResolvedValueOnce(jsonResponse(payload));
    const client = new TwentyRestClient(BASE_URL, TOKEN);
    const page = await client.listPage("companies");
    expect(page.records).toEqual([{ id: "a" }]);
    expect(page.pageInfo).toBeUndefined();
    expect(page.payload).toEqual(payload);
  });

  it("throws HttpError with status on non-2xx responses", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "nope" }, 401));
    const client = new TwentyRestClient(BASE_URL, TOKEN);
    await expect(client.list("companies", ["companies"])).rejects.toThrow(
      HttpError,
    );
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "nope" }, 401));
    await expect(client.list("companies", ["companies"])).rejects.toMatchObject(
      { status: 401, message: "Twenty API 401: nope" },
    );
  });

  it("fetches metadata objects and returns the raw payload", async () => {
    const payload = { data: { objects: [{ nameSingular: "company" }] } };
    fetchMock.mockResolvedValueOnce(jsonResponse(payload));
    const client = new TwentyRestClient(BASE_URL, TOKEN);
    const result = await client.getMetadataObjects();
    expect(result).toEqual(payload);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe(`${BASE_URL}/rest/metadata/objects`);
  });

  it("returns null when the metadata endpoint 404s", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ message: "not found" }, 404),
    );
    const client = new TwentyRestClient(BASE_URL, TOKEN);
    await expect(client.getMetadataObjects()).resolves.toBeNull();
  });

  it("respects a custom timeout option without changing request behavior", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [] }));
    const client = new TwentyRestClient(BASE_URL, TOKEN, { timeoutMs: 5000 });
    await client.list("companies", ["companies"]);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});
