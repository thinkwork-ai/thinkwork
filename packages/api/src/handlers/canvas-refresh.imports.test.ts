import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * A headless canvas data-refresh consumes NO agent turn and NO model tokens
 * (THINK-145 Success Criteria). Guard that neither the handler nor its core
 * pulls a Bedrock / model-invocation seam — an accidental import would be the
 * regression this test exists to catch.
 */
const FORBIDDEN = [
  "client-bedrock",
  "bedrock-runtime",
  "bedrock-agentcore",
  "InvokeModel",
  "ConverseCommand",
  "invokeChatAgent",
];

const FILES = [
  join(here, "canvas-refresh.ts"),
  join(here, "..", "lib", "artifacts", "canvas-refresh-core.ts"),
];

describe("canvas-refresh — no model/Bedrock seam", () => {
  for (const file of FILES) {
    it(`${file.split("/").slice(-1)[0]} imports no Bedrock/model client`, () => {
      const source = readFileSync(file, "utf8");
      for (const needle of FORBIDDEN) {
        expect(source).not.toContain(needle);
      }
    });
  }
});
