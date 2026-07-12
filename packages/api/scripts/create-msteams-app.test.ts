import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, it, expect } from "vitest";
import {
  buildStoreZip,
  buildTeamsAppPackage,
  listZipEntries,
  parseCliArgs,
  readPngDimensions,
  stageSuffix,
  substituteManifestTemplate,
  validateAppPackage,
  type PackageInputs,
} from "./create-msteams-app";

const PACKAGE_DIR = fileURLToPath(
  new URL("../teams-app-package/", import.meta.url),
);

const INPUTS: PackageInputs = {
  stage: "dev",
  botAppId: "11111111-2222-4333-8444-555555555555",
  apiBaseDomain: "abc123.execute-api.us-east-1.amazonaws.com",
};

function loadIcons() {
  return {
    color: readFileSync(path.join(PACKAGE_DIR, "color.png")),
    outline: readFileSync(path.join(PACKAGE_DIR, "outline.png")),
  };
}

function substitutedManifest(inputs: PackageInputs = INPUTS): string {
  const template = readFileSync(
    path.join(PACKAGE_DIR, "manifest.json"),
    "utf8",
  );
  return substituteManifestTemplate(template, inputs);
}

describe("substituteManifestTemplate", () => {
  it("substitutes bot app id, stage suffix, and API domain", () => {
    const manifest = JSON.parse(substitutedManifest()) as Record<string, any>;
    expect(manifest.id).toBe(INPUTS.botAppId);
    expect(manifest.bots[0].botId).toBe(INPUTS.botAppId);
    expect(manifest.webApplicationInfo.id).toBe(INPUTS.botAppId);
    expect(manifest.validDomains).toEqual([INPUTS.apiBaseDomain]);
    expect(manifest.name.short).toBe("ThinkWork (dev)");
  });

  it("drops the stage suffix for prod", () => {
    const manifest = JSON.parse(
      substitutedManifest({ ...INPUTS, stage: "prod" }),
    ) as Record<string, any>;
    expect(manifest.name.short).toBe("ThinkWork");
    expect(stageSuffix("prod")).toBe("");
  });

  it("leaves no ${...} placeholders in the template after substitution", () => {
    expect(substitutedManifest()).not.toMatch(/\$\{[^}]*\}/);
  });
});

describe("validateAppPackage", () => {
  it("passes on the substituted checked-in template with real icons", () => {
    expect(
      validateAppPackage(substitutedManifest(), loadIcons(), INPUTS),
    ).toEqual([]);
  });

  it("fails when a placeholder leaks through", () => {
    const leaky = substitutedManifest().replace(
      INPUTS.apiBaseDomain,
      "${API_BASE_DOMAIN}",
    );
    const problems = validateAppPackage(leaky, loadIcons(), INPUTS);
    expect(problems.some((p) => p.includes("unsubstituted placeholder"))).toBe(
      true,
    );
  });

  it("fails when the bot id is not a UUID", () => {
    const problems = validateAppPackage(
      substitutedManifest({ ...INPUTS, botAppId: "not-a-uuid" }),
      loadIcons(),
      INPUTS,
    );
    expect(problems.some((p) => p.includes("not a UUID"))).toBe(true);
  });

  it("fails on wildcard or unexpected validDomains", () => {
    const wildcard = substitutedManifest().replace(
      INPUTS.apiBaseDomain,
      "*.amazonaws.com",
    );
    const problems = validateAppPackage(wildcard, loadIcons(), INPUTS);
    expect(problems.some((p) => p.includes("validDomains"))).toBe(true);
  });

  it("fails when an icon has the wrong dimensions", () => {
    const icons = loadIcons();
    // Swap the icons: color becomes 32x32, outline becomes 192x192.
    const problems = validateAppPackage(
      substitutedManifest(),
      { color: icons.outline, outline: icons.color },
      INPUTS,
    );
    expect(problems.some((p) => p.includes("color.png must be 192x192"))).toBe(
      true,
    );
    expect(problems.some((p) => p.includes("outline.png must be 32x32"))).toBe(
      true,
    );
  });

  it("fails on non-PNG icon bytes", () => {
    const icons = loadIcons();
    const problems = validateAppPackage(
      substitutedManifest(),
      { color: Buffer.from("not a png"), outline: icons.outline },
      INPUTS,
    );
    expect(problems.some((p) => p.includes("not a PNG"))).toBe(true);
  });
});

describe("readPngDimensions", () => {
  it("reads dimensions from the checked-in icons", () => {
    const icons = loadIcons();
    expect(readPngDimensions(icons.color)).toEqual({ width: 192, height: 192 });
    expect(readPngDimensions(icons.outline)).toEqual({ width: 32, height: 32 });
  });
});

describe("buildStoreZip / buildTeamsAppPackage", () => {
  it("produces a zip with exactly the three package entries", () => {
    const zip = buildTeamsAppPackage(INPUTS);
    expect(listZipEntries(zip)).toEqual([
      "manifest.json",
      "color.png",
      "outline.png",
    ]);
  });

  it("round-trips entry names through the central directory", () => {
    const zip = buildStoreZip([
      { name: "a.txt", data: Buffer.from("hello") },
      { name: "b.bin", data: Buffer.from([1, 2, 3]) },
    ]);
    expect(listZipEntries(zip)).toEqual(["a.txt", "b.bin"]);
  });

  it("throws (fails validation) when inputs would leak a placeholder", () => {
    expect(() =>
      buildTeamsAppPackage({ ...INPUTS, botAppId: "${BOT_APP_ID}" }),
    ).toThrow(/invalid Teams app package/);
  });
});

describe("parseCliArgs", () => {
  it("reads flags in --flag value and --flag=value forms", () => {
    const args = parseCliArgs(
      [
        "--stage",
        "dev",
        "--bot-app-id=11111111-2222-4333-8444-555555555555",
        "--api-domain",
        "api.example.com",
      ],
      {},
    );
    expect(args.stage).toBe("dev");
    expect(args.botAppId).toBe("11111111-2222-4333-8444-555555555555");
    expect(args.apiBaseDomain).toBe("api.example.com");
  });

  it("falls back to env vars and reports all missing inputs", () => {
    const args = parseCliArgs([], {
      STAGE: "dev",
      MSTEAMS_BOT_APP_ID: "11111111-2222-4333-8444-555555555555",
      API_BASE_DOMAIN: "api.example.com",
    });
    expect(args.stage).toBe("dev");
    expect(() => parseCliArgs([], {})).toThrow(
      /--stage.*--bot-app-id.*--api-domain/s,
    );
  });
});
