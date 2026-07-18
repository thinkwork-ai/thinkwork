import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { percentile, safeError } from "../smoke/harness-probe-lib.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path) => readFile(join(repoRoot, path), "utf8");

describe("Harness proof probes", () => {
  it("computes bounded percentiles deterministically", () => {
    assert.equal(percentile([4, 1, 3, 2], 50), 2);
    assert.equal(percentile([4, 1, 3, 2], 95), 4);
    assert.equal(percentile([], 99), 0);
  });

  it("redacts operational failures to kind and status", () => {
    assert.equal(
      safeError({
        name: "ThrottlingException",
        $metadata: { httpStatusCode: 429 },
      }),
      "ThrottlingException:429",
    );
    assert.doesNotMatch(safeError(new Error("secret-token")), /secret-token/);
  });

  it("freezes the 100-session, 10-per-second, 50-percent-headroom gate", async () => {
    const capacity = await read("scripts/smoke/harness-capacity-probe.mjs");
    assert.match(capacity, /HARNESS_CAPACITY_SESSIONS \?\? 100/);
    assert.match(capacity, /HARNESS_CAPACITY_NEW_SESSIONS_PER_SECOND \?\? 10/);
    assert.match(capacity, /activeHeadroom >= 0\.5 && rateHeadroom >= 0\.5/);
  });

  it("selects reuse only after identical correctness and a 20-percent benefit", async () => {
    const strategy = await read(
      "scripts/smoke/harness-session-strategy-probe.mjs",
    );
    assert.match(strategy, /correctnessIdentical/);
    assert.match(strategy, /latencyBenefit >= 0\.2 \|\| tokenBenefit >= 0\.2/);
    assert.match(strategy, /\? "reuse"\s+: "fresh"/s);
  });
});
