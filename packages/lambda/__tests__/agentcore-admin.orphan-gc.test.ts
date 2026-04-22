/**
 * Unit tests for the pure GC logic. AWS + DB paths are not mocked — those
 * get verified during Unit 5.5 dev-stage smoke tests.
 */

import { describe, it, expect } from "vitest";
import { computeOrphans } from "../agentcore-admin.js";

const now = new Date("2026-04-22T12:00:00Z").getTime();
const HOUR = 60 * 60 * 1000;

describe("computeOrphans — name prefix filter", () => {
  it("ignores interpreters without the stage prefix", () => {
    const result = computeOrphans({
      now,
      stage: "dev",
      listed: [
        {
          codeInterpreterId: "ci-a",
          name: "some-other-project-interpreter",
          createdAt: new Date(now - 2 * HOUR),
        },
      ],
      liveIds: new Set(),
    });
    expect(result.scanned).toBe(0);
    expect(result.orphans).toHaveLength(0);
  });

  it("ignores interpreters from a different stage", () => {
    // Stage collision guard: dev GC must not touch prod-named interpreters.
    const result = computeOrphans({
      now,
      stage: "dev",
      listed: [
        {
          codeInterpreterId: "ci-prod",
          name: "thinkwork-prod-sb-aaaa1111-defaultpublic",
          createdAt: new Date(now - 2 * HOUR),
        },
      ],
      liveIds: new Set(),
    });
    expect(result.scanned).toBe(0);
    expect(result.orphans).toHaveLength(0);
  });

  it("includes interpreters that do match the stage prefix", () => {
    const result = computeOrphans({
      now,
      stage: "dev",
      listed: [
        {
          codeInterpreterId: "ci-dev",
          name: "thinkwork-dev-sb-aaaa1111-defaultpublic",
          createdAt: new Date(now - 2 * HOUR),
        },
      ],
      liveIds: new Set(),
    });
    expect(result.scanned).toBe(1);
    expect(result.orphans).toHaveLength(1);
  });
});

describe("computeOrphans — liveIds cross-reference", () => {
  it("counts interpreters still referenced by a tenant as live", () => {
    const result = computeOrphans({
      now,
      stage: "dev",
      listed: [
        {
          codeInterpreterId: "ci-live",
          name: "thinkwork-dev-sb-aaaa1111-defaultpublic",
          createdAt: new Date(now - 2 * HOUR),
        },
        {
          codeInterpreterId: "ci-orphan",
          name: "thinkwork-dev-sb-bbbb2222-defaultpublic",
          createdAt: new Date(now - 2 * HOUR),
        },
      ],
      liveIds: new Set(["ci-live"]),
    });
    expect(result.live).toBe(1);
    expect(result.orphans.map((o) => o.codeInterpreterId)).toEqual([
      "ci-orphan",
    ]);
  });
});

describe("computeOrphans — minimum-age skip", () => {
  it("skips interpreters younger than the 1-hour default", () => {
    const result = computeOrphans({
      now,
      stage: "dev",
      listed: [
        {
          codeInterpreterId: "ci-fresh",
          name: "thinkwork-dev-sb-cccc3333-defaultpublic",
          createdAt: new Date(now - 10 * 60 * 1000), // 10 min old
        },
      ],
      liveIds: new Set(),
    });
    expect(result.skippedAge).toBe(1);
    expect(result.orphans).toHaveLength(0);
  });

  it("honors a custom minAgeMs override", () => {
    const result = computeOrphans({
      now,
      stage: "dev",
      listed: [
        {
          codeInterpreterId: "ci-10m",
          name: "thinkwork-dev-sb-dddd4444-defaultpublic",
          createdAt: new Date(now - 10 * 60 * 1000),
        },
      ],
      liveIds: new Set(),
      minAgeMs: 5 * 60 * 1000, // 5 min
    });
    expect(result.orphans).toHaveLength(1);
  });

  it("does not skip when createdAt is absent (treat as safe-to-delete)", () => {
    // A summary with no createdAt comes from a non-standard/stale control
    // plane state; the guard can't run, so we still treat it as deletable
    // rather than leak indefinitely.
    const result = computeOrphans({
      now,
      stage: "dev",
      listed: [
        {
          codeInterpreterId: "ci-unknown-age",
          name: "thinkwork-dev-sb-eeee5555-defaultpublic",
          // createdAt intentionally absent
        },
      ],
      liveIds: new Set(),
    });
    // ageMs computes to now - now = 0, so default 1h skip catches it.
    expect(result.skippedAge).toBe(1);
    expect(result.orphans).toHaveLength(0);
  });
});

describe("computeOrphans — mixed batch", () => {
  it("returns accurate counts across live / skipped / orphan cases", () => {
    const listed = [
      // wrong prefix
      {
        codeInterpreterId: "ci-wrong",
        name: "other-thing",
        createdAt: new Date(now - 2 * HOUR),
      },
      // live
      {
        codeInterpreterId: "ci-live1",
        name: "thinkwork-dev-sb-aaaa-defaultpublic",
        createdAt: new Date(now - 10 * HOUR),
      },
      // skipped by age
      {
        codeInterpreterId: "ci-young",
        name: "thinkwork-dev-sb-bbbb-defaultpublic",
        createdAt: new Date(now - 10 * 60 * 1000),
      },
      // orphan
      {
        codeInterpreterId: "ci-orphan1",
        name: "thinkwork-dev-sb-cccc-defaultpublic",
        createdAt: new Date(now - 5 * HOUR),
      },
      // another orphan
      {
        codeInterpreterId: "ci-orphan2",
        name: "thinkwork-dev-sb-dddd-internalonly",
        createdAt: new Date(now - 72 * HOUR),
      },
    ];

    const result = computeOrphans({
      now,
      stage: "dev",
      listed,
      liveIds: new Set(["ci-live1"]),
    });

    expect(result.scanned).toBe(4); // "ci-wrong" was dropped before scanning
    expect(result.live).toBe(1);
    expect(result.skippedAge).toBe(1);
    expect(result.orphans).toHaveLength(2);
    expect(result.orphans.map((o) => o.codeInterpreterId).sort()).toEqual([
      "ci-orphan1",
      "ci-orphan2",
    ]);
  });
});
