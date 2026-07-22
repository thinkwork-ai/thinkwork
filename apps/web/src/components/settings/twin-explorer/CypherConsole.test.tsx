import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rawCalls = vi.hoisted(() => [] as Array<Record<string, unknown>>);
const urqlState = vi.hoisted(() => ({
  result: {
    fetching: false,
    data: null as unknown,
    error: null as { message: string } | null,
  },
  reexecute: vi.fn(),
}));

vi.mock("urql", () => ({
  useQuery: (args: {
    variables?: Record<string, unknown>;
    pause?: boolean;
  }) => {
    if (!args.pause) rawCalls.push(args.variables ?? {});
    return [
      args.pause
        ? { fetching: false, data: null, error: null }
        : urqlState.result,
      urqlState.reexecute,
    ];
  },
}));
vi.mock("@/context/TenantContext", () => ({
  useTenant: () => ({ tenantId: "tenant-1" }),
}));
vi.mock("@thinkwork/ui", () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

import {
  clientDenylistHit,
  CypherConsole,
  parseRawEnvelope,
  tableColumns,
} from "./CypherConsole";

function runQuery(text: string) {
  fireEvent.change(screen.getByTestId("console-input"), {
    target: { value: text },
  });
  fireEvent.click(screen.getByTestId("console-run"));
}

describe("CypherConsole", () => {
  beforeEach(() => {
    rawCalls.length = 0;
    urqlState.result = { fetching: false, data: null, error: null };
    urqlState.reexecute.mockClear();
  });
  afterEach(cleanup);

  it("runs a query and renders a tabular result", () => {
    urqlState.result = {
      fetching: false,
      error: null,
      data: {
        twinRawQuery: JSON.stringify({
          ok: true,
          results: [
            { name: "ACME", dpd: 94 },
            { name: "FORMOSA", dpd: 91 },
          ],
          redactedCount: 0,
          unfenced: false,
          truncated: false,
        }),
      },
    };
    render(<CypherConsole />);
    runQuery("MATCH (n:customer) RETURN n.displayName AS name, n.dpd AS dpd");
    expect(rawCalls.at(-1)!.query).toContain("MATCH (n:customer)");
    expect(screen.getByTestId("console-table")).toBeTruthy();
    expect(screen.getByText("FORMOSA")).toBeTruthy();
  });

  it("disables Run with a pending indicator while in flight", () => {
    urqlState.result = { fetching: true, data: null, error: null };
    render(<CypherConsole />);
    runQuery("MATCH (n) RETURN n");
    expect(
      (screen.getByTestId("console-run") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByTestId("console-pending")).toBeTruthy();
  });

  it("shows the redaction banner with the count", () => {
    urqlState.result = {
      fetching: false,
      error: null,
      data: {
        twinRawQuery: JSON.stringify({
          ok: true,
          results: [{ n: { "~id": "t#tenant-1#e#a" } }],
          redactedCount: 3,
          unfenced: false,
        }),
      },
    };
    render(<CypherConsole />);
    runQuery("MATCH (n) RETURN n");
    expect(
      screen.getByTestId("console-redaction-banner").textContent,
    ).toContain("3 results outside your tenant were redacted");
  });

  it("shows the unfenced banner on scalar results", () => {
    urqlState.result = {
      fetching: false,
      error: null,
      data: {
        twinRawQuery: JSON.stringify({
          ok: true,
          results: [{ count: 42 }],
          redactedCount: 0,
          unfenced: true,
        }),
      },
    };
    render(<CypherConsole />);
    runQuery("MATCH (n) RETURN count(n)");
    expect(screen.getByTestId("console-unfenced-banner")).toBeTruthy();
  });

  it("client denylist blocks DELETE and comment-split DEL/**/ETE without a network call", () => {
    render(<CypherConsole />);
    runQuery("MATCH (n) DELETE n");
    expect(screen.getByTestId("console-client-reject").textContent).toContain(
      "DELETE",
    );
    expect(rawCalls).toHaveLength(0);

    runQuery("MATCH (n) DEL/**/ETE n");
    expect(screen.getByTestId("console-client-reject")).toBeTruthy();
    expect(rawCalls).toHaveLength(0);
  });

  it("renders the server's rejection reason", () => {
    urqlState.result = {
      fetching: false,
      error: null,
      data: {
        twinRawQuery: JSON.stringify({
          ok: false,
          reason: "invalid_request",
          detail: "write/procedure clause not allowed: SET",
        }),
      },
    };
    render(<CypherConsole />);
    // A query the CLIENT allows but the server rejects (mirror drift case).
    runQuery("MATCH (n) RETURN n");
    expect(screen.getByTestId("console-server-reject").textContent).toContain(
      "write/procedure clause not allowed: SET",
    );
  });
});

describe("console helpers", () => {
  it("clientDenylistHit mirrors the server normalization", () => {
    expect(clientDenylistHit("MATCH (n) RETURN n.created_at")).toBeNull();
    expect(clientDenylistHit("MATCH (n) DEL/**/ETE n")).toBe("DELETE");
    expect(clientDenylistHit("merge (n) return n")).toBe("MERGE");
    expect(clientDenylistHit("MATCH (n) RETURN n // DELETE x")).toBeNull();
  });

  it("tableColumns accepts only uniform flat rows", () => {
    expect(tableColumns([{ a: 1 }, { a: 2 }])).toEqual(["a"]);
    expect(tableColumns([{ a: 1 }, { b: 2 }])).toBeNull();
    expect(tableColumns([1, 2] as unknown[])).toBeNull();
    expect(tableColumns([])).toBeNull();
  });

  it("parseRawEnvelope tolerates strings and garbage", () => {
    expect(parseRawEnvelope('{"ok":true,"results":[]}')).toMatchObject({
      ok: true,
    });
    expect(parseRawEnvelope("{{")).toBeNull();
    expect(parseRawEnvelope({ notOk: 1 })).toBeNull();
  });
});
