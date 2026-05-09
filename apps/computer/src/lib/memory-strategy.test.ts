import { describe, expect, it } from "vitest";
import {
  inferStrategy,
  parseMemoryTopics,
  strategyLabel,
  stripTopicTags,
} from "./memory-strategy";

describe("memory-strategy", () => {
  describe("inferStrategy", () => {
    it("recognizes semantic strategyId", () => {
      expect(inferStrategy("memstrat_semantic_user_x", "")).toBe("semantic");
    });

    it("recognizes summary strategyId (lowercase + capitalized)", () => {
      expect(inferStrategy("summary_X", "")).toBe("summaries");
      expect(inferStrategy("Summarized", "")).toBe("summaries");
    });

    it("recognizes preference strategyId", () => {
      expect(inferStrategy("Preference_Y", "")).toBe("preferences");
    });

    it("recognizes episode strategyId", () => {
      expect(inferStrategy("EpisodeNotes", "")).toBe("episodes");
    });

    it("falls back to namespace prefixes when strategyId is empty", () => {
      expect(inferStrategy("", "preferences_user_x")).toBe("preferences");
      expect(inferStrategy("", "session_thread_y")).toBe("summaries");
      expect(inferStrategy("", "episodes_z")).toBe("episodes");
      expect(inferStrategy("", "assistant_alpha")).toBe("semantic");
    });

    it("defaults to semantic when nothing matches", () => {
      expect(inferStrategy("", "")).toBe("semantic");
      expect(inferStrategy("unknown", "weird_namespace")).toBe("semantic");
    });
  });

  describe("parseMemoryTopics", () => {
    it("splits a closed topic block into structured sections", () => {
      const sections = parseMemoryTopics(
        '<topic name="Family">spouse=Alex</topic><topic name="Pets">cat=Mochi</topic>',
      );
      expect(sections).toEqual([
        { topic: "Family", content: "spouse=Alex" },
        { topic: "Pets", content: "cat=Mochi" },
      ]);
    });

    it("handles an unclosed final topic block", () => {
      const sections = parseMemoryTopics('<topic name="Notes">half-written…');
      expect(sections).toEqual([{ topic: "Notes", content: "half-written…" }]);
    });

    it("returns the whole string as a single topicless section when no tags present", () => {
      expect(parseMemoryTopics("plain memory text")).toEqual([
        { topic: "", content: "plain memory text" },
      ]);
    });

    it("preserves leading text before the first topic tag", () => {
      const sections = parseMemoryTopics('preface\n<topic name="A">body</topic>');
      expect(sections[0]).toEqual({ topic: "", content: "preface" });
      expect(sections[1]).toEqual({ topic: "A", content: "body" });
    });
  });

  describe("stripTopicTags", () => {
    it("removes <topic> open and close tags", () => {
      expect(stripTopicTags('<topic name="X">hello</topic> world')).toBe("hello world");
    });

    it("collapses runs of whitespace", () => {
      expect(stripTopicTags("a\n\nb\t\tc")).toBe("a b c");
    });
  });

  describe("strategyLabel", () => {
    it("capitalizes a known strategy name", () => {
      expect(strategyLabel("semantic")).toBe("Semantic");
    });

    it("returns empty string for null", () => {
      expect(strategyLabel(null)).toBe("");
    });
  });
});
