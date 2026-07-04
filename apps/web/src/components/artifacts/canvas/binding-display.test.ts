import { describe, expect, it } from "vitest";
import {
  freshnessBadgeConfig,
  ownerLabel,
  provenanceArgRows,
  refreshControlState,
  type CanvasBinding,
} from "./binding-display";

const baseBinding: Pick<CanvasBinding, "authContext" | "ownerUserId"> = {
  authContext: "TENANT_MCP",
  ownerUserId: null,
};

describe("freshnessBadgeConfig", () => {
  it("maps each quality/transient state to a distinct tone", () => {
    expect(freshnessBadgeConfig("GOOD").tone).toBe("good");
    expect(freshnessBadgeConfig("STALE").tone).toBe("warn");
    expect(freshnessBadgeConfig("BAD").tone).toBe("bad");
    expect(freshnessBadgeConfig("SCHEMA_STALE").tone).toBe("schema");
    expect(freshnessBadgeConfig("REFRESHING").tone).toBe("refreshing");
  });

  it("gives schema-stale a distinct tone from a transient failure", () => {
    expect(freshnessBadgeConfig("SCHEMA_STALE").tone).not.toBe(
      freshnessBadgeConfig("BAD").tone,
    );
  });
});

describe("refreshControlState", () => {
  it("enables tenant-scoped bindings for any member", () => {
    const state = refreshControlState({
      binding: baseBinding,
      currentUserId: "someone-else",
      refreshing: false,
    });
    expect(state.enabled).toBe(true);
    expect(state.needsOwnerAction).toBe(false);
    expect(state.label).toBe("Refresh");
  });

  it("disables any control while a refresh is in flight (no double-fire)", () => {
    const state = refreshControlState({
      binding: baseBinding,
      currentUserId: "u1",
      refreshing: true,
    });
    expect(state.enabled).toBe(false);
  });

  it("shows the owner a 'needs you' enabled control for per-user OAuth", () => {
    const state = refreshControlState({
      binding: { authContext: "PER_USER_OAUTH", ownerUserId: "u1" },
      currentUserId: "u1",
      refreshing: false,
    });
    expect(state.enabled).toBe(true);
    expect(state.needsOwnerAction).toBe(true);
    expect(state.label).toBe("Refresh needs you");
  });

  it("shows non-owners a disabled control naming the owner", () => {
    const state = refreshControlState({
      binding: {
        authContext: "PER_USER_OAUTH",
        ownerUserId: "owner-123456789",
      },
      currentUserId: "someone-else",
      refreshing: false,
    });
    expect(state.enabled).toBe(false);
    expect(state.needsOwnerAction).toBe(false);
    expect(state.label).toContain(ownerLabel("owner-123456789"));
  });
});

describe("provenanceArgRows", () => {
  it("renders already-redacted primitives and stringifies objects", () => {
    const rows = provenanceArgRows({
      region: "us-east-1",
      limit: 10,
      token: "«redacted»",
      filter: { status: "open" },
    });
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    expect(map.region).toBe("us-east-1");
    expect(map.limit).toBe("10");
    expect(map.token).toBe("«redacted»");
    expect(map.filter).toBe('{"status":"open"}');
  });

  it("parses a JSON string and returns [] for non-objects", () => {
    expect(provenanceArgRows('{"a":1}')).toEqual([{ key: "a", value: "1" }]);
    expect(provenanceArgRows(null)).toEqual([]);
    expect(provenanceArgRows("not json")).toEqual([]);
  });
});
