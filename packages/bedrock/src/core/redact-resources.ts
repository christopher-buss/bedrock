import { REDACTED_ICON_PATH } from "./redacted-icon.ts";
import type { GamePassEntry, ResolvedConfig } from "./schema.ts";

/** Default placeholder name pushed for a redacted game-pass. */
export const REDACTED_PASS_NAME = "Redacted Pass";

/** Default placeholder description pushed for any redacted resource. */
export const REDACTED_DESCRIPTION = "";

/**
 * Pure transform that substitutes bedrock-supplied placeholder content for
 * every resource flagged `redacted: true`. Runs between env-overlay merge
 * and display-name prefix render so the rest of the pipeline (flatten,
 * normalize, diff, apply) operates on already-redacted values and needs no
 * special-case redaction logic.
 *
 * @param config - Post-merge `ResolvedConfig` produced by `selectEnvironment`.
 * @returns A `ResolvedConfig` whose redacted entries carry placeholder
 *   values; non-redacted entries pass through verbatim, and the input is
 *   not mutated.
 */
export function applyRedaction(config: ResolvedConfig): ResolvedConfig {
	if (config.passes === undefined) {
		return config;
	}

	const passes = Object.fromEntries(
		Object.entries(config.passes).map(([key, entry]) => {
			return [key, redactPass(entry)] as const;
		}),
	);

	return { ...config, passes };
}

function redactPass(entry: GamePassEntry): GamePassEntry {
	if (entry.redacted !== true) {
		return entry;
	}

	return {
		...entry,
		name: REDACTED_PASS_NAME,
		description: REDACTED_DESCRIPTION,
		icon: { "en-us": REDACTED_ICON_PATH },
	};
}
