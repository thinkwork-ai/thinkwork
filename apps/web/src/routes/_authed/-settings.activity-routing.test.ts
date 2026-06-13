import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const routesDir = path.dirname(fileURLToPath(import.meta.url));
const detailRoutePath = path.join(
  routesDir,
  "settings.activity_.$threadId.tsx",
);
const nestedDetailRoutePath = path.join(
  routesDir,
  "settings.activity.$threadId.tsx",
);

describe("Settings Activity detail routing", () => {
  it("keeps thread detail as a non-nested Settings route", () => {
    expect(fs.existsSync(detailRoutePath)).toBe(true);
    expect(fs.existsSync(nestedDetailRoutePath)).toBe(false);

    const routeSource = fs.readFileSync(detailRoutePath, "utf8");
    expect(routeSource).toContain(
      'createFileRoute("/_authed/settings/activity_/$threadId")',
    );
    expect(routeSource).toContain("SettingsActivityThreadDetail");
    expect(routeSource).not.toContain("OperatorGuard");
    expect(routeSource).not.toContain("SpacesThreadDetailRoute");
  });
});
