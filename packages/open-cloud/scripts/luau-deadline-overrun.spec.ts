import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { buildProbeScripts, resolveProbeConfig } from "./luau-deadline-overrun.ts";

const VALID_ENV = {
	OCALE_PROBE_DISPOSABLE_PLACE: "222",
	ROBLOX_API_KEY: "secret-key-value",
	ROBLOX_TEST_PLACE_ID: "222",
	ROBLOX_TEST_UNIVERSE_ID: "111",
};

describe(resolveProbeConfig, () => {
	it("should resolve a config when the disposable-place opt-in names the target place", () => {
		expect.assertions(1);

		expect(resolveProbeConfig(VALID_ENV)).toStrictEqual({
			config: {
				apiKey: "secret-key-value",
				observationBoundMs: 60_000,
				placeId: "222",
				placeVersionId: undefined,
				pollIntervalMs: 1000,
				timeoutSeconds: 5,
				universeId: "111",
			},
			ok: true,
		});
	});

	it("should pin to an explicit place version when one is supplied", () => {
		expect.assertions(1);

		const result = resolveProbeConfig({ ...VALID_ENV, ROBLOX_TEST_PLACE_VERSION_ID: "7" });

		expect(result.ok && result.config.placeVersionId).toBe("7");
	});

	it("should refuse to run without the disposable-place opt-in", () => {
		expect.assertions(1);

		const { OCALE_PROBE_DISPOSABLE_PLACE: _optIn, ...environment } = VALID_ENV;

		expect(resolveProbeConfig(environment)).toStrictEqual({
			ok: false,
			reason: "refusing to run: set OCALE_PROBE_DISPOSABLE_PLACE=222 to confirm place 222 is a dedicated, disposable test place with no other submitters",
		});
	});

	it("should refuse to run when the opt-in names a different place", () => {
		expect.assertions(1);

		const result = resolveProbeConfig({ ...VALID_ENV, OCALE_PROBE_DISPOSABLE_PLACE: "999" });

		expect(result).toStrictEqual({
			ok: false,
			reason: "refusing to run: set OCALE_PROBE_DISPOSABLE_PLACE=222 to confirm place 222 is a dedicated, disposable test place with no other submitters",
		});
	});

	it.for(["ROBLOX_API_KEY", "ROBLOX_TEST_UNIVERSE_ID", "ROBLOX_TEST_PLACE_ID"])(
		"should name %s when it is missing without echoing any value",
		(name) => {
			expect.assertions(2);

			const environment: Record<string, string | undefined> = {
				...VALID_ENV,
				[name]: undefined,
			};
			const result = resolveProbeConfig(environment);

			expect(result).toStrictEqual({ ok: false, reason: `${name} must be set` });
			expect(JSON.stringify(result)).not.toContain("secret-key-value");
		},
	);
});

describe(buildProbeScripts, () => {
	const scripts = buildProbeScripts("run1");

	it("should produce the control, yielding, and busy scripts in experiment order", () => {
		expect.assertions(1);

		expect(scripts.map((script) => script.kind)).toStrictEqual(["control", "yielding", "busy"]);
	});

	it.for(scripts)(
		"should have the $kind script write its started marker to the run's sorted map",
		(script) => {
			expect.assertions(1);

			expect(script.source).toContain(
				'MemoryStoreService:GetSortedMap("bedrock-probe-run1")\n' +
					`map:SetAsync("${script.kind}-started", DateTime.now():ToIsoDate(), 3600)`,
			);
		},
	);

	it("should have the control write a finished marker and return", () => {
		expect.assertions(1);

		expect(scripts[0]!.source).toBe(
			[
				'local MemoryStoreService = game:GetService("MemoryStoreService")',
				'local map = MemoryStoreService:GetSortedMap("bedrock-probe-run1")',
				'map:SetAsync("control-started", DateTime.now():ToIsoDate(), 3600)',
				'map:SetAsync("control-finished", DateTime.now():ToIsoDate(), 3600)',
				'return "control"',
			].join("\n"),
		);
	});

	it("should have the yielding target wait forever and the busy target spin forever", () => {
		expect.assertions(2);

		expect(scripts[1]!.source.split("\n").slice(3)).toStrictEqual([
			"while true do",
			"\ttask.wait(1)",
			"end",
		]);
		expect(scripts[2]!.source.split("\n").slice(3)).toStrictEqual(["while true do", "end"]);
	});

	it.for(scripts)("should digest the $kind source with sha-256", (script) => {
		expect.assertions(1);

		expect(script.sha256).toBe(createHash("sha256").update(script.source).digest("hex"));
	});
});
