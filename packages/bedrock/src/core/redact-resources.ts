import { createHash } from "node:crypto";

import { asResourceKey, type ResourceKey } from "../types/ids.ts";
import { REDACTED_ICON_PATH } from "./redacted-icon.ts";
import type { ResourceKind } from "./resources.ts";
import type {
	DeveloperProductEntry,
	GamePassEntry,
	RedactedDeveloperProductOverride,
	RedactedEnvironmentOverride,
	RedactedGamePassOverride,
	RedactedPlaceOverride,
	ResolvedConfig,
	ResolvedPlaceEntry,
} from "./schema.ts";

/** Default placeholder name pushed for a redacted game-pass. */
export const REDACTED_PASS_NAME = "Redacted Pass";

/**
 * Common prefix used to build the default name pushed for a redacted
 * developer-product. The full default produced by {@link defaultRedactedProductName}
 * is `${REDACTED_PRODUCT_NAME} ${suffix}`, where `suffix` is a 6-hex-char
 * digest of the resource key (see {@link redactedNameSuffix}). The suffix is
 * required because Roblox enforces per-universe uniqueness on
 * developer-product names, so a shared bare placeholder would collide across
 * multiple redacted entries. The prefix avoids the word `Redacted` and the
 * `#` separator because Roblox's text-moderation filter has been observed
 * silently replacing names matching `Redacted Product #<hex>` with
 * `########################`, which then causes downstream `DuplicateProductName`
 * errors when other redacted entries are moderated to the same string.
 */
export const REDACTED_PRODUCT_NAME = "Hidden Product";

/** Default placeholder description pushed for any redacted resource. */
export const REDACTED_DESCRIPTION = "";

/**
 * Default placeholder Robux price pushed for a redacted game-pass or
 * developer-product whose config price is defined. Off-sale resources
 * (`price === undefined`) keep their off-sale state through redaction so a
 * hidden product is never accidentally listed for sale.
 */
export const REDACTED_PRICE = 99_999;

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
 * Per-resource env-overlay redaction layers, keyed by kind. Each entry maps
 * a resource key to its env-overlay `redacted` value (boolean or per-field
 * override). `selectEnvironment` extracts these from env-overlay entries
 * before the rest of the overlay is defu-merged onto the root, so the
 * env-resource layer can compose field-by-field with the root layer in
 * {@link applyRedaction}.
 */
export interface EnvironmentResourceRedaction {
	/** Per-pass env-overlay redaction values keyed by resource key. */
	readonly passes?: EnvironmentResourceLayer<RedactedGamePassOverride>;
	/** Per-place env-overlay redaction values keyed by resource key. */
	readonly places?: EnvironmentResourceLayer<RedactedPlaceOverride>;
	/** Per-product env-overlay redaction values keyed by resource key. */
	readonly products?: EnvironmentResourceLayer<RedactedDeveloperProductOverride>;
}

type RedactionLayer<Override> = boolean | Override | undefined;

type EnvironmentResourceLayer<Override> = Readonly<Record<string, RedactionLayer<Override>>>;

type EnvironmentLevel = boolean | RedactedEnvironmentOverride | undefined;

/**
 * Aggregated redaction layers consumed by {@link applyRedaction}. The
 * `envLevel` layer applies to every redactable resource in the env;
 * `envResource` carries per-resource env-overlay overrides keyed by kind.
 */
interface RedactionInputs {
	/** Env-level redaction layer. Boolean toggle or cross-kind override object. */
	readonly envLevel?: EnvironmentLevel;
	/** Per-resource env-overlay redaction layers, keyed by kind. */
	readonly envResource?: EnvironmentResourceRedaction;
}

interface ProductRedactionInputs {
	readonly key: string;
	readonly entry: DeveloperProductEntry;
	readonly override: RedactedDeveloperProductOverride;
}

interface ResolvedEntry<Entry, Override> {
	readonly key: string;
	readonly entry: Entry;
	readonly override: Override | undefined;
}

const PASS_PRODUCT_ENV_FIELDS = [
	"description",
	"icon",
	"name",
	"price",
] as const satisfies ReadonlyArray<keyof RedactedEnvironmentOverride>;

const PLACE_ENV_FIELDS = ["description", "displayName"] as const satisfies ReadonlyArray<
	keyof RedactedEnvironmentOverride
>;

interface RedactCollectionInputs<Entry, Override> {
	readonly collection: Readonly<Record<string, Entry>> | undefined;
	readonly environmentForKind: RedactionLayer<Override>;
	readonly envResource: EnvironmentResourceLayer<Override> | undefined;
	readonly redact: (item: { entry: Entry; key: string; override: Override }) => Entry;
}

interface RedactKindInputs<Entry, Override> {
	readonly collection: Readonly<Record<string, Entry>> | undefined;
	readonly envLevel: EnvironmentLevel;
	readonly envResource: EnvironmentResourceLayer<Override> | undefined;
}

/**
 * Six-character lowercase hex digest of `SHA-256(key)`, used as the
 * disambiguating suffix on a redacted developer-product's default `name`.
 * Stable across config edits (driven only by the bedrock resource key, not
 * declaration order) and opaque to a Roblox player browsing the marketplace.
 * A natural collision is caught at plan time by `validatePlan`.
 *
 * @param key - Bedrock resource key for the developer product being redacted.
 * @returns The first six lowercase hex characters of the SHA-256 digest of `key`.
 */
export function redactedNameSuffix(key: string): string {
	return createHash("sha256").update(key).digest("hex").slice(0, 6);
}

/**
 * Default redacted name for a developer product with the given resource key.
 * Combines {@link REDACTED_PRODUCT_NAME} with {@link redactedNameSuffix} so
 * each redacted entry resolves to a unique value the upstream API will accept.
 *
 * @param key - Bedrock resource key for the developer product being redacted.
 * @returns The placeholder name pushed to Roblox for this product.
 */
export function defaultRedactedProductName(key: string): string {
	return `${REDACTED_PRODUCT_NAME} ${redactedNameSuffix(key)}`;
}

/**
 * Pure transform that substitutes bedrock-supplied placeholder content for
 * every resource whose effective redaction state is truthy. Three layers
 * compose field-by-field per resource: env-resource (most-specific, from
 * `inputs.envResource`), root-resource (the `redacted` field on the
 * passed-in entry), and env-level (least-specific, `inputs.envLevel`).
 * The first non-undefined value sets state (`false` carves out); object
 * layers then contribute fields with the most-specific layer winning per
 * field, and bedrock defaults fill any field nobody set. Runs between
 * env-overlay merge and display-name prefix render so the rest of the
 * pipeline (flatten, normalize, diff, apply) operates on already-redacted
 * values and needs no special-case redaction logic.
 *
 * @param config - Post-merge `ResolvedConfig` produced by `selectEnvironment`.
 * @param inputs - Aggregated redaction layers. Omit to skip redaction
 *   entirely. See {@link RedactionInputs} for the shape.
 * @returns A `ResolvedConfig` whose redacted entries carry placeholder
 *   values; non-redacted entries pass through verbatim, and the input is
 *   not mutated.
 */
export function applyRedaction(config: ResolvedConfig, inputs?: RedactionInputs): ResolvedConfig {
	const environmentLevel = inputs?.envLevel;
	const environmentResource = inputs?.envResource;
	const passes = redactPasses({
		collection: config.passes,
		envLevel: environmentLevel,
		envResource: environmentResource?.passes,
	});
	const places = redactPlaces({
		collection: config.places,
		envLevel: environmentLevel,
		envResource: environmentResource?.places,
	});
	const products = redactProducts({
		collection: config.products,
		envLevel: environmentLevel,
		envResource: environmentResource?.products,
	});

	if (passes === config.passes && places === config.places && products === config.products) {
		return config;
	}

	return {
		...config,
		...(passes === undefined ? {} : { passes }),
		...(places === undefined ? {} : { places }),
		...(products === undefined ? {} : { products }),
	};
}

/**
 * Inspect the pre-redaction merged config and produce one annotation per
 * resource flagged `redacted: true` at either the root entry or its
 * env-overlay counterpart. Callers thread the result into plan output so
 * authors can see which resources are redacted in the active environment
 * and whether their real-value edits are being suppressed.
 *
 * Operates on the pre-redaction view because the post-redaction config no
 * longer carries the real `name`/`description`/`icon` values needed to
 * detect divergence from the placeholder defaults.
 *
 * @param merged - `ResolvedConfig` produced by environment overlay merge,
 *   before `applyRedaction` has substituted placeholders.
 * @param environmentResource - Per-kind env-overlay redaction layers
 *   extracted from the active env entry. Omit when the caller has no
 *   env-overlay layer.
 * @returns Zero or more annotations, one per redacted resource. Empty when
 *   the config declares no redacted resources.
 */
export function collectRedactionAnnotations(
	merged: ResolvedConfig,
	environmentResource?: EnvironmentResourceRedaction,
): ReadonlyArray<RedactionAnnotation> {
	const passes = Object.entries(merged.passes ?? {})
		.filter(
			([key, entry]) =>
				entry.redacted === true || environmentResource?.passes?.[key] === true,
		)
		.map(([key, entry]): RedactionAnnotation => {
			return {
				key: asResourceKey(key),
				hasRealValueEdits: passHasRealValueEdits(entry),
				kind: "gamePass",
			};
		});
	const products = Object.entries(merged.products ?? {})
		.filter(
			([key, entry]) =>
				entry.redacted === true || environmentResource?.products?.[key] === true,
		)
		.map(([key, entry]): RedactionAnnotation => {
			return {
				key: asResourceKey(key),
				hasRealValueEdits: productHasRealValueEdits(key, entry),
				kind: "developerProduct",
			};
		});

	return [...passes, ...products];
}

function pickEnvironmentFields<Field extends keyof RedactedEnvironmentOverride>(
	environmentLevel: EnvironmentLevel,
	fields: ReadonlyArray<Field>,
): RedactionLayer<Pick<RedactedEnvironmentOverride, Field>> {
	if (environmentLevel === undefined || typeof environmentLevel === "boolean") {
		return environmentLevel;
	}

	return Object.fromEntries(fields.map((field) => [field, environmentLevel[field]])) as Pick<
		RedactedEnvironmentOverride,
		Field
	>;
}

/**
 * Walk redaction layers most-specific to least-specific and produce the
 * effective per-field override for one resource. Returns `undefined` when the
 * resource is not redacted; returns a (possibly empty) object when it is.
 * State step: the first non-undefined layer sets state -- `false` carves out,
 * `true` or object enables. Fields step: walk every object layer in the same
 * order, taking the first value per field. A field's value may itself be
 * `undefined` (the env-level projection produced by {@link pickEnvironmentFields}
 * includes every projected key, even when the env override left it absent);
 * downstream per-kind redact functions collapse those back to bedrock
 * placeholder defaults via `??`.
 *
 * @template Override - Per-kind override type the resource accepts.
 * @param layers - Layers ordered most-specific (index 0) to least-specific.
 * @returns The effective override, or `undefined` when not redacted.
 */
function resolveEffectiveOverride<Override extends object>(
	layers: ReadonlyArray<RedactionLayer<Override>>,
): Override | undefined {
	const firstNonUndefined = layers.find((layer) => layer !== undefined);
	if (firstNonUndefined === undefined || firstNonUndefined === false) {
		return undefined;
	}

	const effective: Record<string, unknown> = {};
	for (const layer of layers) {
		if (typeof layer !== "object") {
			continue;
		}

		for (const [field, value] of Object.entries(layer)) {
			if (!(field in effective)) {
				effective[field] = value;
			}
		}
	}

	return effective as Override;
}

function resolveEntries<
	Entry extends { readonly redacted?: RedactionLayer<Override> },
	Override extends object,
>(inputs: {
	readonly collection: Readonly<Record<string, Entry>>;
	readonly environmentForKind: RedactionLayer<Override>;
	readonly envResource: EnvironmentResourceLayer<Override> | undefined;
}): ReadonlyArray<ResolvedEntry<Entry, Override>> {
	const { collection, environmentForKind, envResource } = inputs;
	return Object.entries(collection).map(([key, entry]) => {
		return {
			key,
			entry,
			override: resolveEffectiveOverride<Override>([
				envResource?.[key],
				entry.redacted,
				environmentForKind,
			]),
		};
	});
}

function redactCollection<
	Entry extends { readonly redacted?: RedactionLayer<Override> },
	Override extends object,
>(inputs: RedactCollectionInputs<Entry, Override>): Readonly<Record<string, Entry>> | undefined {
	const { collection, environmentForKind, envResource, redact } = inputs;
	if (collection === undefined) {
		return undefined;
	}

	const resolved = resolveEntries<Entry, Override>({
		collection,
		environmentForKind,
		envResource,
	});

	if (resolved.every((item) => item.override === undefined)) {
		return collection;
	}

	return Object.fromEntries(
		resolved.map((item) => {
			return item.override === undefined
				? ([item.key, item.entry] as const)
				: ([
						item.key,
						redact({ key: item.key, entry: item.entry, override: item.override }),
					] as const);
		}),
	);
}

function redactPass(entry: GamePassEntry, override: RedactedGamePassOverride): GamePassEntry {
	return {
		...entry,
		name: override.name ?? REDACTED_PASS_NAME,
		description: override.description ?? REDACTED_DESCRIPTION,
		icon: override.icon ?? { "en-us": REDACTED_ICON_PATH },
		...(entry.price === undefined ? {} : { price: override.price ?? REDACTED_PRICE }),
	};
}

function redactPasses(
	inputs: RedactKindInputs<GamePassEntry, RedactedGamePassOverride>,
): ResolvedConfig["passes"] {
	const { collection, envLevel, envResource } = inputs;
	return redactCollection<GamePassEntry, RedactedGamePassOverride>({
		collection,
		environmentForKind: pickEnvironmentFields(envLevel, PASS_PRODUCT_ENV_FIELDS),
		envResource,
		redact: (item) => redactPass(item.entry, item.override),
	});
}

function redactPlace(
	entry: ResolvedPlaceEntry,
	override: RedactedPlaceOverride,
): ResolvedPlaceEntry {
	return {
		...entry,
		description: override.description ?? REDACTED_DESCRIPTION,
		displayName: override.displayName ?? entry.displayName,
	};
}

function redactPlaces(
	inputs: RedactKindInputs<ResolvedPlaceEntry, RedactedPlaceOverride>,
): ResolvedConfig["places"] {
	const { collection, envLevel, envResource } = inputs;
	return redactCollection<ResolvedPlaceEntry, RedactedPlaceOverride>({
		collection,
		environmentForKind: pickEnvironmentFields(envLevel, PLACE_ENV_FIELDS),
		envResource,
		redact: (item) => redactPlace(item.entry, item.override),
	});
}

function redactProduct(inputs: ProductRedactionInputs): DeveloperProductEntry {
	const { key, entry, override } = inputs;
	return {
		...entry,
		name: override.name ?? defaultRedactedProductName(key),
		description: override.description ?? REDACTED_DESCRIPTION,
		icon: override.icon ?? { "en-us": REDACTED_ICON_PATH },
		...(entry.price === undefined ? {} : { price: override.price ?? REDACTED_PRICE }),
	};
}

function redactProducts(
	inputs: RedactKindInputs<DeveloperProductEntry, RedactedDeveloperProductOverride>,
): ResolvedConfig["products"] {
	const { collection, envLevel, envResource } = inputs;
	return redactCollection<DeveloperProductEntry, RedactedDeveloperProductOverride>({
		collection,
		environmentForKind: pickEnvironmentFields(envLevel, PASS_PRODUCT_ENV_FIELDS),
		envResource,
		redact: redactProduct,
	});
}

function passHasRealValueEdits(entry: GamePassEntry): boolean {
	return (
		entry.name !== REDACTED_PASS_NAME ||
		entry.description !== REDACTED_DESCRIPTION ||
		entry.icon["en-us"] !== REDACTED_ICON_PATH ||
		(entry.price !== undefined && entry.price !== REDACTED_PRICE)
	);
}

function productHasRealValueEdits(key: string, entry: DeveloperProductEntry): boolean {
	// A redacted product's `name` is a placeholder when it equals either the
	// suffixed default for this key (what `applyRedaction` synthesizes) or
	// the bare `REDACTED_PRODUCT_NAME` constant (what an author may have
	// hand-typed). Any other value, including `Hidden Product Deluxe` or a
	// suffix that doesn't match this key's hash, is treated as a real edit.
	const isPlaceholderName =
		entry.name === defaultRedactedProductName(key) || entry.name === REDACTED_PRODUCT_NAME;
	return (
		!isPlaceholderName ||
		entry.description !== REDACTED_DESCRIPTION ||
		(entry.icon !== undefined && entry.icon["en-us"] !== REDACTED_ICON_PATH) ||
		(entry.price !== undefined && entry.price !== REDACTED_PRICE)
	);
}
