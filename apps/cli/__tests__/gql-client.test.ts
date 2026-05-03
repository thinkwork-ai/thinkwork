import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CombinedError,
  type OperationResult,
} from "@urql/core";
import { parse } from "graphql";
import {
  createCliGqlClient,
  gqlQuery,
  gqlMutate,
} from "../src/lib/gql-client.js";

// gqlQuery / gqlMutate forward to the CLI client's `query/mutation(...).toPromise()`
// and then run results through an internal unwrap() that turns GraphQL/network
// errors into readable Error messages. We stub the transport with a fake Client
// whose query/mutation return `toPromise()`-shaped objects.

function fakeClient(result: OperationResult<unknown>) {
  const promise = { toPromise: async () => result };
  const calls: {
    query: Array<{ doc: unknown; variables: unknown }>;
    mutation: Array<{ doc: unknown; variables: unknown }>;
  } = { query: [], mutation: [] };
  return {
    calls,
    client: {
      query: (doc: unknown, variables: unknown) => {
        calls.query.push({ doc, variables });
        return promise;
      },
      mutation: (doc: unknown, variables: unknown) => {
        calls.mutation.push({ doc, variables });
        return promise;
      },
    } as unknown as Parameters<typeof gqlQuery>[0],
  };
}

describe("gql-client unwrap", () => {
  it("returns data on a successful query", async () => {
    const { client } = fakeClient({
      data: { me: { id: "u1" } },
      error: undefined,
      stale: false,
      hasNext: false,
    } as OperationResult<unknown>);
    const data = await gqlQuery(client, {} as any, {});
    expect(data).toEqual({ me: { id: "u1" } });
  });

  it("throws with a concatenated GraphQL error message when `error` is present", async () => {
    const err = new CombinedError({
      graphQLErrors: [
        { message: "Not authorised" } as any,
        { message: "Tenant mismatch" } as any,
      ],
    });
    const { client } = fakeClient({
      data: undefined,
      error: err,
      stale: false,
      hasNext: false,
    } as OperationResult<unknown>);
    await expect(gqlQuery(client, {} as any, {})).rejects.toThrow(
      /Not authorised.*Tenant mismatch/,
    );
  });

  it("throws the network error message when there's no graphQLErrors", async () => {
    const err = new CombinedError({
      networkError: new Error("ECONNREFUSED localhost:443"),
    });
    const { client } = fakeClient({
      data: undefined,
      error: err,
      stale: false,
      hasNext: false,
    } as OperationResult<unknown>);
    await expect(gqlQuery(client, {} as any, {})).rejects.toThrow(
      /ECONNREFUSED/,
    );
  });

  it("throws when the response has no data and no error (defensive)", async () => {
    const { client } = fakeClient({
      data: undefined,
      error: undefined,
      stale: false,
      hasNext: false,
    } as OperationResult<unknown>);
    await expect(gqlQuery(client, {} as any, {})).rejects.toThrow(
      /no data/,
    );
  });

  it("gqlMutate uses the same error path as gqlQuery", async () => {
    const err = new CombinedError({
      graphQLErrors: [{ message: "Validation failed: title required" } as any],
    });
    const { client } = fakeClient({
      data: undefined,
      error: err,
      stale: false,
      hasNext: false,
    } as OperationResult<unknown>);
    await expect(gqlMutate(client, {} as any, {})).rejects.toThrow(
      /Validation failed/,
    );
  });

  it("serializes generated AST documents before querying", async () => {
    const { client, calls } = fakeClient({
      data: { me: { id: "u1" } },
      error: undefined,
      stale: false,
      hasNext: false,
    } as OperationResult<unknown>);

    await gqlQuery(client, parse("query CliMe { me { id } }") as any, {});

    expect(calls.query[0].doc).toBe("query CliMe {\n  me {\n    id\n  }\n}");
  });

  it("serializes generated AST documents before mutating", async () => {
    const { client, calls } = fakeClient({
      data: { compileWikiNow: { id: "job-1" } },
      error: undefined,
      stale: false,
      hasNext: false,
    } as OperationResult<unknown>);

    await gqlMutate(
      client,
      parse(
        "mutation M($id: ID!) { compileWikiNow(ownerId: $id) { id } }",
      ) as any,
      { id: "agent-1" },
    );

    expect(calls.mutation[0].doc).toContain("mutation M($id: ID!)");
  });
});

describe("createCliGqlClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts generated AST documents as GraphQL query strings", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ data: { me: { id: "u1" } } }), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createCliGqlClient("https://api.example.com/graphql", {
      Authorization: "Bearer token",
      "x-tenant-id": "tenant-1",
    });

    const res = await client
      .query(parse("query CliMe($tenantId: ID!) { me { id } }") as any, {
        tenantId: "tenant-1",
      })
      .toPromise();

    expect(res.data).toEqual({ me: { id: "u1" } });
    expect(fetchMock).toHaveBeenCalledOnce();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.com/graphql");
    expect(init?.headers).toMatchObject({
      "content-type": "application/json",
      Authorization: "Bearer token",
      "x-tenant-id": "tenant-1",
    });
    expect(JSON.parse(init?.body as string)).toEqual({
      query: "query CliMe($tenantId: ID!) {\n  me {\n    id\n  }\n}",
      variables: { tenantId: "tenant-1" },
    });
  });

  it("returns GraphQL errors in the same CombinedError shape as urql", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ errors: [{ message: "Must provide query string." }] }),
          { status: 200 },
        ),
      ),
    );

    const client = createCliGqlClient("https://api.example.com/graphql", {});
    const res = await client
      .mutation(parse("mutation M { noop }") as any, {})
      .toPromise();

    expect(res.error?.graphQLErrors.map((e) => e.message)).toEqual([
      "Must provide query string.",
    ]);
  });

  it("preserves GraphQL error messages from non-2xx responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ errors: [{ message: "Bad request" }] }), {
          status: 400,
        }),
      ),
    );

    const client = createCliGqlClient("https://api.example.com/graphql", {});
    await expect(
      gqlQuery(client, parse("query M { me { id } }") as any, {}),
    ).rejects.toThrow("Bad request");
  });
});
