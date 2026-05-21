import { describe, expect, it } from "vitest";
import {
  GENERATED_APP_RUNTIME_MODE,
  isAppArtifactRuntimeMode,
  resolveGeneratedAppRuntimeMode,
} from "./app-artifacts";

describe("app artifact runtime model", () => {
  it("recognizes the host-owned runtime vocabulary", () => {
    expect(isAppArtifactRuntimeMode("sandboxedGenerated")).toBe(true);
    expect(isAppArtifactRuntimeMode("nativeTrusted")).toBe(true);
    expect(isAppArtifactRuntimeMode("sameOriginGenerated")).toBe(false);
    expect(isAppArtifactRuntimeMode(null)).toBe(false);
  });

  it("keeps generated app artifacts on the sandboxed runtime", () => {
    expect(resolveGeneratedAppRuntimeMode()).toBe(GENERATED_APP_RUNTIME_MODE);
    expect(
      resolveGeneratedAppRuntimeMode({
        runtimeMode: "nativeTrusted",
        trust: "please",
      }),
    ).toBe("sandboxedGenerated");
  });
});
