import { asResourceKey, type ResourceKey } from "../types/ids.ts";
import { REDACTED_ICON_PATH } from "./redacted-icon.ts";
import type { ResourceKind } from "./resources.ts";
import type {
	DeveloperProductEntry,
	GamePassEntry,
	RedactedDeveloperProductOverride,
	RedactedGamePassOverride,
	ResolvedConfig,
} from "./schema.ts";

/** Default placeholder name pushed for a redacted game-pass. */
export const REDACTED_PASS_NAME = "Redacted Pass";

/** Default placeholder name pushed for a redacted developer-product. */
export const REDACTED_PRODUCT_NAME = "Redacted Product";

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
 * every resource whose effective `redacted` flag is truthy. The effective
 * flag is the per-resource `redacted` value when set, otherwise the
 * `environmentRedacted` fallback. A `redacted` object form replaces
 * matching fields with the supplied values and falls back to the bedrock
 * defaults for the rest. Runs between env-overlay merge and display-name
 * prefix render so the rest of the pipeline (flatten, normalize, diff,
 * apply) operates on already-redacted values and needs no special-case
 * redaction logic.
 *
 * @param config - Post-merge `ResolvedConfig` produced by `selectEnvironment`.
 * @param environmentRedacted - Environment-level redaction toggle. Resources
 *   that omit a per-resource `redacted` flag inherit this value.
 * @returns A `ResolvedConfig` whose redacted entries carry placeholder
 *   values; non-redacted entries pass through verbatim, and the input is
 *   not mutated.
 */
export function applyRedaction(
	config: ResolvedConfig,
	environmentRedacted = false,
): ResolvedConfig {
	const passes = redactPasses(config.passes, environmentRedacted);
	const products = redactProducts(config.products, environmentRedacted);

	if (passes === config.passes && products === config.products) {
		return config;
	}

	return {
		...config,
		...(passes === undefined ? {} : { passes }),
		...(products === undefined ? {} : { products }),
	};
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
	const passes = Object.entries(merged.passes ?? {})
		.filter(([, entry]) => entry.redacted === true)
		.map(([key, entry]): RedactionAnnotation => {
			return {
				key: asResourceKey(key),
				hasRealValueEdits: passHasRealValueEdits(entry),
				kind: "gamePass",
			};
		});
	const products = Object.entries(merged.products ?? {})
		.filter(([, entry]) => entry.redacted === true)
		.map(([key, entry]): RedactionAnnotation => {
			return {
				key: asResourceKey(key),
				hasRealValueEdits: productHasRealValueEdits(entry),
				kind: "developerProduct",
			};
		});

	return [...passes, ...products];
}

function redactPass(entry: GamePassEntry, override: RedactedGamePassOverride): GamePassEntry {
	return {
		...entry,
		name: override.name ?? REDACTED_PASS_NAME,
		description: override.description ?? REDACTED_DESCRIPTION,
		icon: override.icon ?? { "en-us": REDACTED_ICON_PATH },
	};
}

function redactPasses(
	passes: ResolvedConfig["passes"],
	environmentRedacted: boolean,
): ResolvedConfig["passes"] {
	if (passes === undefined) {
		return undefined;
	}

	const hasAnyRedaction = Object.values(passes).some(
		(entry) => (entry.redacted ?? environmentRedacted) !== false,
	);
	if (!hasAnyRedaction) {
		return passes;
	}

	return Object.fromEntries(
		Object.entries(passes).map(([key, entry]) => {
			const effective = entry.redacted ?? environmentRedacted;
			if (effective === false) {
				return [key, entry] as const;
			}

			const override: RedactedGamePassOverride =
				typeof effective === "object" ? effective : {};
			return [key, redactPass(entry, override)] as const;
		}),
	);
}

function redactProduct(
	entry: DeveloperProductEntry,
	override: RedactedDeveloperProductOverride,
): DeveloperProductEntry {
	return {
		...entry,
		name: override.name ?? REDACTED_PRODUCT_NAME,
		description: override.description ?? REDACTED_DESCRIPTION,
		icon: override.icon ?? { "en-us": REDACTED_ICON_PATH },
	};
}

function redactProducts(
	products: ResolvedConfig["products"],
	environmentRedacted: boolean,
): ResolvedConfig["products"] {
	if (products === undefined) {
		return undefined;
	}

	const hasAnyRedaction = Object.values(products).some(
		(entry) => (entry.redacted ?? environmentRedacted) !== false,
	);
	if (!hasAnyRedaction) {
		return products;
	}

	return Object.fromEntries(
		Object.entries(products).map(([key, entry]) => {
			const effective = entry.redacted ?? environmentRedacted;
			if (effective === false) {
				return [key, entry] as const;
			}

			const override: RedactedDeveloperProductOverride =
				typeof effective === "object" ? effective : {};
			return [key, redactProduct(entry, override)] as const;
		}),
	);
}

function passHasRealValueEdits(entry: GamePassEntry): boolean {
	return (
		entry.name !== REDACTED_PASS_NAME ||
		entry.description !== REDACTED_DESCRIPTION ||
		entry.icon["en-us"] !== REDACTED_ICON_PATH
	);
}

function productHasRealValueEdits(entry: DeveloperProductEntry): boolean {
	return (
		entry.name !== REDACTED_PRODUCT_NAME ||
		entry.description !== REDACTED_DESCRIPTION ||
		(entry.icon !== undefined && entry.icon["en-us"] !== REDACTED_ICON_PATH)
	);
}
