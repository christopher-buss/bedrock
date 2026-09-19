import { describe, expect, it } from "vitest";

import { resolveProbeConfig } from "./luau-deadline-overrun.ts";

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
