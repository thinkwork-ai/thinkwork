import { describe, expect, it } from "vitest";
import {
  guardHarnessPublication,
  HarnessPublicationBlockedError,
} from "./publication-guard.js";

describe("Harness publication guard", () => {
  it("accepts the sanitized mixed-result projection", () => {
    expect(() =>
      guardHarnessPublication(
        "Alice's approved task field is approved-summary-alice. Unrelated content requires confirmation (decision 4d3219e8-a9be-4a61-b89b-2ec68145711d).",
      ),
    ).not.toThrow();
  });

  it.each([
    "SECRET_SENTINEL_ALICE",
    "private-alice",
    "Bearer eyJhbGciOiJSUzI1NiJ9.payload.signature",
    "api_key=do-not-publish-this-value",
    "https://bedrock-agentcore.us-east-1.amazonaws.com/identities/oauth2/authorize?request_uri=urn%3Aexample",
  ])("blocks forbidden private or credential material: %s", (value) => {
    expect(() => guardHarnessPublication(value)).toThrow(
      HarnessPublicationBlockedError,
    );
  });
});
