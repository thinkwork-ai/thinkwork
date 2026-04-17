import { describe, it, expect } from "vitest";
import {
  CombinedError,
  type OperationResult,
} from "@urql/core";
import { gqlQuery, gqlMutate } from "../src/lib/gql-client.js";

// gqlQuery / gqlMutate just forward to urql's `client.query/mutation(...).toPromise()`
// and then run results through an internal unwrap() that turns GraphQL/network
// errors into readable Error messages. We stub urql by handing in a fake Client
// whose query/mutation return `toPromise()`-shaped objects.

function fakeClient(result: OperationResult<unknown>) {
  const promise = { toPromise: async () => result };
  return {
    query: () => promise,
    mutation: () => promise,
  } as unknown as Parameters<typeof gqlQuery>[0];
}

describe("gql-client unwrap", () => {
  it("returns data on a successful query", async () => {
    const client = fakeClient({
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
    const client = fakeClient({
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
    const client = fakeClient({
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
    const client = fakeClient({
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
    const client = fakeClient({
      data: undefined,
      error: err,
      stale: false,
      hasNext: false,
    } as OperationResult<unknown>);
    await expect(gqlMutate(client, {} as any, {})).rejects.toThrow(
      /Validation failed/,
    );
  });
});
