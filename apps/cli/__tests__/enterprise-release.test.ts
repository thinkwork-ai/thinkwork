import { describe, expect, it } from "vitest";

import { resolveEnterpriseReleasePin } from "../src/commands/enterprise/release.js";
import { VERSION } from "../src/version.js";

describe("enterprise release pin", () => {
  it("defaults to the running CLI version and leaves digest unresolved", () => {
    const release = resolveEnterpriseReleasePin({});

    expect(release).toEqual({
      version: `v${VERSION}`,
      manifestUrl: `https://github.com/thinkwork-ai/thinkwork/releases/download/v${VERSION}/thinkwork-release.json`,
      manifestSha256: undefined,
      terraformModuleVersion: VERSION,
    });
  });

  it("accepts explicit manifest digest and module version overrides", () => {
    const release = resolveEnterpriseReleasePin({
      releaseVersion: "v1.2.3",
      manifestUrl: "https://example.test/thinkwork-release.json",
      manifestSha256:
        "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
      terraformModuleVersion: "1.2.3-hotfix.1",
    });

    expect(release.version).toBe("v1.2.3");
    expect(release.manifestUrl).toBe(
      "https://example.test/thinkwork-release.json",
    );
    expect(release.manifestSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(release.terraformModuleVersion).toBe("1.2.3-hotfix.1");
  });
});
