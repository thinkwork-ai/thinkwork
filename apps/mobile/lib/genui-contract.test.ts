import { describe, expect, it } from "vitest";
import {
  createTaskReviewGenUIFixture,
  validateThreadGenUIPart,
} from "@thinkwork/genui";

describe("mobile GenUI contract import", () => {
  it("can validate the shared Thread GenUI mobile fallback", () => {
    const fixture = createTaskReviewGenUIFixture();
    const result = validateThreadGenUIPart(fixture);

    expect(result.ok).toBe(true);
    expect(fixture.data.mobileFallback.summary).toContain("kickoff task");
  });
});
