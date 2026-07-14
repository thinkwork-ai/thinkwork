import { describe, expect, it } from "vitest";
import {
  SANDBOX_SDK_DIR,
  buildSdkMaterializationPreamble,
} from "../lib/capability-broker/sandbox-sdk.js";

describe("buildSdkMaterializationPreamble", () => {
  const preamble = buildSdkMaterializationPreamble();

  it("writes the three flat sdk files onto sys.path", () => {
    expect(preamble).toContain(`_twcap_sdk_dir = "${SANDBOX_SDK_DIR}"`);
    expect(preamble).toContain('"canonical.py"');
    expect(preamble).toContain('"ed25519.py"');
    expect(preamble).toContain('"client.py"');
    expect(preamble).toContain("_twcap_sys.path.insert(0, _twcap_sdk_dir)");
  });

  it("embeds the real sdk source as decodable base64", () => {
    // Pull the first base64 blob (canonical.py) and confirm it decodes to the
    // actual SDK source — proves the esbuild/vitest .py text import worked.
    const m = preamble.match(/\("canonical\.py", "([A-Za-z0-9+/=]+)"\)/);
    expect(m).not.toBeNull();
    const decoded = Buffer.from(m![1], "base64").toString("utf8");
    expect(decoded).toContain("def "); // canonical.py is real Python
    expect(decoded.length).toBeGreaterThan(200);
  });
});
