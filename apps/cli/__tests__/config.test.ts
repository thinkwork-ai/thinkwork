import { describe, it, expect } from "vitest";
import {
  validateStage,
  validateComponent,
  isProdLike,
  expandComponent,
} from "../src/config.js";

describe("validateStage", () => {
  it("accepts valid stage names", () => {
    expect(validateStage("dev").valid).toBe(true);
    expect(validateStage("prod").valid).toBe(true);
    expect(validateStage("staging").valid).toBe(true);
    expect(validateStage("ericodom").valid).toBe(true);
    expect(validateStage("my-stage-123").valid).toBe(true);
  });

  it("rejects empty stage", () => {
    expect(validateStage("").valid).toBe(false);
  });

  it("rejects uppercase", () => {
    expect(validateStage("Dev").valid).toBe(false);
    expect(validateStage("PROD").valid).toBe(false);
  });

  it("rejects typos and malformed names", () => {
    expect(validateStage("priduction").valid).toBe(true); // valid format, just a typo — stage validation doesn't spell-check
    expect(validateStage("a").valid).toBe(false); // too short
    expect(validateStage("123stage").valid).toBe(false); // starts with number
    expect(validateStage("my_stage").valid).toBe(false); // underscores not allowed
    expect(validateStage("my stage").valid).toBe(false); // spaces not allowed
  });

  it("rejects stages over 30 characters", () => {
    expect(validateStage("a".repeat(31)).valid).toBe(false);
    expect(validateStage("a".repeat(30)).valid).toBe(true);
  });
});

describe("validateComponent", () => {
  it("accepts valid components", () => {
    expect(validateComponent("foundation").valid).toBe(true);
    expect(validateComponent("data").valid).toBe(true);
    expect(validateComponent("app").valid).toBe(true);
    expect(validateComponent("all").valid).toBe(true);
  });

  it("rejects invalid components", () => {
    expect(validateComponent("infra").valid).toBe(false);
    expect(validateComponent("").valid).toBe(false);
    expect(validateComponent("ALL").valid).toBe(false);
  });
});

describe("isProdLike", () => {
  it("identifies prod-like stages", () => {
    expect(isProdLike("main")).toBe(true);
    expect(isProdLike("prod")).toBe(true);
    expect(isProdLike("production")).toBe(true);
    expect(isProdLike("staging")).toBe(true);
  });

  it("does not flag dev stages", () => {
    expect(isProdLike("dev")).toBe(false);
    expect(isProdLike("ericodom")).toBe(false);
    expect(isProdLike("test")).toBe(false);
  });
});

describe("expandComponent", () => {
  it("expands 'all' to foundation → data → app", () => {
    expect(expandComponent("all")).toEqual(["foundation", "data", "app"]);
  });

  it("returns single tier for specific components", () => {
    expect(expandComponent("foundation")).toEqual(["foundation"]);
    expect(expandComponent("data")).toEqual(["data"]);
    expect(expandComponent("app")).toEqual(["app"]);
  });
});
