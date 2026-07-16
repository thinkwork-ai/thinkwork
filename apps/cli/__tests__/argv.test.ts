import { describe, expect, it } from "vitest";

import { stripForwardedSeparator } from "../src/lib/argv.js";

describe("stripForwardedSeparator", () => {
  it("drops the literal -- that pnpm run forwards before the subcommand", () => {
    expect(
      stripForwardedSeparator([
        "node",
        "cli.ts",
        "--",
        "destroy",
        "--stage",
        "prod",
        "--yes",
      ]),
    ).toEqual(["node", "cli.ts", "destroy", "--stage", "prod", "--yes"]);
  });

  it("leaves a direct invocation untouched", () => {
    const argv = ["node", "cli.ts", "destroy", "--stage", "prod"];
    expect(stripForwardedSeparator(argv)).toEqual(argv);
  });

  it("preserves a later -- end-of-options marker", () => {
    expect(
      stripForwardedSeparator(["node", "cli.ts", "--", "run", "--", "-x"]),
    ).toEqual(["node", "cli.ts", "run", "--", "-x"]);
  });
});
