import { describe, expect, it } from "vitest";
import {
  CF_BASE,
  CloudflareApiError,
  CloudflareNamespaceClient,
  formatCloudflareError,
  type FetchLike,
} from "./cloudflare.js";

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function makeFetch(
  responder: (req: RecordedRequest) => { status: number; body: unknown },
): { fetchImpl: FetchLike; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const req: RecordedRequest = {
      url,
      method: init.method,
      headers: init.headers,
      body: init.body,
    };
    requests.push(req);
    const { status, body } = responder(req);
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(body),
    };
  };
  return { fetchImpl, requests };
}

const ZONE_RESPONSE = {
  success: true,
  result: [{ id: "zone-123", name: "thinkwork.ai" }],
  errors: [],
};

describe("CloudflareNamespaceClient", () => {
  it("resolves the zone via GET /zones?name= and caches it", async () => {
    const { fetchImpl, requests } = makeFetch((req) => {
      if (req.url.includes("/zones?"))
        return { status: 200, body: ZONE_RESPONSE };
      return { status: 200, body: { success: true, result: [], errors: [] } };
    });
    const client = new CloudflareNamespaceClient({ token: "tok", fetchImpl });

    await client.listRecords("tei.thinkwork.ai");
    await client.listRecords("tei.thinkwork.ai");

    const zoneLookups = requests.filter((r) => r.url.includes("/zones?"));
    expect(zoneLookups).toHaveLength(1);
    expect(zoneLookups[0]!.url).toBe(`${CF_BASE}/zones?name=thinkwork.ai`);
    expect(zoneLookups[0]!.headers.Authorization).toBe("Bearer tok");

    const lists = requests.filter((r) => r.url.includes("/dns_records?"));
    expect(lists).toHaveLength(2);
    expect(lists[0]!.url).toContain(
      "/zones/zone-123/dns_records?name=tei.thinkwork.ai",
    );
  });

  it("creates records unproxied with the comment attached", async () => {
    const { fetchImpl, requests } = makeFetch((req) => {
      if (req.url.includes("/zones?"))
        return { status: 200, body: ZONE_RESPONSE };
      return {
        status: 200,
        body: {
          success: true,
          result: {
            id: "rec-1",
            type: "TXT",
            name: "tei.thinkwork.ai",
            content: "thinkwork-namespace-reservation",
            comment: "deployment:tei created:2026-06-12",
          },
          errors: [],
        },
      };
    });
    const client = new CloudflareNamespaceClient({ token: "tok", fetchImpl });

    const created = await client.createRecord({
      type: "TXT",
      name: "tei.thinkwork.ai",
      content: "thinkwork-namespace-reservation",
      comment: "deployment:tei created:2026-06-12",
    });

    expect(created.id).toBe("rec-1");
    const post = requests.find((r) => r.method === "POST")!;
    expect(post.url).toBe(`${CF_BASE}/zones/zone-123/dns_records`);
    const payload = JSON.parse(post.body!) as Record<string, unknown>;
    expect(payload).toMatchObject({
      type: "TXT",
      name: "tei.thinkwork.ai",
      comment: "deployment:tei created:2026-06-12",
      proxied: false,
    });
  });

  it("deletes records by id", async () => {
    const { fetchImpl, requests } = makeFetch((req) => {
      if (req.url.includes("/zones?"))
        return { status: 200, body: ZONE_RESPONSE };
      return {
        status: 200,
        body: { success: true, result: { id: "rec-1" }, errors: [] },
      };
    });
    const client = new CloudflareNamespaceClient({ token: "tok", fetchImpl });
    await client.deleteRecord("rec-1");
    const del = requests.find((r) => r.method === "DELETE")!;
    expect(del.url).toBe(`${CF_BASE}/zones/zone-123/dns_records/rec-1`);
  });

  it("throws CloudflareApiError carrying the raw body and error codes", async () => {
    const errorBody = {
      success: false,
      result: null,
      errors: [{ code: 10000, message: "Authentication error" }],
    };
    const { fetchImpl } = makeFetch(() => ({ status: 403, body: errorBody }));
    const client = new CloudflareNamespaceClient({ token: "bad", fetchImpl });

    const err = await client.listRecords("tei.thinkwork.ai").catch((e) => e);
    expect(err).toBeInstanceOf(CloudflareApiError);
    expect((err as CloudflareApiError).isTokenDrift).toBe(true);
    expect((err as CloudflareApiError).body).toContain("Authentication error");
    expect(formatCloudflareError(err)).toContain("error 10000");
  });

  it("fails loudly when the zone is missing from the token's scope", async () => {
    const { fetchImpl } = makeFetch(() => ({
      status: 200,
      body: { success: true, result: [], errors: [] },
    }));
    const client = new CloudflareNamespaceClient({ token: "tok", fetchImpl });
    await expect(client.listRecords("tei.thinkwork.ai")).rejects.toThrow(
      /zone for "thinkwork.ai" not found/,
    );
  });
});
