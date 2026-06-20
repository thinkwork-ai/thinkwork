import { describe, expect, it } from "vitest";
import {
  THREAD_GENUI_SCHEMA_VERSION,
  createTaskReviewGenUIFixture,
  validateThreadGenUIPart,
} from "@thinkwork/genui";

describe("Pi runtime GenUI contract import", () => {
  it("uses the shared Thread GenUI schema version", () => {
    const fixture = createTaskReviewGenUIFixture();

    expect(fixture.data.schemaVersion).toBe(THREAD_GENUI_SCHEMA_VERSION);
    expect(validateThreadGenUIPart(fixture).ok).toBe(true);
  });
});
