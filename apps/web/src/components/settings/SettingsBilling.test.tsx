import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "src/components/settings/SettingsBilling.tsx"),
  "utf8",
);

describe("SettingsBilling", () => {
  it("keeps billing owner-gated while using the web settings surface", () => {
    expect(source).toContain('role !== "owner"');
    expect(source).toContain("Owner access only");
    expect(source).toContain("SettingsHeader");
    expect(source).toContain("SettingsSection");
  });

  it("preserves Stripe subscription, checkout, and portal flows", () => {
    expect(source).toContain("/api/stripe/subscription");
    expect(source).toContain("/api/stripe/checkout-session");
    expect(source).toContain("/api/stripe/portal-session");
    expect(source).toContain("window.open");
    expect(source).toContain("@thinkwork/pricing-config");
  });
});
