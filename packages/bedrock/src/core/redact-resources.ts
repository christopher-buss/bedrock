import { asResourceKey, type ResourceKey } from "../types/ids.ts";
import { REDACTED_ICON_PATH } from "./redacted-icon.ts";
import type { ResourceKind } from "./resources.ts";
import type { GamePassEntry, ResolvedConfig } from "./schema.ts";

/** Default placeholder name pushed for a redacted game-pass. */
export const REDACTED_PASS_NAME = "Redacted Pass";

/** Default placeholder description pushed for any redacted resource. */
export const REDACTED_DESCRIPTION = "";

/**
 * Per-resource annotation surfaced in plan output for entries that are
 * redacted in the active environment. `hasRealValueEdits` is true when the
 * pre-redaction merged config carries real display values that diverge from
 * the placeholders bedrock pushes, so the renderer can warn the author that
 * their config edits are intentionally not flowing through to Open Cloud.
 */
export interface RedactionAnnotation {
	/** Resource key the annotation describes. */
	readonly key: ResourceKey;
	/** True when any real display field differs from the kind's placeholder default. */
	readonly hasRealValueEdits: boolean;
	/** Resource kind, so the renderer can format `kind:key` consistently with op output. */
	readonly kind: ResourceKind;
}

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

/**
 * Inspect the pre-redaction merged config and produce one annotation per
 * resource flagged `redacted: true`. Callers thread the result into plan
 * output so authors can see which resources are redacted in the active
 * environment and whether their real-value edits are being suppressed.
 *
 * Operates on the pre-redaction view because the post-redaction config no
 * longer carries the real `name`/`description`/`icon` values needed to
 * detect divergence from the placeholder defaults.
 *
 * @param merged - `ResolvedConfig` produced by environment overlay merge,
 *   before `applyRedaction` has substituted placeholders.
 * @returns Zero or more annotations, one per redacted resource. Empty when
 *   the config declares no redacted resources.
 */
export function collectRedactionAnnotations(
	merged: ResolvedConfig,
): ReadonlyArray<RedactionAnnotation> {
	if (merged.passes === undefined) {
		return [];
	}

	return Object.entries(merged.passes)
		.filter(([, entry]) => entry.redacted === true)
		.map(([key]) => {
			return { key: asResourceKey(key), hasRealValueEdits: false, kind: "gamePass" as const };
		});
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
