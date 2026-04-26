import { describe, expect, it } from "vitest";

import {
	candidateLegacyBankIds,
	destinationBankId,
	parseAliasMappings,
	slugifyLegacyBankName,
} from "./hindsight-bank-merge.js";

describe("hindsight bank merge helpers", () => {
	it("derives legacy bank candidates from paired user-owned agents", () => {
		expect(
			candidateLegacyBankIds({
				agent_id: "c1e4434f-fa28-4ba2-bdd5-5d47f9d92e2c",
				slug: "fleet-caterpillar-456",
				name: "Marco",
			}),
		).toEqual([
			"fleet-caterpillar-456",
			"marco",
			"c1e4434f-fa28-4ba2-bdd5-5d47f9d92e2c",
			"user_c1e4434f-fa28-4ba2-bdd5-5d47f9d92e2c",
		]);
	});

	it("slugifies historical display-name banks", () => {
		expect(slugifyLegacyBankName("Loki")).toBe("loki");
		expect(slugifyLegacyBankName("Cruz Control!")).toBe("cruz-control");
		expect(slugifyLegacyBankName("  GiGi / Field Ops  ")).toBe("gigi-field-ops");
	});

	it("keeps the user id as the canonical write bank", () => {
		expect(destinationBankId("4dee701a-c17b-46fe-9f38-a333d4c3fad0")).toBe(
			"user_4dee701a-c17b-46fe-9f38-a333d4c3fad0",
		);
	});

	it("parses explicit alias mappings for historical banks", () => {
		expect(parseAliasMappings(["loki=0488f468-4071-70b0-e0a4-a639373999a0"])).toEqual([
			{
				sourceBankId: "loki",
				userId: "0488f468-4071-70b0-e0a4-a639373999a0",
			},
		]);
		expect(
			parseAliasMappings([
				"loki=0015953e-aa13-4cab-8398-2e70f73dda63:0488f468-4071-70b0-e0a4-a639373999a0",
			]),
		).toEqual([
			{
				sourceBankId: "loki",
				tenantId: "0015953e-aa13-4cab-8398-2e70f73dda63",
				userId: "0488f468-4071-70b0-e0a4-a639373999a0",
			},
		]);
	});

	it("rejects malformed alias mappings", () => {
		expect(() => parseAliasMappings(["loki"])).toThrow(/Expected sourceBank/);
	});
});
