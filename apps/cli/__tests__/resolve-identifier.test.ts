import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resolveIdentifier, isUuid } from "../src/lib/resolve-identifier.js";

interface Server {
  id: string;
  slug: string;
  name: string;
}

const SERVERS: Server[] = [
  {
    id: "629dcee1-1e14-4b83-9907-cb529e6035f6",
    slug: "routing-server",
    name: "Routing Server",
  },
  {
    id: "11111111-2222-3333-4444-555555555555",
    slug: "other-server",
    name: "Other Server",
  },
];

function makeListFn(items: Server[]): () => Promise<Server[]> {
  return vi.fn(async () => items);
}

const adapter = {
  getId: (s: Server) => s.id,
  getAliases: (s: Server) => [s.slug, s.name],
  resourceLabel: "MCP server",
};

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isUuid", () => {
  it("accepts lowercase UUIDs", () => {
    expect(isUuid("629dcee1-1e14-4b83-9907-cb529e6035f6")).toBe(true);
  });
  it("accepts uppercase UUIDs", () => {
    expect(isUuid("629DCEE1-1E14-4B83-9907-CB529E6035F6")).toBe(true);
  });
  it("rejects slugs", () => {
    expect(isUuid("routing-server")).toBe(false);
  });
  it("rejects UUID-looking strings with wrong hyphen positions", () => {
    expect(isUuid("629dcee1-1e14-4b83-9907cb529e6035f6")).toBe(false);
  });
});

describe("resolveIdentifier — UUID path", () => {
  it("returns the item when the UUID matches", async () => {
    const list = makeListFn(SERVERS);
    const result = await resolveIdentifier({
      ...adapter,
      identifier: "629dcee1-1e14-4b83-9907-cb529e6035f6",
      list,
    });
    expect(result.slug).toBe("routing-server");
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("exits with a clear error on an unknown UUID", async () => {
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);
    await resolveIdentifier({
      ...adapter,
      identifier: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      list: makeListFn(SERVERS),
    }).catch(() => undefined);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe("resolveIdentifier — alias path", () => {
  it("matches by slug (case-insensitive)", async () => {
    const result = await resolveIdentifier({
      ...adapter,
      identifier: "Routing-Server",
      list: makeListFn(SERVERS),
    });
    expect(result.id).toBe("629dcee1-1e14-4b83-9907-cb529e6035f6");
  });

  it("matches by human name", async () => {
    const result = await resolveIdentifier({
      ...adapter,
      identifier: "Routing Server",
      list: makeListFn(SERVERS),
    });
    expect(result.id).toBe("629dcee1-1e14-4b83-9907-cb529e6035f6");
  });

  it("exits when zero aliases match", async () => {
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);
    await resolveIdentifier({
      ...adapter,
      identifier: "does-not-exist",
      list: makeListFn(SERVERS),
    }).catch(() => undefined);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits when multiple aliases match (duplicate names)", async () => {
    const dupes: Server[] = [
      { id: "u1", slug: "a", name: "Shared" },
      { id: "u2", slug: "b", name: "Shared" },
    ];
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);
    await resolveIdentifier({
      ...adapter,
      identifier: "Shared",
      list: makeListFn(dupes),
    }).catch(() => undefined);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe("resolveIdentifier — missing-arg path (non-TTY)", () => {
  it("exits cleanly when stdin is not a TTY", async () => {
    const originalTty = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);

    await resolveIdentifier({
      ...adapter,
      identifier: undefined,
      list: makeListFn(SERVERS),
    }).catch(() => undefined);

    expect(exitSpy).toHaveBeenCalledWith(1);
    Object.defineProperty(process.stdin, "isTTY", {
      value: originalTty,
      configurable: true,
    });
  });
});
