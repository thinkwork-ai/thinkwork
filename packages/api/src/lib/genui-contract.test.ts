import { describe, expect, it } from "vitest";
import {
  THREAD_GENUI_PART_TYPE,
  createTaskReviewGenUIFixture,
  validateThreadGenUIPart,
} from "@thinkwork/genui";

describe("API GenUI contract import", () => {
  it("validates the shared Thread GenUI envelope", () => {
    const fixture = createTaskReviewGenUIFixture();
    const result = validateThreadGenUIPart(fixture);

    expect(fixture.type).toBe(THREAD_GENUI_PART_TYPE);
    expect(result.ok).toBe(true);
  });
});
