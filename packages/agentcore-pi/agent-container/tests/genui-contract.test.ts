import { describe, expect, it } from "vitest";
import {
  THREAD_GENUI_CATALOG_VERSION,
  createTaskReviewGenUIFixture,
  validateThreadGenUIPart,
} from "@thinkwork/genui";

describe("AgentCore Pi GenUI contract import", () => {
  it("uses the shared Thread GenUI catalog version", () => {
    const fixture = createTaskReviewGenUIFixture();

    expect(fixture.data.catalogVersion).toBe(THREAD_GENUI_CATALOG_VERSION);
    expect(validateThreadGenUIPart(fixture).ok).toBe(true);
  });
});
