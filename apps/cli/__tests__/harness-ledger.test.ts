import { describe, expect, it } from "vitest";
import {
  classifyError,
  extractSecretValues,
  fingerprint,
  renderEntry,
  scrubSecrets,
  upsertEntry,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain .mjs helper shared with scripts/deploy-harness.sh
} from "../../../scripts/lib/harness-ledger.mjs";

const NOW = "2026-07-01T00:00:00.000Z";
const LATER = "2026-07-02T00:00:00.000Z";

describe("harness-ledger", () => {
  it("renders a well-formed entry from a synthetic failure", () => {
    const store: Record<string, unknown> = {};
    const { entry, isNew } = upsertEntry(store, {
      layer: "terraform",
      step: "deploy",
      stage: "hprod-260701-001",
      errorClass: "quota-or-throttle",
      excerpt: "Error: LimitExceeded creating function",
      now: NOW,
    });
    expect(isNew).toBe(true);
    const rendered = renderEntry(entry);
    expect(rendered).toContain("layer: **terraform**");
    expect(rendered).toContain("step: `deploy`");
    expect(rendered).toContain("class: `quota-or-throttle`");
    expect(rendered).toContain(entry.fingerprint);
    expect(entry.fingerprint).toMatch(/^[0-9a-f]{12}$/);
  });

  it("gives distinct failures distinct fingerprints", () => {
    const a = fingerprint({
      layer: "terraform",
      step: "deploy",
      errorClass: "state-lock",
    });
    const b = fingerprint({
      layer: "stack",
      step: "verify-status",
      errorClass: "connectivity",
    });
    expect(a).not.toBe(b);
  });

  it("dedupes the same failure into one fingerprint with updated last seen", () => {
    const store: Record<string, unknown> = {};
    const first = upsertEntry(store, {
      layer: "terraform",
      step: "deploy",
      stage: "hprod-260701-001",
      errorClass: "state-lock",
      excerpt: "Error acquiring the state lock",
      now: NOW,
    });
    const second = upsertEntry(store, {
      layer: "terraform",
      step: "deploy",
      stage: "hprod-260702-002",
      errorClass: "state-lock",
      excerpt: "Error acquiring the state lock",
      now: LATER,
    });
    expect(second.isNew).toBe(false);
    expect(Object.keys(store)).toHaveLength(1);
    expect(second.entry.fingerprint).toBe(first.entry.fingerprint);
    expect(second.entry.firstSeen).toBe(NOW);
    expect(second.entry.lastSeen).toBe(LATER);
    expect(second.entry.occurrences).toBe(2);
  });

  it("scrubs tfvars secret values from log excerpts", () => {
    const tfvars = [
      'stage      = "hprod-260701-001"',
      'db_password = "sup3r-s3cret-value"',
      'api_auth_secret = "tw-hprod-abcdef123456"',
      'region     = "us-east-1"',
    ].join("\n");
    const secrets = extractSecretValues(tfvars);
    expect(secrets).toEqual(["sup3r-s3cret-value", "tw-hprod-abcdef123456"]);

    const log =
      'Error: password authentication failed for "sup3r-s3cret-value" (token tw-hprod-abcdef123456)';
    const scrubbed = scrubSecrets(log, secrets);
    expect(scrubbed).not.toContain("sup3r-s3cret-value");
    expect(scrubbed).not.toContain("tw-hprod-abcdef123456");
    expect(scrubbed).toContain("«scrubbed»");
    // Non-secret values survive.
    expect(scrubbed).toContain("password authentication failed");
  });

  it("classifies common failure shapes", () => {
    expect(classifyError("Error acquiring the state lock ...")).toBe(
      "state-lock",
    );
    expect(classifyError("LimitExceeded: too many functions")).toBe(
      "quota-or-throttle",
    );
    expect(
      classifyError("The security token included in the request is expired"),
    ).toBe("expired-credentials");
    expect(classifyError("something novel went wrong")).toBe("unclassified");
  });
});
