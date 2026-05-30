import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_EDITOR_FONT_SIZE,
  getEditorFontSize,
  getEditorWrap,
  setEditorFontSize,
  setEditorWrap,
} from "./editor-prefs";

afterEach(() => window.localStorage.clear());

describe("editor-prefs", () => {
  it("defaults to wrap off and the default font size", () => {
    expect(getEditorWrap()).toBe(false);
    expect(getEditorFontSize()).toBe(DEFAULT_EDITOR_FONT_SIZE);
  });

  it("round-trips the wrap preference", () => {
    setEditorWrap(true);
    expect(getEditorWrap()).toBe(true);
    setEditorWrap(false);
    expect(getEditorWrap()).toBe(false);
  });

  it("round-trips a valid font size", () => {
    setEditorFontSize(12);
    expect(getEditorFontSize()).toBe(12);
  });

  it("clamps out-of-range font sizes", () => {
    setEditorFontSize(2);
    expect(getEditorFontSize()).toBe(10);
    setEditorFontSize(99);
    expect(getEditorFontSize()).toBe(20);
  });

  it("falls back to the default for a garbage stored value", () => {
    window.localStorage.setItem("thinkwork:editor-font-size", "not-a-number");
    expect(getEditorFontSize()).toBe(DEFAULT_EDITOR_FONT_SIZE);
  });
});
