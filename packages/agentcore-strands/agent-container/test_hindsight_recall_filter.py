"""Tests for hindsight_recall_filter.

Fixtures are taken verbatim from the Phase 0 verification recall response
against Marco's bank (`calm-capybara-371`) for the query
`"Cedric workplace employer"` on Hindsight 0.5.0. Running the filter on
this exact set is the regression test for the user's reported bug.

Run with: python -m unittest packages/agentcore-strands/agent-container/test_hindsight_recall_filter.py
"""

from __future__ import annotations

import unittest
from dataclasses import dataclass
from typing import Any, Optional

from hindsight_recall_filter import (
    DEFAULT_CONFIG,
    FilterConfig,
    _extract_query_terms,
    _jaccard,
    _normalize_text,
    _tokenize,
    filter_recall_results,
    format_results_for_agent,
)


# ---------------------------------------------------------------------------
# Minimal stand-in for the Hindsight SDK RecallResult object.
# The filter reads `text`, `type`, and `entities` via getattr/dict-get, so
# both dict and dataclass shapes are supported. Tests exercise both.
# ---------------------------------------------------------------------------


@dataclass
class _Result:
    id: str
    text: str
    type: str
    entities: Optional[list] = None


# ---------------------------------------------------------------------------
# Phase 0 capture: Marco bank recall for "Cedric workplace employer",
# budget=low, on Hindsight 0.5.0, taken 2026-04-08.
# First 14 are Cedric-relevant, 15-35 are the Sapp Bros / Texas Enterprises
# / CRM / Playdates bleed-through that we want the filter to eliminate.
# ---------------------------------------------------------------------------


def _marco_cedric_recall() -> list[_Result]:
    return [
        _Result("6bf588b1", "Cedric's production is small\u2011batch biodynamic with very low yields, limiting distribution.", "observation", None),
        _Result("3f277a42", "Cedric is a winemaker at Domaine la P\u00e9qu\u00e9lette in Vinsobres, France | Involving: Cedric", "world", ["Cedric", "Domaine la P\u00e9qu\u00e9lette", "Vinsobres", "France"]),
        _Result("29305117", "Cedric is from Vinsobres, France | Involving: Cedric", "world", ["Cedric", "Vinsobres", "France"]),
        _Result("4c7ce02d", "Cedric is from Vinsobres, France | Involving: Cedric", "world", ["Cedric", "Vinsobres", "France"]),
        _Result("a97f5fa7", "Cedric is from Vinsobres, France, and is connected to Domaine la P\u00e9qu\u00e9lette winery.", "observation", None),
        _Result("074ae5c6", "Cedric's production is small-batch biodynamic with very low yields, limiting distribution | Involving: Cedric", "world", ["Cedric", "small-batch", "biodynamic", "low yields", "distribution"]),
        _Result("2f890695", "The user has Cedric saved as a favorite in their places list | Involving: user", "world", ["user", "Cedric", "saved places"]),
        _Result("91d685da", "User has Cedric saved as a favorite in places | Involving: user", "world", ["user", "Cedric", "saved places"]),
        _Result("da42243d", "User has Cedric saved as a favorite location in their places list", "observation", None),
        _Result("8df9b060", "Cedric is connected to Domaine la P\u00e9qu\u00e9lette winery, which the user visited and rated as one of the best | Involving: Cedric", "world", ["Cedric", "Domaine la P\u00e9qu\u00e9lette", "winery", "user"]),
        _Result("e1484569", "Cedric is connected to Domaine la P\u00e9qu\u00e9lette winery | Involving: Cedric", "world", ["Cedric", "Domaine la P\u00e9qu\u00e9lette", "winery"]),
        _Result("2338fd62", "Cedric's wines are small-batch biodynamic production with very low yields, limiting distribution | Involving: Cedric", "world", ["Cedric", "Domaine la P\u00e9qu\u00e9lette", "small-batch", "biodynamic production", "low yields"]),
        _Result("d7fe3b97", "Cedric's wines are distributed to Canada via Le Vin Dans Les Voiles (Quebec) | Involving: Cedric", "world", ["Cedric", "Domaine la P\u00e9qu\u00e9lette", "Canada", "Le Vin Dans Les Voiles", "Quebec"]),
        _Result("ef038ce8", "Domaine la P\u00e9qu\u00e9lette is a winery in Vinsobres, France, visited and marked favorite; Cedric is a winemaker there | Involving: user", "world", ["Domaine la P\u00e9qu\u00e9lette", "Vinsobres", "France", "Cedric", "user"]),
        _Result("tx001", "Texas Enterprises, Inc. emphasizes treating customers and employees like family, going the extra mile.", "observation", None),
        _Result("tx002", "Texas Enterprises, Inc. serves industry verticals including construction, transportation, oil & gas, wineries, breweries, food service.", "observation", None),
        _Result("tx003", "Texas Enterprises, Inc. markets, distributes, and provides services such as lubrication analysis, evaporative air coolers, industrial infrared heaters.", "observation", None),
        _Result("sb001", "Sapp Bros. was breached by ransomware group WorldLeaks, leaking employee HR and payroll data.", "observation", None),
        _Result("sb002", "Sapp Bros. Petroleum, Inc. suffered a ransomware breach by the group WorldLeaks in September 2025, exposing employee HR and payroll data.", "world", ["Sapp Bros. Petroleum, Inc.", "WorldLeaks", "HR data", "payroll data"]),
        _Result("sb003", "Sapp Bros. Petroleum, Inc. employs about 2,800 people, including 86 corporate staff and 26 in the petroleum division.", "world", ["Sapp Bros. Petroleum, Inc.", "26 employees", "86 corporate staff", "26 petroleum division"]),
        _Result("crm001", "The CRM contains 538 opportunities as of 2026-04-02.", "observation", None),
        _Result("sb004", "Sapp Bros., Inc. is a privately held company headquartered in Omaha, Nebraska, founded in 1971 by brothers Lee, Bill, Ray, and Dean Sapp.", "world", ["Sapp Bros. Petroleum, Inc.", "Omaha, Nebraska"]),
        _Result("tx004", "Texas Enterprises, Inc. employs 43 people and has experienced 9.7% year\u2011over\u2011year growth.", "observation", None),
        _Result("tx005", "The company serves industry verticals including construction, transportation, oil & gas, wineries, breweries, food service, food processing, athletics.", "world", ["Texas Enterprises, Inc.", "construction", "transportation", "oil & gas"]),
        _Result("cc001", "Assistant Claude is an AI assistant built on Anthropic's Claude Agent SDK, capable of code development, web research.", "observation", None),
        _Result("sb005", "In September 2025, the ransomware group WorldLeaks breached Sapp Bros., leaking employee HR and payroll data.", "world", ["Sapp Bros. Petroleum", "WorldLeaks"]),
        _Result("crm002", "There are 538 total opportunities in the CRM. | When: 2026-03-26", "world", ["assistant", "user", "opportunities"]),
        _Result("cc002", "Assistant Claude is an AI assistant built on Anthropic's Claude Agent SDK.", "observation", None),
        _Result("crm003", "Assistant listed the last 5 opportunities: Harlow food stores, Anderson Columbia, SHC Aware HS 46 Hydaulic Oil, Aldape auto center, Border Tire.", "world", ["assistant", "Harlow food stores", "Anderson Columbia"]),
        _Result("cust001", "Delta, LLC is a fuel customer, tax exempt, and requested a $5,000 credit line.", "observation", None),
        _Result("sb006", "Key leadership includes Andrew Richard (CEO), Tyler Marsh (CFO), Dan Dunstan (President of Travel Centers).", "world", ["Andrew Richard", "Tyler Marsh", "Dan Dunstan", "Sapp Bros. Petroleum, Inc."]),
        _Result("tx006", "Texas Enterprises, Inc. serves industry verticals including construction, transportation, oil & gas.", "world", ["Texas Enterprises, Inc.", "construction", "transportation"]),
        _Result("sb007", "Martin Christensen serves as Sales Manager at Sapp Bros. Petroleum, Inc.", "observation", None),
        _Result("sb008", "Sapp Bros. Petroleum, Inc. experienced a ransomware breach by WorldLeaks in September 2025.", "world", ["Andersen v. Sapp Bros. Inc.", "WorldLeaks"]),
        _Result("cust002", "Epsilon Ltd is a fuel customer, not tax exempt, and has a credit line.", "observation", None),
    ]


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


class TestNormalization(unittest.TestCase):

    def test_strips_involving_suffix(self):
        self.assertEqual(
            _normalize_text("Cedric is from Vinsobres, France | Involving: Cedric"),
            "cedric is from vinsobres, france",
        )

    def test_strips_when_suffix(self):
        self.assertEqual(
            _normalize_text("There are 538 total opportunities in the CRM. | When: 2026-03-26"),
            "there are 538 total opportunities in the crm.",
        )

    def test_normalizes_unicode_hyphen(self):
        # U+2011 NON-BREAKING HYPHEN must fold to ASCII -
        a = _normalize_text("small\u2011batch biodynamic")
        b = _normalize_text("small-batch biodynamic")
        self.assertEqual(a, b)

    def test_collapses_whitespace(self):
        self.assertEqual(_normalize_text("foo   bar\n\tbaz"), "foo bar baz")

    def test_empty_input(self):
        self.assertEqual(_normalize_text(""), "")
        self.assertEqual(_normalize_text(None or ""), "")


class TestTokenize(unittest.TestCase):

    def test_drops_short_tokens(self):
        tokens = _tokenize("a of to cedric")
        self.assertIn("cedric", tokens)
        for short in ("a", "of", "to"):
            self.assertNotIn(short, tokens)

    def test_lowercases(self):
        self.assertIn("cedric", _tokenize("Cedric CEDRIC"))


class TestJaccard(unittest.TestCase):

    def test_identical_sets(self):
        s = frozenset({"a", "b", "c"})
        self.assertEqual(_jaccard(s, s), 1.0)

    def test_disjoint_sets(self):
        self.assertEqual(_jaccard(frozenset({"a"}), frozenset({"b"})), 0.0)

    def test_half_overlap(self):
        a = frozenset({"x", "y"})
        b = frozenset({"y", "z"})
        self.assertAlmostEqual(_jaccard(a, b), 1 / 3)

    def test_empty_set(self):
        self.assertEqual(_jaccard(frozenset(), frozenset({"a"})), 0.0)


class TestQueryExtraction(unittest.TestCase):

    def test_cedric_workplace_employer(self):
        terms = _extract_query_terms("Cedric workplace employer")
        self.assertEqual(terms, frozenset({"cedric", "workplace", "employer"}))

    def test_drops_stopwords(self):
        terms = _extract_query_terms("Where does Cedric work?")
        self.assertIn("cedric", terms)
        self.assertIn("work", terms)
        for sw in ("where", "does"):
            self.assertNotIn(sw, terms)

    def test_empty_query(self):
        self.assertEqual(_extract_query_terms(""), frozenset())


# ---------------------------------------------------------------------------
# End-to-end filter tests on the Marco Cedric capture
# ---------------------------------------------------------------------------


class TestMarcoCedricRegression(unittest.TestCase):
    """The user-reported bug: hindsight_recall returning 31+ noisy results."""

    def setUp(self):
        self.results = _marco_cedric_recall()
        self.query = "Cedric workplace employer"

    def test_final_count_bounded(self):
        filtered = filter_recall_results(self.results, self.query)
        self.assertLessEqual(len(filtered), DEFAULT_CONFIG.final_cap)

    def test_no_unrelated_topics(self):
        filtered = filter_recall_results(self.results, self.query)
        unrelated_markers = [
            "sapp bros",
            "texas enterprises",
            "worldleaks",
            "crm",
            "opportunit",
            "harlow food",
            "anderson columbia",
            "delta, llc",
            "epsilon",
            "assistant claude",
        ]
        for r in filtered:
            text = r.text.lower()
            for marker in unrelated_markers:
                self.assertNotIn(
                    marker,
                    text,
                    msg=f"Off-topic result survived filter: {r.text!r}",
                )

    def test_no_literal_duplicates(self):
        """Items 3 and 4 in the raw recall are byte-identical."""
        filtered = filter_recall_results(self.results, self.query)
        texts = [_normalize_text(r.text) for r in filtered]
        self.assertEqual(len(texts), len(set(texts)), f"Duplicate normalized text in: {texts}")

    def test_no_near_duplicates_above_threshold(self):
        """No pair of survivors should have Jaccard >= 0.85."""
        filtered = filter_recall_results(self.results, self.query)
        token_sets = [_tokenize(_normalize_text(r.text)) for r in filtered]
        for i in range(len(token_sets)):
            for j in range(i + 1, len(token_sets)):
                sim = _jaccard(token_sets[i], token_sets[j])
                self.assertLess(
                    sim,
                    DEFAULT_CONFIG.dedup_jaccard_threshold,
                    msg=f"Near-dup pair (sim={sim:.3f}): {filtered[i].text!r} vs {filtered[j].text!r}",
                )

    def test_at_least_one_cedric_fact_survives(self):
        """The filter should not accidentally drop all relevant content."""
        filtered = filter_recall_results(self.results, self.query)
        self.assertGreater(len(filtered), 0, "Filter returned empty result")
        # At least one survivor must be about Cedric.
        has_cedric = any("cedric" in r.text.lower() for r in filtered)
        self.assertTrue(has_cedric, "No Cedric-related result survived")

    def test_observations_preferred_over_backing_world_facts(self):
        """If an observation's text overlaps a world fact at >=0.55 Jaccard,
        the observation should survive and the world fact should drop."""
        filtered = filter_recall_results(self.results, self.query)
        # The "small-batch biodynamic" observation (id 6bf588b1) should beat
        # the two world facts 074ae5c6 and 2338fd62 which say the same thing.
        ids = {r.id for r in filtered}
        self.assertIn("6bf588b1", ids, "Small-batch observation did not survive")
        # At most one of the three duplicate "small-batch" results should be
        # present (the observation).
        smallbatch_ids = {"6bf588b1", "074ae5c6", "2338fd62"}
        present = smallbatch_ids & ids
        self.assertEqual(
            len(present),
            1,
            f"Expected exactly 1 small-batch survivor, got {present}",
        )

    def test_saved_as_favorite_cluster_collapses_to_observation(self):
        """The 'saved as favorite' cluster — 2 world facts (2f890695, 91d685da)
        plus 1 observation (da42243d) — must collapse to exactly the
        observation. Regression test for the two-pass dedup refactor; an
        earlier in-order dedup let all three through because the observation
        arrived after the world facts in recall order."""
        filtered = filter_recall_results(self.results, self.query)
        favorite_ids = {"2f890695", "91d685da", "da42243d"}
        ids = {r.id for r in filtered}
        present = favorite_ids & ids
        self.assertEqual(
            present,
            {"da42243d"},
            f"Expected only the observation (da42243d) to survive, got {present}",
        )

    def test_two_pass_keeps_observations_early_in_output(self):
        """Observations should appear near the top of the filtered list
        because they are Hindsight's own dedup output — higher signal per
        token than their source world facts."""
        filtered = filter_recall_results(self.results, self.query)
        obs_positions = [i for i, r in enumerate(filtered) if r.type == "observation"]
        world_positions = [i for i, r in enumerate(filtered) if r.type == "world"]
        self.assertTrue(obs_positions, "No observations in filtered output")
        # At least one observation must appear before at least one world fact.
        if world_positions:
            self.assertLess(min(obs_positions), max(world_positions))


class TestEdgeCases(unittest.TestCase):

    def test_empty_input(self):
        self.assertEqual(filter_recall_results([], "anything"), [])

    def test_empty_query_still_dedups(self):
        """An empty query should skip relevance but still run dedup + cap."""
        results = [
            _Result("1", "foo bar baz", "world", ["foo"]),
            _Result("2", "foo bar baz", "world", ["foo"]),  # exact dup
            _Result("3", "totally different content here", "world", ["other"]),
        ]
        filtered = filter_recall_results(results, "")
        self.assertEqual(len(filtered), 2, f"Expected 2 after dedup, got: {[r.text for r in filtered]}")

    def test_dict_shape_results(self):
        """Filter should accept dict-shape results too (in case the SDK
        returns raw JSON instead of dataclass objects)."""
        results = [
            {"id": "1", "text": "Cedric is a winemaker in France", "type": "world", "entities": ["Cedric", "France"]},
            {"id": "2", "text": "Sapp Bros runs truck stops", "type": "world", "entities": ["Sapp Bros"]},
        ]
        filtered = filter_recall_results(results, "Cedric")
        self.assertEqual(len(filtered), 1)
        self.assertEqual(filtered[0]["id"], "1")

    def test_all_results_off_topic_fallback(self):
        """If entity filter would eliminate everything, fall back to raw top-N
        so the agent never gets an empty response."""
        results = [
            _Result("a", "fact about foo", "world", ["foo"]),
            _Result("b", "fact about bar", "world", ["bar"]),
        ]
        # Query has no matching terms
        filtered = filter_recall_results(results, "zzz yyy")
        # Both survive via fallback (plus dedup)
        self.assertEqual(len(filtered), 2)

    def test_final_cap_enforced(self):
        # Make each result lexically distinct — the dedup step would otherwise
        # merge results whose normalized token sets are the same after the
        # 3-char minimum drops single-digit suffixes.
        topics = [
            "alpha vineyard harvest notes",
            "beta refinery expansion timeline",
            "gamma logistics contract update",
            "delta warehouse inspection report",
            "epsilon marketing campaign launch",
            "zeta quality assurance audit",
            "eta supplier negotiation summary",
            "theta customer churn investigation",
        ]
        results = [
            _Result(str(i), topics[i], "world", ["cedric", f"subject{i:03d}-unique"])
            for i in range(len(topics))
        ]
        config = FilterConfig(final_cap=3)
        filtered = filter_recall_results(results, "cedric", config=config)
        self.assertEqual(len(filtered), 3)


class TestFormatting(unittest.TestCase):

    def test_empty_message(self):
        self.assertEqual(format_results_for_agent([]), "No relevant memories found.")

    def test_numbered_list(self):
        results = [_Result("a", "first fact", "world"), _Result("b", "second fact", "world")]
        out = format_results_for_agent(results)
        self.assertEqual(out, "1. first fact\n2. second fact")


if __name__ == "__main__":
    unittest.main()
