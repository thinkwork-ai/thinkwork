import { describe, expect, it } from "vitest";

import { isUploadUnsupported } from "../load-attachments";
import { TwentyGraphqlError } from "../twenty-client";

describe("isUploadUnsupported", () => {
  it("recognizes the missing Upload scalar and uploadFile mutation", () => {
    expect(
      isUploadUnsupported(
        new TwentyGraphqlError("x", {
          errors: [{ message: 'Unknown type "Upload". Did you mean "Float"?' }],
        }),
      ),
    ).toBe(true);
    expect(
      isUploadUnsupported(
        new TwentyGraphqlError("x", {
          errors: [
            { message: 'Cannot query field "uploadFile" on type "Mutation".' },
          ],
        }),
      ),
    ).toBe(true);
  });

  it("does not swallow a genuine upload failure", () => {
    // A real 500 or a missing binary must still count as a failure, so the run
    // exits non-zero and someone looks at it.
    expect(
      isUploadUnsupported(
        new TwentyGraphqlError("x", {
          errors: [{ message: "Internal server error" }],
        }),
      ),
    ).toBe(false);
    expect(isUploadUnsupported(new Error("connect ETIMEDOUT"))).toBe(false);
  });
});
