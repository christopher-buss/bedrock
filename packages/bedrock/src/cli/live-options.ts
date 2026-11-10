import type { Result } from "@bedrock-rbx/ocale";

import type { LiveCheckOptions } from "../shell/read-live-state.ts";
import type { ParseOptionsError } from "./parse-options.ts";

/**
 * Validate the switches after sade normalizes --no-live to live: false.
 * @param raw - The command's raw options.
 * @returns Optional live controls, or the switch that was given a value.
 */
export function parseLiveOptions(
	raw: Readonly<Record<string, unknown>>,
): Result<LiveCheckOptions, ParseOptionsError> {
	const options: { failOnOutOfBandEdit?: boolean; live?: boolean } = {};
	for (const [key, flag] of [
		["live", "live"],
		["failOnOutOfBandEdit", "fail-on-out-of-band-edit"],
	] as const) {
		const value = raw[key] ?? raw[flag];
		if (value === undefined) {
			continue;
		}

		if (typeof value !== "boolean") {
			return { err: { flag, kind: "switchGivenValue" }, success: false };
		}

		options[key] = value;
	}

	return { data: options, success: true };
}

/**
 * Forward live controls without applying command defaults.
 * @param options - Parsed live controls.
 * @returns The supplied controls, leaving automatic behavior undefined.
 */
export function liveOptionsFor(options: LiveCheckOptions): LiveCheckOptions {
	return {
		failOnOutOfBandEdit: options.failOnOutOfBandEdit,
		live: options.live,
	};
}
