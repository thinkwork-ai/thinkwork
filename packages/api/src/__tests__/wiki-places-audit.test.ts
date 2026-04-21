import { describe, expect, it } from "vitest";
import { summarize } from "../../scripts/wiki-places-audit.js";
import {
	compareSnapshots,
	stableStringify,
	type PageSnapshot,
} from "../../scripts/wiki-places-drift-snapshot.js";

describe("wiki-places-audit summarize", () => {
	it("computes addressable ceiling for a scope with a partially-covered unlinked tail", () => {
		const out = summarize({
			active_entity_pages: 1000,
			unlinked_entity_pages: 500,
			unlinked_with_place_data: 300,
		});
		expect(out.active_entity_pages).toBe(1000);
		expect(out.unlinked_entity_pages).toBe(500);
		expect(out.unlinked_with_place_data).toBe(300);
		expect(out.current_linked_pct).toBe(50);
		expect(out.projected_linked_pct).toBe(80);
		expect(out.projected_lift_pp).toBeCloseTo(30, 5);
		expect(out.addressable_ceiling_pct).toBe(60);
	});

	it("handles empty scope without divide-by-zero", () => {
		const out = summarize({
			active_entity_pages: 0,
			unlinked_entity_pages: 0,
			unlinked_with_place_data: 0,
		});
		expect(out.current_linked_pct).toBe(0);
		expect(out.projected_linked_pct).toBe(0);
		expect(out.addressable_ceiling_pct).toBe(0);
		expect(out.projected_lift_pp).toBe(0);
	});

	it("handles fully-linked scope where lift is zero", () => {
		const out = summarize({
			active_entity_pages: 200,
			unlinked_entity_pages: 0,
			unlinked_with_place_data: 0,
		});
		expect(out.current_linked_pct).toBe(100);
		expect(out.projected_linked_pct).toBe(100);
		expect(out.projected_lift_pp).toBe(0);
	});

	it("coerces numeric-string column values from pg driver", () => {
		// Postgres returns count(*) as text via the node-postgres driver; summarize()
		// must Number()-coerce.
		const out = summarize({
			active_entity_pages: "100",
			unlinked_entity_pages: "40",
			unlinked_with_place_data: "25",
		});
		expect(out.active_entity_pages).toBe(100);
		expect(out.addressable_ceiling_pct).toBe(62.5);
	});
});

describe("wiki-places-drift-snapshot stableStringify", () => {
	it("produces identical output regardless of key order", () => {
		const a = stableStringify({ b: 2, a: 1, c: 3 });
		const b = stableStringify({ c: 3, a: 1, b: 2 });
		expect(a).toBe(b);
	});

	it("preserves nested-key stability", () => {
		const a = stableStringify({ outer: { b: 2, a: 1 }, z: 9 });
		const b = stableStringify({ z: 9, outer: { a: 1, b: 2 } });
		expect(a).toBe(b);
	});

	it("preserves array order", () => {
		const a = stableStringify([3, 1, 2]);
		const b = stableStringify([1, 2, 3]);
		expect(a).not.toBe(b);
	});
});

describe("wiki-places-drift-snapshot compareSnapshots", () => {
	function mkPage(id: string, inbound: number, aggJson: string): PageSnapshot {
		return {
			page_id: id,
			slug: `page-${id}`,
			title: `Page ${id}`,
			inbound_link_count: inbound,
			inbound_link_ids: [],
			section_aggregations:
				aggJson === ""
					? []
					: [{ section_slug: "overview", aggregation_json: aggJson }],
		};
	}

	it("reports budget ok when aggregation changes track a minority of inbound changes", () => {
		const before = [
			mkPage("1", 2, '{"promotion_status":"none"}'),
			mkPage("2", 3, '{"promotion_status":"none"}'),
			mkPage("3", 0, '{"promotion_status":"none"}'),
			mkPage("4", 1, ""),
		];
		// 3 pages gain inbound links; only 1 sees agg change → 33% ratio, above
		// default 10% threshold. Budget should be exceeded at 10%.
		const after = [
			mkPage("1", 3, '{"promotion_status":"none"}'),
			mkPage("2", 5, '{"promotion_status":"none"}'),
			mkPage("3", 2, '{"promotion_status":"promoted"}'), // agg changed
			mkPage("4", 1, ""),
		];
		const report = compareSnapshots(before, after, 0.1);
		expect(report.inbound_count_changed).toBe(3);
		expect(report.aggregation_changed).toBe(1);
		expect(report.aggregation_changed_on_affected).toBe(1);
		expect(report.budget_exceeded).toBe(true); // 1/3 > 10%
	});

	it("reports budget ok when threshold is generous", () => {
		const before = [
			mkPage("1", 2, '{"x":1}'),
			mkPage("2", 3, '{"x":1}'),
		];
		const after = [
			mkPage("1", 3, '{"x":1}'),
			mkPage("2", 3, '{"x":2}'), // agg changed but inbound unchanged
		];
		const report = compareSnapshots(before, after, 0.5);
		expect(report.inbound_count_changed).toBe(1);
		expect(report.aggregation_changed).toBe(1);
		// The inbound-changed page did NOT change agg; the agg-changed page did
		// NOT change inbound. Numerator is zero.
		expect(report.aggregation_changed_on_affected).toBe(0);
		expect(report.budget_exceeded).toBe(false);
	});

	it("ignores pages new since the before snapshot", () => {
		const before = [mkPage("1", 1, '{"x":1}')];
		const after = [
			mkPage("1", 1, '{"x":1}'),
			mkPage("2-new", 5, '{"x":2}'), // didn't exist before — skip
		];
		const report = compareSnapshots(before, after, 0.1);
		expect(report.total_pages).toBe(2);
		expect(report.inbound_count_changed).toBe(0);
		expect(report.aggregation_changed).toBe(0);
	});

	it("returns zero affected when snapshots are identical", () => {
		const snap = [mkPage("1", 5, '{"x":1}'), mkPage("2", 0, "")];
		const report = compareSnapshots(snap, snap, 0.1);
		expect(report.inbound_count_changed).toBe(0);
		expect(report.aggregation_changed).toBe(0);
		expect(report.budget_exceeded).toBe(false);
	});
});
